import { createSignal, onCleanup, onMount } from 'solid-js';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { AppRuntime } from './runtime';
import { Catalog, preferredSource, unify as CatalogMerge, type CatalogEntry } from '../services/Catalog';
import { Discovery, type DiscoveryResult } from '../services/Discovery';
import { BrewClient, NixClient, makePlan, type InstalledPackage, type Plan } from '../services/Managers';
import { Operations, conflicts, transition, type Operation } from '../services/Operations';
import { Updater } from '../services/Updater';
import { Icons } from '../services/Icons';
import { Onboarding } from '../services/Onboarding';
import { Settings, defaults, type Preferences } from '../services/Settings';
import { AppError, Shell, Storage, displayCommand } from '../services/Platform';
import type { PackageSource } from '../domain/package';

export interface Model {
  readonly searchEntries?: readonly CatalogEntry[]; readonly searchStatus?: string;
  readonly catalog: readonly CatalogEntry[]; readonly installed: readonly InstalledPackage[];
  readonly updates: readonly InstalledPackage[]; readonly operations: readonly Operation[];
  readonly tools?: DiscoveryResult; readonly settings: Preferences;
  readonly busy: readonly string[]; readonly message: string; readonly error: string;
  readonly history: string; readonly setupLog: string; readonly updatesChecked: boolean;
}
export function createController(runtime: AppRuntime, start = true, initial?: Partial<Model>) {
  const [model, setModel] = createSignal<Model>({ catalog: [], installed: [], updates: [], operations: [], settings: defaults, busy: [], message: '', error: '', history: '', setupLog: '', updatesChecked: false, ...initial });
  const controllers = new Map<string, AbortController>();
  let disposed = false;
  const patch = (change: Partial<Model>) => { if (!disposed) setModel(current => ({ ...current, ...change })); };
  type R = AppRuntime extends import('effect').ManagedRuntime.ManagedRuntime<infer S, any> ? S : never;
  const run = async <A>(key: string, program: Effect.Effect<A, AppError, R>): Promise<A | undefined> => {
    if (controllers.has(key) || disposed) return;
    const controller = new AbortController();
    controllers.set(key, controller);
    patch({ busy: [...model().busy, key], error: '' });
    try {
      const exit = await runtime.runPromiseExit(program, { signal: controller.signal });
      if (Exit.isSuccess(exit)) return exit.value;
      if (!controller.signal.aborted) {
        const detail = Cause.squash(exit.cause);
        patch({ error: detail instanceof AppError ? detail.message : 'The request could not finish. Please try again.' });
      }
    } finally {
      controllers.delete(key);
      patch({ busy: model().busy.filter(item => item !== key) });
    }
  };
  let searchVersion = 0;
  const search = async (query: string, source: string) => {
    const version = ++searchVersion;
    for (const [key, controller] of controllers) if (key.startsWith('search-')) controller.abort();
    patch({ searchEntries: undefined, searchStatus: query.trim() ? 'Searching online…' : '' });
    if (!query.trim()) return;
    const result = await run(`search-${version}`, Effect.gen(function* () {
      return yield* (yield* Catalog).search(query.trim(), source);
    }));
    if (version !== searchVersion) return;
    if (result) patch({ searchEntries: result.warnings.length ? CatalogMerge([...result.entries, ...model().catalog]) : result.entries,
      searchStatus: result.warnings.length ? `Cached results included · ${result.warnings.join(' ')}` : `Online results · ${source === 'nix' ? 'Nix' : source.startsWith('brew') ? 'Homebrew' : 'Homebrew / Nix'}${source === 'all' || source === 'nix' ? ' · Up to 200 Nix matches' : ''}` });
    else patch({ searchStatus: 'Online search unavailable · Showing cached results' });
  };
  const refreshCatalog = async (source: 'brew' | 'nix') => {
    const catalog = await run(`catalog-${source}`, Effect.gen(function* () {
      const service = yield* Catalog;
      yield* source === 'brew' ? service.refreshBrew : service.refreshNix;
      return yield* service.load;
    }));
    if (catalog) patch({ catalog, message: `${source === 'brew' ? 'Homebrew' : 'Nix'} catalog refreshed. ${catalog.length.toLocaleString()} packages available.` });
  };
  const refreshInventory = async () => {
    const result = await run('inventory', Effect.gen(function* () {
      const tools = yield* (yield* Discovery).check;
      const installed: InstalledPackage[] = [];
      const warnings: string[] = [];
      if (tools.brew.path && !tools.brew.problem) {
        const result = yield* (yield* BrewClient).installed.pipe(Effect.result);
        if (result._tag === 'Success') installed.push(...result.success); else warnings.push(result.failure.message);
      }
      if (tools.nix.path && !tools.nix.problem) {
        const result = yield* (yield* NixClient).installed.pipe(Effect.result);
        if (result._tag === 'Success') installed.push(...result.success); else warnings.push(result.failure.message);
      }
      return { tools, installed, warnings };
    }));
    if (result) patch({ tools: result.tools, installed: result.installed, error: result.warnings.join(' ') });
  };
  const checkUpdates = async () => {
    const updates = await run('updates', Effect.gen(function* () {
      const tools = yield* (yield* Discovery).check;
      const brew = tools.brew.path ? yield* (yield* BrewClient).outdated : [];
      const nix = model().installed.filter(p => p.manager === 'nix' && !p.declared).flatMap(p => {
        const current = model().catalog.flatMap(c => c.sources).find(s => s.manager === 'nix' && s.identifier === p.identifier);
        return current && current.version !== p.version ? [{ ...p, latest: current.version, outdated: true }] : [];
      });
      return [...brew, ...nix];
    }));
    if (updates) patch({ updates, updatesChecked: true, message: 'Update check complete. Nix comparisons use the saved catalog; refresh it for current versions.' });
  };
  const saveSettings = async (change: Partial<Preferences>) => {
    const settings = { ...model().settings, ...change };
    const saved = await run('settings', Effect.gen(function* () { yield* (yield* Settings).save(settings); return settings; }));
    if (saved) patch({ settings: saved });
  };
  const prepare = async (pkg: CatalogEntry, source: PackageSource, action: Plan['action'], existing?: InstalledPackage) => {
    return run('plan', Effect.gen(function* () {
      const tools = yield* (yield* Discovery).check;
      if (existing?.declared) return yield* Effect.fail(new AppError({ message: 'This package belongs to a declarative configuration. Change that configuration instead.' }));
      const plan = yield* Effect.try({ try: () => makePlan(tools, source, action, existing?.profileName), catch: error => error as AppError });
      const conflict = conflicts(plan, model().installed);
      if (conflict.length) return yield* Effect.fail(new AppError({ message: conflict[0]! }));
      let checked = plan;
      if (source.manager === 'nix') checked = yield* (yield* NixClient).inspectPlan(plan);
      if (source.manager !== 'nix') {
        const info = yield* (yield* BrewClient).info(source);
        const cask = info.casks?.[0];
        const needsAdmin = !!cask?.artifacts?.some((a: Record<string, unknown>) => a.pkg || a.installer);
        const caveats = cask?.caveats;
        checked = { ...plan, needsAdmin, warnings: [...plan.warnings, ...(typeof caveats === 'string' ? [caveats] : [])] };
      }
      return checked;
    }));
  };
  const execute = async (plan: Plan) => {
    const id = crypto.randomUUID();
    let operation: Operation = { id, title: plan.title, plan, state: 'queued', startedAt: new Date().toISOString(), logs: '' };
    const publish = () => patch({ operations: [operation, ...model().operations.filter(o => o.id !== id)].slice(0, 100) });
    publish();
    let lastPaint = 0;
    await run(id, Effect.gen(function* () {
      const outcome = yield* (yield* Operations).execute(plan, text => {
        operation = { ...operation, logs: (operation.logs + text).slice(-65536) };
        if (Date.now() - lastPaint > 100) { publish(); lastPaint = Date.now(); }
      }, () => { if (operation.state === 'running') { operation = transition(operation, 'needs-admin'); publish(); } }, () => { operation = transition(operation, 'running'); publish(); }).pipe(Effect.result);
      operation = transition(operation, outcome._tag === 'Success' ? 'succeeded' : 'failed', outcome._tag === 'Failure' ? outcome.failure.message : 'Finished successfully.');
      publish();
      yield* (yield* Storage).write('operations', model().operations);
    }));
    if (operation.state === 'running' || operation.state === 'needs-admin' || operation.state === 'queued') {
      operation = transition(operation, 'cancelled', 'Cancelled. Refresh Installed to check for partial changes.'); publish();
      await run('save-operations', Effect.gen(function* () { yield* (yield* Storage).write('operations', model().operations); }));
    }
    await refreshInventory();
  };
  const history = async () => {
    const value = await run('history', Effect.gen(function* () { return yield* (yield* NixClient).history; }));
    if (value !== undefined) patch({ history: value });
  };
  const maintenance = async (task: 'gc' | 'relink' | 'clear' | 'rollback', generation?: number) => {
    const result = await run('maintenance', Effect.gen(function* () {
      if (task === 'clear') yield* (yield* Catalog).clear;
      else {
        const nix = yield* NixClient;
        yield* task === 'gc' ? nix.gc : task === 'rollback' ? nix.rollback(generation ?? 0) : nix.relink;
      }
      return true;
    }));
    if (result) {
      patch({ message: `${task} completed.`, ...(task === 'clear' ? { catalog: [] } : {}) });
      await refreshInventory();
      if (task === 'rollback') await history();
    }
  };
  const copy = async (text: string) => {
    await run('clipboard', Effect.gen(function* () {
      const shell = yield* Shell;
      // AppleScript receives text as a literal, never an executable shell fragment.
      const result = yield* shell.run({ executable: '/usr/bin/osascript', args: ['-e', `set the clipboard to ${JSON.stringify(text)}`] });
      if (result.code !== 0) return yield* Effect.fail(new AppError({ message: 'Could not copy to the clipboard.' }));
    }));
  };
  const openHomepage = async (url?: string) => {
    if (!url || !/^https?:\/\//.test(url)) return;
    await run('homepage', Effect.gen(function* () {
      yield* (yield* Shell).run({ executable: '/usr/bin/open', args: [url], timeoutMs: 15000 });
    }));
  };
  const setup = async (manager: 'nix' | 'brew', repair = false) => {
    patch({ setupLog: '' });
    const tools = await run('setup', Effect.gen(function* () {
      return yield* (yield* Onboarding).setup(manager, repair, text => patch({ setupLog: (model().setupLog + text).slice(-65536) }));
    }));
    if (tools) { patch({ tools, message: 'Source setup verified.' }); await refreshInventory(); }
  };
  onMount(() => {
    if (!start) return;
    void (async () => {
      const initial = await run('startup', Effect.gen(function* () {
        const settings = yield* (yield* Settings).load;
        const catalog = yield* (yield* Catalog).load;
        const operations = yield* (yield* Storage).read<Operation[]>('operations', []);
        const snapshot = yield* (yield* Storage).read<{ refreshedAt: string } | null>('catalog-brew', null);
        const stale = !snapshot || Date.now() - Date.parse(snapshot.refreshedAt) > 24 * 60 * 60 * 1000;
        const nixSnapshot = yield* (yield* Storage).read<{ refreshedAt: string } | null>('catalog-nix', null);
        const nixStale = !nixSnapshot || Date.now() - Date.parse(nixSnapshot.refreshedAt) > 24 * 60 * 60 * 1000;
        return { settings, catalog, stale, nixStale, operations: operations.slice(0, 100).map(o => ['running', 'queued', 'needs-admin'].includes(o.state) ? { ...o, state: 'failed' as const, message: 'The app closed during this operation. Refresh Installed before retrying.' } : o) };
      }));
      if (initial) patch({ settings: initial.settings, catalog: initial.catalog, operations: initial.operations });
      await refreshInventory();
      if (initial?.settings.refreshOnLaunch && initial.stale && !initial.settings.skippedBrew) void refreshCatalog('brew');
      if (initial?.settings.refreshOnLaunch && initial.nixStale && !initial.settings.skippedNix) void refreshCatalog('nix');
    })();
  });
  onCleanup(() => { disposed = true; controllers.forEach(c => c.abort()); });
  return { model, patch, search, refreshCatalog, refreshInventory, checkUpdates, saveSettings, prepare, execute, history, maintenance, copy, openHomepage, setup,
    appUpdate: async (install = false) => {
      const message = await run('app-update', Effect.gen(function* () { const updater = yield* Updater; return yield* install ? updater.install : updater.check; }));
      if (message) patch({ message });
    },
    icon: (homepage: string) => run('icon', Effect.gen(function* () { return yield* (yield* Icons).favicon(homepage); })),
    cancel: (id: string) => controllers.get(id)?.abort(),
  };
}
