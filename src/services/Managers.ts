import { Context, Effect, FileSystem, Layer, Stream } from 'effect';
import type { Manager, PackageSource } from '../domain/package';
import { AppError, Shell, Storage, dataRoot, displayCommand, failure, home, parseJson, type CommandSpec, type ProcessEvent } from './Platform';
import { Discovery, type DiscoveryResult } from './Discovery';
import { validIdentifier, type CatalogEntry } from './Catalog';

type Json = Record<string, any>;
export interface InstalledPackage {
  readonly id: string; readonly identifier: string; readonly name: string; readonly version: string;
  readonly manager: Manager; readonly paths: readonly string[]; readonly profileName?: string;
  readonly declared?: boolean; readonly outdated?: boolean; readonly latest?: string;
}
export interface Plan {
  readonly title: string; readonly manager: Manager; readonly action: 'install' | 'remove' | 'upgrade';
  readonly identifier: string; readonly commands: readonly CommandSpec[]; readonly warnings: readonly string[];
  readonly needsAdmin: boolean; readonly download: 'binary' | 'build' | 'unknown';
}
export const nixFlags = ['--extra-experimental-features', 'nix-command flakes'];
const nixRef = (id: string) => `github:NixOS/nixpkgs/nixpkgs-unstable#${id}`;
export function normalizeProfile(data: Json): InstalledPackage[] {
  return Object.entries(data.elements ?? {}).flatMap(([key, raw]) => {
    const entry = raw as Json;
    if (entry.active === false) return [];
    const identifier = String(entry.attrPath ?? key).replace(/^legacyPackages\.[^.]+\./, '');
    const path = entry.storePaths?.[0] ?? '';
    const stem = path.replace(/^.*\/[a-z0-9]+-/, '');
    const version = stem.match(/-([0-9][^-]*(?:-[^-]+)*)$/)?.[1] ?? 'unknown';
    return [{ id: `nix:${key}`, manager: 'nix' as const, identifier,
      name: identifier.split('.').at(-1) ?? key, version, paths: entry.storePaths ?? [], profileName: key,
      declared: /home-manager|darwin-system/.test(path),
    }];
  });
}
export function normalizeInstalledBrew(data: Json): InstalledPackage[] {
  return [
    ...(data.formulae ?? []).map((f: Json) => ({ id: `brew-formula:${f.full_name ?? f.name}`, manager: 'brew-formula' as const,
      identifier: f.full_name ?? f.name, name: f.name, version: f.installed?.map((i: Json) => i.version).join(', ') ?? 'unknown', paths: [], outdated: !!f.outdated,
    })),
    ...(data.casks ?? []).map((c: Json) => ({ id: `brew-cask:${c.full_token ?? c.token}`, manager: 'brew-cask' as const,
      identifier: c.full_token ?? c.token, name: c.name?.[0] ?? c.token, version: c.installed ?? c.version, paths: [], outdated: !!c.outdated,
    })),
  ];
}
export function makePlan(tools: DiscoveryResult, source: PackageSource, action: Plan['action'], profileName?: string): Plan {
  if (!validIdentifier(source.manager, source.identifier)) throw new AppError({ message: 'The package identifier is invalid. Refresh the catalog.' });
  const path = source.manager === 'nix' ? tools.nix.path : tools.brew.path;
  if (!path) throw new AppError({ message: `Set up ${source.manager === 'nix' ? 'Nix' : 'Homebrew'} first.` });
  const target = action !== 'install' && source.manager === 'nix' ? profileName : source.identifier;
  if (action !== 'install' && source.manager === 'nix' && (!target || !/^[\w.+-]+$/.test(target))) throw new AppError({ message: 'This Nix profile entry cannot be safely selected. It may be declaratively managed.' });
  const args = source.manager === 'nix'
    ? [...nixFlags, 'profile', action === 'upgrade' ? 'upgrade' : action, action === 'install' ? nixRef(source.identifier) : target!]
    : [action === 'remove' ? 'uninstall' : action, source.manager === 'brew-cask' ? '--cask' : '--formula', source.identifier];
  return { title: `${action === 'install' ? 'Install' : action === 'remove' ? 'Remove' : 'Update'} ${source.identifier}`,
    manager: source.manager, identifier: source.identifier, action,
    commands: [{ executable: path, args, timeoutMs: 1800000 }],
    warnings: source.manager === 'nix' ? ['Nix apps are linked into ~/Applications/Nix Apps. Apps in the immutable Nix store may be unable to save settings beside their executable.'] : [],
    needsAdmin: !!source.needsAdmin, download: 'unknown',
  };
}
export class BrewClient extends Context.Service<BrewClient, {
  readonly installed: Effect.Effect<InstalledPackage[], AppError>;
  readonly outdated: Effect.Effect<InstalledPackage[], AppError>;
  readonly info: (source: PackageSource) => Effect.Effect<Json, AppError>;
  readonly execute: (plan: Plan) => Stream.Stream<ProcessEvent, AppError>;
}>()('nixstore/BrewClient') {
  static readonly layer = Layer.effect(BrewClient, Effect.gen(function* () {
    const shell = yield* Shell;
    const discovery = yield* Discovery;
    const query = (args: string[]) => Effect.gen(function* () {
      const tools = yield* discovery.check;
      if (!tools.brew.path || tools.brew.problem) return yield* Effect.fail(new AppError({ message: 'Homebrew is unavailable. Use source setup in Settings.' }));
      const result = yield* shell.run({ executable: tools.brew.path, args, maxOutput: 32 * 1024 * 1024 });
      if (result.code !== 0) return yield* Effect.fail(new AppError({ message: 'Homebrew could not read its packages. Try refreshing or repairing Homebrew.', detail: result.stderr }));
      return yield* parseJson<Json>(result.stdout);
    });
    return {
      installed: query(['info', '--json=v2', '--installed']).pipe(Effect.map(normalizeInstalledBrew)),
      outdated: query(['outdated', '--json=v2']).pipe(Effect.map(data => [
        ...(data.formulae ?? []).map((f: Json) => ({ id: `brew-formula:${f.name}`, manager: 'brew-formula' as const, identifier: f.name, name: f.name, version: (f.installed_versions ?? []).join(', '), latest: f.current_version, outdated: true, paths: [] })),
        ...(data.casks ?? []).map((c: Json) => ({ id: `brew-cask:${c.name}`, manager: 'brew-cask' as const, identifier: c.name, name: c.name, version: String(c.installed_versions ?? ''), latest: c.current_version, outdated: true, paths: [] })),
      ])),
      info: source => validIdentifier(source.manager, source.identifier) ? query(['info', '--json=v2', source.manager === 'brew-cask' ? '--cask' : '--formula', source.identifier]) : Effect.fail(new AppError({ message: 'Invalid package identifier.' })),
      execute: plan => shell.stream(plan.commands[0]!),
    };
  }));
}

export class NixClient extends Context.Service<NixClient, {
  readonly installed: Effect.Effect<InstalledPackage[], AppError>;
  readonly history: Effect.Effect<string, AppError>;
  readonly inspectPlan: (plan: Plan) => Effect.Effect<Plan, AppError>;
  readonly execute: (plan: Plan) => Stream.Stream<ProcessEvent, AppError>;
  readonly rollback: (generation: number) => Effect.Effect<void, AppError>;
  readonly gc: Effect.Effect<void, AppError>;
  readonly relink: Effect.Effect<void, AppError>;
}>()('nixstore/NixClient') {
  static readonly layer = Layer.effect(NixClient, Effect.gen(function* () {
    const shell = yield* Shell;
    const discovery = yield* Discovery;
    const fs = yield* FileSystem.FileSystem;
    const storage = yield* Storage;
    const run = (args: string[], maxOutput = 4 * 1024 * 1024) => Effect.gen(function* () {
      const tools = yield* discovery.check;
      if (!tools.nix.path || tools.nix.problem) return yield* Effect.fail(new AppError({ message: 'Nix is unavailable. Check source setup or repair in Settings.' }));
      const result = yield* shell.run({ executable: tools.nix.path, args: [...nixFlags, ...args], maxOutput });
      if (result.code !== 0) return yield* Effect.fail(new AppError({ message: 'Nix could not finish. Check Activity for details. If the profile is declarative, change it in its configuration instead.', detail: result.stderr }));
      return result;
    });
    const installed = run(['profile', 'list', '--json']).pipe(Effect.flatMap(r => parseJson<Json>(r.stdout)), Effect.map(normalizeProfile));
    const detected = Effect.gen(function* () {
      const profile = yield* installed;
      const tools = yield* discovery.check;
      if (!tools.nix.path || !tools.declarative.length) return profile;
      const store = tools.nix.path.replace(/\/nix$/, '/nix-store');
      for (const root of ['/run/current-system/sw', `${home}/.local/state/nix/profiles/home-manager/home-path`, `${home}/.nix-profile/home-path`]) {
        if (!(yield* fs.exists(root))) continue;
        const result = yield* shell.run({ executable: store, args: ['--query', '--references', root], timeoutMs: 30000, maxOutput: 4 * 1024 * 1024 });
        if (result.code !== 0) continue;
        for (const path of result.stdout.trim().split('\n')) {
          const stem = path.replace(/^\/nix\/store\/[a-z0-9]+-/, '');
          const match = stem.match(/^(.+?)-([0-9].*)$/);
          if (!match || !path.startsWith('/nix/store/')) continue;
          profile.push({ id: `declared:${path}`, manager: 'nix', identifier: match[1]!, name: match[1]!, version: match[2]!, paths: [path], declared: true });
        }
      }
      return profile;
    }).pipe(Effect.mapError(failure('Could not inspect declared Nix packages.')));
    const relink = Effect.gen(function* () {
      const packages = yield* installed;
      const directory = `${home}/Applications/Nix Apps`;
      yield* fs.makeDirectory(directory, { recursive: true });
      const previous = yield* storage.read<Record<string, string>>('app-links', {});
      const next: Record<string, string> = {};
      for (const pkg of packages) for (const path of pkg.paths) {
        if (!path.startsWith('/nix/store/') || path.includes('..')) continue;
        for (const location of [`${path}/Applications`, `${path}/share/applications`]) {
          if (!(yield* fs.exists(location))) continue;
          for (const name of yield* fs.readDirectory(location)) {
            if (!name.endsWith('.app') || name.includes('/')) continue;
            const link = `${directory}/${name}`;
            const target = `${location}/${name}`;
            if (yield* fs.exists(link)) {
              const existing = yield* fs.readLink(link).pipe(Effect.catch(() => Effect.succeed('')));
              if (existing !== previous[link] && existing !== target) continue;
              if (existing !== target) { yield* fs.remove(link); yield* fs.symlink(target, link); }
            } else {
              // A broken app-owned symlink can still occupy the directory entry.
              const existing = yield* fs.readLink(link).pipe(Effect.catch(() => Effect.succeed('')));
              if (existing && existing !== previous[link]) continue;
              if (existing) yield* fs.remove(link);
              yield* fs.symlink(target, link);
            }
            next[link] = target;
          }
        }
      }
      for (const [link, target] of Object.entries(previous)) if (!next[link] && link.startsWith(`${directory}/`) && !link.slice(directory.length + 1).includes('/')) {
        const current = yield* fs.readLink(link).pipe(Effect.catch(() => Effect.succeed('')));
        if (current === target) yield* fs.remove(link, { force: true });
      }
      yield* storage.write('app-links', next);
    }).pipe(Effect.mapError(failure('The package changed, but its app shortcuts need repair. Use Relink Nix apps in Settings.')));
    return {
      installed: detected,
      history: run(['profile', 'history']).pipe(Effect.map(r => r.stdout || r.stderr)),
      inspectPlan: plan => plan.manager !== 'nix' || plan.action === 'remove' ? Effect.succeed(plan) : Effect.gen(function* () {
        const result = yield* run(plan.action === 'install' ? ['build', '--dry-run', '--json', nixRef(plan.identifier)] : [...plan.commands[0]!.args.slice(nixFlags.length), '--dry-run']);
        const logs = result.stderr + result.stdout;
        const build = /will be built|will be built:|derivations? to build/i.test(logs);
        const binary = /will be fetched|will be downloaded|paths? to fetch/i.test(logs);
        return { ...plan, download: build ? 'build' as const : binary || !logs.trim() ? 'binary' as const : 'unknown' as const,
          warnings: [...plan.warnings, ...(build ? ['This needs a source build. It may take a long time and use significant CPU and disk space.'] : [])] };
      }),
      execute: plan => shell.stream(plan.commands[0]!),
      rollback: generation => !Number.isSafeInteger(generation) || generation < 1 ? Effect.fail(new AppError({ message: 'Choose a valid history generation number.' })) : run(['profile', 'rollback', '--to', String(generation)]).pipe(Effect.flatMap(() => relink)),
      gc: run(['store', 'gc'], 65536).pipe(Effect.asVoid),
      relink,
    };
  }));
}
