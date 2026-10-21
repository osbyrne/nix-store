import { expect, test } from 'bun:test';
import { Effect, FileSystem, Layer, ManagedRuntime, Stream } from 'effect';
import { BrewClient, NixClient, makePlan, normalizeProfile } from '../src/services/Managers';
import { AppError, Shell, type CommandSpec } from '../src/services/Platform';
import { Discovery, type DiscoveryResult } from '../src/services/Discovery';
import { conflicts, transition, type Operation } from '../src/services/Operations';
import { memoryStorage } from './helpers';
const tools: DiscoveryResult = { nix: { path: '/nix/var/nix/profiles/default/bin/nix' }, brew: { path: '/opt/homebrew/bin/brew' }, declarative: [], platform: 'aarch64-darwin' };
const source = { manager: 'nix' as const, identifier: 'hello', version: '2', platforms: ['aarch64-darwin' as const] };
test('command planning selects explicit managers and preserves argv boundaries', () => {
  expect(makePlan(tools, source, 'install').commands[0]?.args.at(-1)).toBe('github:NixOS/nixpkgs/nixpkgs-unstable#hello');
  expect(makePlan(tools, { ...source, manager: 'brew-cask', identifier: 'firefox' }, 'remove').commands[0]?.args).toEqual(['uninstall', '--cask', 'firefox']);
  expect(() => makePlan(tools, { ...source, identifier: '--help' }, 'install')).toThrow();
  expect(() => makePlan(tools, source, 'remove', '.*')).toThrow();
});
test('normalizes profile entries and rejects declared package changes', () => {
  const inventory = normalizeProfile({ elements: { hello: { attrPath: 'legacyPackages.aarch64-darwin.hello', storePaths: ['/nix/store/abc-hello-2.12.3'] } } });
  expect(inventory[0]?.version).toBe('2.12.3');
  expect(conflicts(makePlan(tools, source, 'install'), inventory)[0]).toContain('already installed');
  expect(conflicts(makePlan(tools, source, 'install'), [{ ...inventory[0]!, declared: true }])[0]).toContain('declaratively');
});
test('terminal operation states cannot transition back to running', () => {
  const queued: Operation = { id: 'test', title: 'Install hello', plan: makePlan(tools, source, 'install'), state: 'queued', logs: '', startedAt: '' };
  const running = transition(queued, 'running');
  const finished = transition(running, 'succeeded');
  expect(() => transition(finished, 'running')).toThrow();
  expect(transition(running, 'cancelled').finishedAt).toBeDefined();
});
test('manager services consume fake Shell metadata and expose progress streams', async () => {
  const calls: CommandSpec[] = [];
  const fake = Layer.succeed(Shell, {
    run: spec => Effect.sync(() => {
      calls.push(spec);
      const stdout = spec.args.includes('list') ? JSON.stringify({ elements: {} }) : spec.args.includes('outdated') ? JSON.stringify({ formulae: [{ name: 'hello', installed_versions: ['1'], current_version: '2' }], casks: [] }) : JSON.stringify({ formulae: [], casks: [] });
      return { code: 0, stdout, stderr: spec.args.includes('--dry-run') ? 'these 2 paths will be fetched' : '' };
    }),
    stream: () => Stream.make({ channel: 'stdout' as const, text: 'Fetching package\n' }, { channel: 'stderr' as const, text: 'Done\n' }),
  });
  const deps = Layer.mergeAll(fake, memoryStorage().layer,
    Layer.succeed(Discovery, { check: Effect.succeed(tools) }),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
  );
  const runtime = ManagedRuntime.make(Layer.mergeAll(NixClient.layer, BrewClient.layer).pipe(Layer.provide(deps)));
  try {
    await runtime.runPromise(Effect.gen(function* () {
      const nix = yield* NixClient;
      expect((yield* nix.installed).length).toBe(0);
      expect((yield* nix.inspectPlan(makePlan(tools, source, 'install'))).download).toBe('binary');
      const brew = yield* BrewClient;
      expect((yield* brew.outdated)[0]?.latest).toBe('2');
      const events = yield* brew.execute(makePlan(tools, { ...source, manager: 'brew-formula' }, 'install')).pipe(Stream.runCollect);
      expect(events.length).toBe(2);
    }));
    expect(calls.some(c => c.args.includes('--json'))).toBe(true);
  } finally { await runtime.dispose(); }
});
