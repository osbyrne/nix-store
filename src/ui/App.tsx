import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Button, Dialog, DialogBackdrop, DialogPopup, DialogPortal, createWindowSize, createTextSearch, useGpuixRequired } from '@gpuix/solid';
import { makeAppRuntime, type AppRuntime } from '../app/runtime';
import { createController, type Model } from '../app/controller';
import { createRuntimeResource } from '../app/bridge';
import { readFoundation } from '../services/Foundation';
import { preferredSource, searchCatalog, type CatalogEntry } from '../services/Catalog';
import { type InstalledPackage, type Plan } from '../services/Managers';
import { displayCommand } from '../services/Platform';
import { darkTheme, lightTheme, props } from './styles';
import { layout as s, palette } from './app-styles';
import { workspace as w } from './workspace-styles';
import type { PackageSource } from '../domain/package';

import { Text } from './Text';
import { createSystemAppearance } from './system-appearance';
const navigation = [{ name: 'Discover', icon: '⌕' }, { name: 'Installed', icon: '▦' }, { name: 'Updates', icon: '↓' }, { name: 'Activity', icon: '◷' }, { name: 'Settings', icon: '⚙' }] as const;
type Screen = typeof navigation[number]['name'];
const label = (manager: string) => manager === 'nix' ? 'Nix' : manager === 'brew-cask' ? 'Homebrew cask' : 'Homebrew formula';
interface Confirmation { title: string; description: string; commands?: readonly string[]; confirm: () => void }
export function App(options: { runtime?: AppRuntime; start?: boolean; initial?: Partial<Model> } = {}) {
  const runtime = options.runtime ?? makeAppRuntime();
  if (!options.runtime) onCleanup(() => { void runtime.dispose(); });
  const status = createRuntimeResource(runtime, readFoundation);
  const controller = createController(runtime, options.start !== false, options.initial);
  const m = controller.model;
  const [screen, setScreen] = createSignal<Screen>('Discover');
  const [query, setQuery] = createSignal('');
  const [kind, setKind] = createSignal('all');
  const [source, setSource] = createSignal('all');
  const [selected, setSelected] = createSignal<CatalogEntry>();
  const [selectedIcon, setSelectedIcon] = createSignal<string>();
  const [selectedSource, setSelectedSource] = createSignal<PackageSource>();
  const [confirmation, setConfirmation] = createSignal<Confirmation>();
  const [startIndex, setStartIndex] = createSignal(0);
  const [generation, setGeneration] = createSignal('');
  const [logQuery, setLogQuery] = createSignal('');
  const appearance = createSystemAppearance();
  const theme = createMemo(() => palette(appearance() === 'dark' ? darkTheme : lightTheme));
  const size = createWindowSize();
  const renderer = useGpuixRequired();
  const logSearch = createTextSearch(() => ({ query: logQuery() }));
  let searchInput: { id: number } | undefined;
  const platform = createMemo(() => m().tools?.platform ?? (process.arch === 'arm64' ? 'aarch64-darwin' : 'x86_64-darwin'));
  const catalog = createMemo(() => m().catalog);
  const results = createMemo(() => searchCatalog(query().trim() ? (m().searchEntries ?? catalog()) : catalog(), query(), kind(), source(), platform()));
  const visibleInstalled = createMemo(() => (screen() === 'Updates' ? m().updates : m().installed).filter(p => `${p.name} ${p.identifier}`.toLowerCase().includes(query().toLowerCase())));
  createEffect(() => { query(); kind(); source(); screen(); setStartIndex(0); });
  createEffect(() => {
    const text = query(); const selectedSource = source(); const discover = screen() === 'Discover';
    if (options.start === false || !discover) return;
    const timer = setTimeout(() => { void controller.search(text, selectedSource); }, 350);
    onCleanup(() => { clearTimeout(timer); });
  });
  const busy = (key: string) => m().busy.includes(key);
  const navigate = (value: Screen) => { setScreen(value); setSelected(undefined); setQuery(''); if (value === 'Updates') void controller.checkUpdates(); };
  const openPackage = (pkg: CatalogEntry) => { setSelected(pkg); setSelectedIcon(undefined); if (pkg.homepage) void controller.icon(pkg.homepage).then(icon => { if (selected()?.id === pkg.id) setSelectedIcon(icon); }); setSelectedSource(preferredSource(pkg, m().settings.source, platform())); };
  const installedFor = (pkg: CatalogEntry, manager?: string) => m().installed.find(i => (!manager || i.manager === manager) && pkg.sources.some(s => s.manager === i.manager && s.identifier === i.identifier));
  const planAction = async (pkg: CatalogEntry, chosen: PackageSource | undefined, action: Plan['action'], installed?: InstalledPackage) => {
    if (!chosen) return;
    const plan = await controller.prepare(pkg, chosen, action, installed);
    if (plan) setConfirmation({ title: plan.title, description: [
      ...plan.warnings,
      plan.download === 'build' ? 'Source build required.' : plan.download === 'binary' ? 'Nix expects cached downloads or already available store paths.' : 'Download/build requirements are determined by the package manager.',
      ...(plan.needsAdmin ? ['A visible Mac administrator prompt will appear. Cancel it to decline.'] : []),
    ].join('\n\n'), commands: plan.commands.map(displayCommand), confirm: () => { navigate('Activity'); void controller.execute(plan); } });
  };
  const inventoryAction = (item: InstalledPackage, action: Plan['action']) => {
    const pkg = m().catalog.find(p => p.sources.some(s => s.manager === item.manager && s.identifier === item.identifier)) ?? {
      id: item.id, key: item.identifier, name: item.name, description: '', kind: item.manager === 'brew-cask' ? 'gui' as const : 'cli' as const,
      aliases: [], sources: [{ manager: item.manager, identifier: item.identifier, version: item.version, platforms: [platform()] }],
    };
    void planAction(pkg, pkg.sources.find(s => s.manager === item.manager), action, item);
  };
  const Action = (p: { children: JSX.Element; onClick: () => void; id?: string; active?: boolean; disabled?: boolean }) => (
    <Button testId={p.id} disabled={p.disabled} onClick={p.onClick} {...props(w.button, theme().panel, theme().nav, p.active && theme().selected, p.disabled && w.disabled)}>
      <Text {...props(s.small, p.active ? theme().accent : theme().text)}>{p.children}</Text>
    </Button>
  );
  const Notice = (p: { children: JSX.Element }) => <div {...props(s.notice, theme().selected)}><Text {...props(w.note, theme().text)}>{p.children}</Text></div>;
  return (
    <div testId="app" {...props(s.root, theme().canvas)} onKeyDown={event => {
      if (event.modifiers?.cmd && event.key?.toLowerCase() === 'k') {
        event.preventDefault(); navigate('Discover');
        queueMicrotask(() => { if (searchInput) renderer.focusElement?.(searchInput.id); });
      }
    }}>
      <div {...props(s.sidebar, size().width < 1000 && w.compactSidebar, theme().sidebar)}>
        <Text {...props(s.brand, theme().text)}>Nixstore</Text>
        <Text {...props(s.subtitle, theme().muted)}>Software, made simple.</Text>
        <For each={navigation}>{item => <Button testId={`nav-${item.name.toLowerCase()}`} aria-label={item.name} onClick={() => navigate(item.name)} {...props(s.nav, theme().nav, screen() === item.name && theme().selected)}>
          <Text {...props(s.glyph, screen() === item.name ? theme().accent : theme().muted)}>{item.icon}</Text>
          <Text {...props(s.navText, screen() === item.name ? theme().accent : theme().text)}>{item.name}</Text>
        </Button>}</For>
        <div {...props(s.spacer)} />
        <Text {...props(s.footnote, theme().subtle)}>Built for your Mac</Text>
        <Text {...props(s.footnote, theme().subtle)}>{m().catalog.length.toLocaleString()} packages cached</Text>
      </div>
      <div {...props(s.main)}>
        <div {...props(s.toolbar, theme().border)}>
          <Text {...props(s.toolbarText, theme().muted)}>{selected() ? 'Package details' : screen()}</Text>
          <Text testId="runtime-status" {...props(s.small, theme().accent)}>{m().busy.length ? `${m().busy.length} task${m().busy.length > 1 ? 's' : ''} running` : status().state === 'ready' ? 'Native runtime ready' : 'Starting runtime…'}</Text>
        </div>
        <div {...props(w.body)}>
          <Show when={m().error}><Notice>{m().error}</Notice></Show>
          <Show when={m().message && !m().error}><Text {...props(w.note, theme().muted)}>{m().message}</Text></Show>
          <Show when={screen() === 'Discover' && !selected()}>
            <div {...props(s.hero)}>
              <Text {...props(s.eyebrow, theme().accent)}>Your software, together.</Text>
              <Text {...props(w.heading, size().width < 1000 && w.compactHeading, theme().text)}>Make room for possibility.</Text>
            </div>
          </Show>
          <Show when={['Discover', 'Installed', 'Updates'].includes(screen()) && !selected()}>
            <div {...props(s.searchBox, theme().panel)}>
              <Text {...props(s.glyph, theme().subtle)}>⌕</Text>
              <input ref={node => { searchInput = node; }} testId="search" aria-label="Search software" placeholder="Search apps and command-line tools" value={query()} onChange={event => setQuery(event.value ?? '')} {...props(s.search, theme().search)} />
              <Text {...props(s.small, theme().subtle)}>⌘K</Text>
            </div>
          </Show>
          <Show when={screen() === 'Discover' && !selected()}>
            <div {...props(w.wrap)}>
              <For each={['all', 'gui', 'cli']}>{value => <Action active={kind() === value} onClick={() => setKind(value)}>{value === 'all' ? 'All software' : value === 'gui' ? 'Mac apps' : 'Command-line tools'}</Action>}</For>
              <For each={['all', 'nix', 'brew-cask', 'brew-formula']}>{value => <Action active={source() === value} onClick={() => setSource(value)}>{value === 'all' ? 'All sources' : label(value)}</Action>}</For>
            </div>
            <div {...props(w.row)}>
              <Text testId="search-preview" {...props(s.small, theme().muted)}>{results().length.toLocaleString()} results{query() ? ` for “${query()}”` : ''} · {m().searchStatus || 'Type to search online'}</Text>
              <div {...props(s.spacer)} />
              <Action id="refresh-brew" disabled={busy('catalog-brew')} onClick={() => { void controller.refreshCatalog('brew'); }}>Refresh Homebrew</Action>
              <Action id="refresh-nix" disabled={busy('catalog-nix')} onClick={() => { void controller.refreshCatalog('nix'); }}>Refresh Nix</Action>
              <Show when={busy('catalog-nix')}><Action onClick={() => controller.cancel('catalog-nix')}>Cancel</Action></Show>
            </div>
            <Show when={m().tools && ((!m().tools?.nix.version && !m().settings.skippedNix) || (!m().tools?.brew.version && !m().settings.skippedBrew))}><Notice>Welcome to Nixstore. One or more software sources need setup. Open Settings to install them with a visible administrator prompt, or skip either source.</Notice><Action onClick={() => navigate('Settings')}>Set up software sources</Action></Show>
            <Show when={!m().catalog.length}><Notice>Refresh a source to download its catalog. The first Nix catalog refresh can take a minute or two; browsing does not require Nix to be installed. You can keep using the app while it runs.</Notice></Show>
            <virtual-list testId="results" itemCount={results().length} windowStart={startIndex()} estimatedItemHeight={92} onVisibleRange={event => setStartIndex(Math.max(0, Math.floor(event.startIndex ?? 0) - 10))} {...props(w.list)}>
              <For each={results().slice(startIndex(), startIndex() + 60)}>{pkg => <div testId={`package-row-${pkg.key}`} {...props(w.item, theme().border)}>
                <div {...props(w.avatar, theme().selected)}><Text {...props(w.letter, theme().accent)}>{pkg.name.slice(0, 1).toUpperCase()}</Text></div>
                <div {...props(w.itemMain)}>
                  <Text testId={`package-name-${pkg.key}`} {...props(w.name, theme().text)}>{pkg.name}</Text>
                  <Text testId={`package-description-${pkg.key}`} {...props(w.description, theme().muted)}>{pkg.description}</Text>
                  <Text testId={`package-meta-${pkg.key}`} {...props(w.badge, theme().subtle)}>{pkg.kind === 'gui' ? 'Mac app' : 'CLI tool'} · {pkg.sources.map(s => `${label(s.manager)} ${s.version}`).join(' · ')}</Text>
                </div>
                <Action id={`detail-${pkg.key}`} onClick={() => openPackage(pkg)}>Details</Action>
              </div>}</For>
            </virtual-list>
          </Show>
          <Show when={selected()}>{pkg => <div {...props(w.scroll)}>
            <div {...props(w.row)}><Action id="back" onClick={() => setSelected(undefined)}>Back to search</Action></div>
            <div {...props(w.detail, theme().panel)}>
              <div {...props(w.row)}><Show when={selectedIcon()} fallback={<div {...props(w.avatar, theme().selected)}><Text {...props(w.letter, theme().accent)}>{pkg().name.slice(0, 1).toUpperCase()}</Text></div>}>{icon => <img objectFit="contain" src={icon()} {...props(w.avatar)} />}</Show><Text {...props(w.heading, size().width < 1000 && w.compactHeading, theme().text)}>{pkg().name}</Text></div>
              <Text {...props(s.paragraph, theme().muted)}>{pkg().description}</Text>
              <Text {...props(s.sectionTitle, theme().text)}>Available from</Text>
              <For each={pkg().sources}>{choice => <Action active={selectedSource()?.manager === choice.manager && selectedSource()?.identifier === choice.identifier} disabled={!choice.platforms.includes(platform())} onClick={() => setSelectedSource(choice)}>{label(choice.manager)} · {choice.version} · {choice.platforms.includes(platform()) ? 'For this Mac architecture' : 'Other Mac architecture'}</Action>}</For>
              <Text {...props(w.note, theme().muted)}>Default policy: Mac apps use Homebrew casks; command-line tools use Nix. Change your preference in Settings.</Text>
              <Show when={installedFor(pkg(), selectedSource()?.manager)} fallback={<Action id="install" disabled={busy('plan') || !selectedSource()} onClick={() => { void planAction(pkg(), selectedSource(), 'install'); }}>{busy('plan') ? 'Checking what will happen…' : 'Install'}</Action>}>{installed => <div {...props(w.wrap)}>
                <Text {...props(w.note, theme().accent)}>Installed · {installed().version}</Text>
                <Action id="remove" disabled={busy('plan') || installed().declared} onClick={() => { void planAction(pkg(), selectedSource(), 'remove', installed()); }}>Remove</Action>
                <Action disabled={busy('plan') || installed().declared} onClick={() => { void planAction(pkg(), selectedSource(), 'upgrade', installed()); }}>Update</Action>
              </div>}</Show>
              <div {...props(w.wrap)}><Action onClick={() => { void controller.openHomepage(pkg().homepage); }}>Homepage</Action>
                <Action id="copy-command" onClick={() => {
                  const choice = selectedSource(); const tools = m().tools;
                  if (choice && tools) { const path = choice.manager === 'nix' ? tools.nix.path : tools.brew.path;
                    if (path) void controller.copy(displayCommand({ executable: path, args: choice.manager === 'nix' ? ['--extra-experimental-features', 'nix-command flakes', 'profile', 'install', `github:NixOS/nixpkgs/nixpkgs-unstable#${choice.identifier}`] : ['install', choice.manager === 'brew-cask' ? '--cask' : '--formula', choice.identifier] }));
                  }
                }}>Copy equivalent command</Action></div>
              <Notice>Before changing anything, Nixstore shows the exact commands and any known build or administrator requirements.</Notice>
            </div>
          </div>}</Show>
          <Show when={screen() === 'Installed' || screen() === 'Updates'}>
            <div {...props(w.wrap)}>
              <Text {...props(s.sectionTitle, theme().text)}>{screen() === 'Updates' ? m().updatesChecked ? `${visibleInstalled().length} available updates` : 'Checking for updates…' : `${visibleInstalled().length} installed packages`}</Text>
              <Action disabled={busy('updates') || busy('inventory')} onClick={() => { void (screen() === 'Updates' ? controller.checkUpdates() : controller.refreshInventory()); }}>Refresh</Action>
              <Show when={screen() === 'Installed'}><Action onClick={() => { void controller.history(); }}>History</Action></Show>
              <Show when={screen() === 'Updates' && m().updates.length}><Action disabled={busy('plan')} onClick={() => {
                void (async () => {
                  const plans: Plan[] = [];
                  for (const item of m().updates.filter(p => !p.declared)) {
                    const pkg = m().catalog.find(p => p.sources.some(s => s.manager === item.manager && s.identifier === item.identifier));
                    if (!pkg) { controller.patch({ error: `Refresh the catalog before updating ${item.name}.` }); return; }
                    const choice = pkg.sources.find(s => s.manager === item.manager)!;
                    const plan = await controller.prepare(pkg, choice, 'upgrade', item);
                    if (!plan) return;
                    plans.push(plan);
                  }
                  setConfirmation({ title: `Update ${plans.length} packages`, description: [...new Set(plans.flatMap(p => p.warnings))].join('\n\n') || 'Packages update in sequence. You can cancel queued or running operations in Activity.', commands: plans.flatMap(p => p.commands.map(displayCommand)), confirm: () => { navigate('Activity'); for (const plan of plans) void controller.execute(plan); } });
                })();
              }}>Update all</Action></Show>
            </div>
            <Show when={m().tools?.declarative.length}><Notice>Detected {m().tools?.declarative.join(', ')}. Nixstore manages imperative profile entries only. Declared packages must be changed in their configuration.</Notice></Show>
            <Show when={m().history && screen() === 'Installed'}><Action onClick={() => setConfirmation({ title: 'Nix history', description: m().history, confirm: () => {} })}>View loaded history</Action></Show>
            <virtual-list itemCount={visibleInstalled().length} windowStart={startIndex()} estimatedItemHeight={92} onVisibleRange={e => setStartIndex(Math.max(0, (e.startIndex ?? 0) - 10))} {...props(w.list)}>
              <For each={visibleInstalled().slice(startIndex(), startIndex() + 60)}>{item => <div {...props(w.item, theme().border)}>
                <div {...props(w.itemMain)}><Text {...props(w.name, theme().text)}>{item.name}</Text><Text {...props(w.badge, theme().muted)}>{label(item.manager)} · {m().operations.some(o => o.state === 'succeeded' && o.plan.action === 'install' && o.plan.manager === item.manager && o.plan.identifier === item.identifier) ? 'Installed with Nixstore' : 'Detected existing'} · {item.version}{item.latest ? ` → ${item.latest}` : ''}{item.declared ? ' · Declared (read only)' : ''}</Text></div>
                <Action disabled={busy('plan') || item.declared} onClick={() => inventoryAction(item, screen() === 'Updates' ? 'upgrade' : 'remove')}>{screen() === 'Updates' ? 'Update' : 'Remove'}</Action>
              </div>}</For>
            </virtual-list>
          </Show>
          <Show when={screen() === 'Activity'}>
            <Text {...props(w.heading, size().width < 1000 && w.compactHeading, theme().text)}>Every step, in view.</Text>
            <input aria-label="Find in activity logs" placeholder="Find in logs" value={logQuery()} onChange={e => setLogQuery(e.value ?? '')} {...props(s.search, theme().search)} />
            <div {...logSearch.props} {...props(w.scroll)}>
              <Show when={!m().operations.length}><Notice>No package operations yet. Catalog downloads and inventory checks do not change your installed software.</Notice></Show>
              <For each={m().operations}>{operation => <div {...props(w.detail, theme().panel)}>
                <div {...props(w.row)}><Text {...props(w.name, theme().text)}>{operation.title} · {operation.state === 'needs-admin' ? 'Waiting for administrator' : operation.state}</Text>
                  <Show when={['running', 'queued', 'needs-admin'].includes(operation.state)}><Action onClick={() => controller.cancel(operation.id)}>Cancel</Action></Show></div>
                <Text {...props(w.note, theme().muted)}>{operation.message ?? operation.startedAt}</Text>
                <Show when={m().settings.showCommands}><For each={operation.plan.commands}>{command => <Text {...props(w.log, theme().muted)}>{displayCommand(command)}</Text>}</For></Show>
                <Text {...props(w.log, theme().text)}>{operation.logs || 'Waiting for output…'}</Text>
              </div>}</For>
            </div>
          </Show>
          <Show when={screen() === 'Settings'}>
            <div {...props(w.scroll)}>
              <Text {...props(s.sectionTitle, theme().text)}>Preferred source</Text>
              <div {...props(w.wrap)}><For each={['automatic', 'nix', 'brew'] as const}>{value => <Action active={m().settings.source === value} onClick={() => { void controller.saveSettings({ source: value }); }}>{value === 'automatic' ? 'Automatic' : value === 'nix' ? 'Prefer Nix' : 'Prefer Homebrew'}</Action>}</For></div>
              <Action onClick={() => { void controller.saveSettings({ refreshOnLaunch: !m().settings.refreshOnLaunch }); }}>Background catalog refresh: {m().settings.refreshOnLaunch ? 'On' : 'Off'}</Action>
              <Action onClick={() => { void controller.saveSettings({ showCommands: !m().settings.showCommands }); }}>Show commands in Activity: {m().settings.showCommands ? 'On' : 'Off'}</Action>
              <Text {...props(s.sectionTitle, theme().text)}>Sources</Text>
              <Text {...props(w.note, theme().muted)}>Nix: {m().tools?.nix.version ?? m().tools?.nix.problem ?? 'Not detected'}{m().tools?.nix.path ? ` · ${m().tools?.nix.path}` : ''}</Text>
              <Text {...props(w.note, theme().muted)}>Homebrew: {m().tools?.brew.version ?? m().tools?.brew.problem ?? 'Not detected'}{m().tools?.brew.path ? ` · ${m().tools?.brew.path}` : ''}</Text>
              <Action onClick={() => { void controller.refreshInventory(); }}>Recheck sources</Action>
              <Text {...props(s.sectionTitle, theme().text)}>Nixstore updates</Text>
              <div {...props(w.wrap)}><Action onClick={() => { void controller.appUpdate(); }}>Check for app updates</Action><Action onClick={() => setConfirmation({ title: 'Install Nixstore update', description: 'The updater verifies the download signature before replacing the app. Quit and reopen Nixstore after installation.', confirm: () => { void controller.appUpdate(true); } })}>Install downloaded update</Action></div>
              <Text {...props(s.sectionTitle, theme().text)}>Storage and history</Text><Show when={busy('maintenance')}><Action onClick={() => controller.cancel('maintenance')}>Cancel maintenance</Action></Show>
              <div {...props(w.wrap)}><Action onClick={() => { void controller.maintenance('relink'); }}>Relink Nix apps</Action>
                <Action onClick={() => setConfirmation({ title: 'Collect unused Nix store paths', description: 'This removes unreferenced store paths. Profile generations are retained. Packages currently in use are not removed.', confirm: () => { void controller.maintenance('gc'); } })}>Garbage collection</Action>
                <Action onClick={() => setConfirmation({ title: 'Clear catalog cache', description: 'Saved catalog results will be cleared. Online search remains available. Installed software will stay on your Mac.', confirm: () => { void controller.maintenance('clear'); } })}>Clear catalog cache</Action></div>
              <div {...props(w.row)}><input aria-label="Nix generation number" placeholder="Generation" value={generation()} onChange={e => setGeneration(e.value ?? '')} {...props(w.input, theme().search)} />
                <Action onClick={() => setConfirmation({ title: 'Roll back the Nix profile', description: `Restore imperative profile generation ${generation()}. Review Installed → History first.`, confirm: () => { void controller.maintenance('rollback', Number(generation())); } })}>Roll back</Action></div>
              <For each={['nix', 'brew'] as const}>{manager => <div {...props(w.wrap)}>
                <Action disabled={busy('setup')} onClick={() => setConfirmation({ title: `${m().tools?.[manager].version ? 'Check / repair' : 'Set up'} ${manager === 'nix' ? 'Nix' : 'Homebrew'}`, description: manager === 'nix' ? 'Nix gives you reproducible packages and rollback history. Setup uses the Determinate Nix installer and requires administrator authorization. A healthy existing Nix installation is kept. Repair may rerun the installer to restore mounts after a macOS update.' : 'Homebrew provides Mac apps and CLI tools. Setup runs the official Homebrew installer as your user, with visible administrator password prompts. Apple command-line tools may need a separate macOS installation prompt.', commands: [manager === 'nix' ? 'Download https://install.determinate.systems/nix; run /bin/bash installer.sh install --no-confirm (administrator)' : 'Download https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh; run NONINTERACTIVE=1 /bin/bash installer.sh'], confirm: () => { void controller.setup(manager, !!m().tools?.[manager].path); } })}>{m().tools?.[manager].version ? 'Check / repair' : 'Set up'} {manager === 'nix' ? 'Nix' : 'Homebrew'}</Action>
                <Show when={!m().tools?.[manager].version}><Action onClick={() => { void controller.saveSettings(manager === 'nix' ? { skippedNix: true } : { skippedBrew: true }); }}>Skip {manager === 'nix' ? 'Nix' : 'Homebrew'}</Action></Show>
              </div>}</For>
              <Show when={m().setupLog}><Text {...props(w.log, theme().text)}>{m().setupLog}</Text></Show>
              <Show when={busy('setup')}><Action onClick={() => controller.cancel('setup')}>Cancel setup</Action></Show>
              <Notice>Nixstore never manages nix-darwin or Home Manager declarations. Sources are rechecked at launch, including after macOS updates.</Notice>
            </div>
          </Show>
        </div>
      </div>
      <Dialog open={!!confirmation()} onOpenChange={open => { if (!open) setConfirmation(undefined); }}>
        <DialogPortal><DialogBackdrop {...props(w.backdrop)} /><DialogPopup aria-label={confirmation()?.title ?? 'Confirm operation'} {...props(w.popup, theme().panel)}>
          <Text {...props(s.sectionTitle, theme().text)}>{confirmation()?.title}</Text>
          <div {...props(w.popupBody)}><Text {...props(w.note, theme().muted)}>{confirmation()?.description}</Text>
            <Show when={confirmation()?.commands?.length}><Text {...props(s.toolbarText, theme().text)}>What will happen</Text><For each={confirmation()?.commands}>{command => <Text {...props(w.log, theme().text)}>{command}</Text>}</For></Show>
          </div>
          <div {...props(w.row)}><Action id="confirm-operation" onClick={() => { const pending = confirmation(); setConfirmation(undefined); pending?.confirm(); }}>Continue</Action>
            <Action id="cancel-operation" onClick={() => setConfirmation(undefined)}>Cancel</Action>
            <Show when={confirmation()?.commands?.length}><Action onClick={() => { void controller.copy(confirmation()?.commands?.join('\n') ?? ''); }}>Copy commands</Action></Show></div>
        </DialogPopup></DialogPortal>
      </Dialog>
    </div>
  );
}
