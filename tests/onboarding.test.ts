import { expect, test } from 'bun:test';
import { Effect, FileSystem, Layer, ManagedRuntime, Stream } from 'effect';
import { Onboarding } from '../src/services/Onboarding';
import { Discovery } from '../src/services/Discovery';
import { Http, Shell, Privilege, type CommandSpec } from '../src/services/Platform';

for (const manager of ['nix', 'brew'] as const) test(`${manager} setup downloads its fixed installer and verifies discovery with fakes`, async () => {
  let probes = 0;
  const calls: { kind: string; spec: CommandSpec }[] = [];
  const downloads: string[] = [];
  const deps = Layer.mergeAll(
    Layer.succeed(Discovery, { check: Effect.sync(() => { probes++; return { nix: manager === 'nix' && probes > 1 ? { version: 'Nix test' } : {}, brew: manager === 'brew' && probes > 1 ? { version: 'Homebrew test' } : {}, declarative: [], platform: 'aarch64-darwin' as const }; }) }),
    Layer.succeed(Http, { text: url => Effect.sync(() => { downloads.push(url); return '#!/bin/bash\nexit 0'; }) }),
    Layer.succeed(Shell, { run: spec => Effect.sync(() => { calls.push({ kind: 'user', spec }); return { code: 0, stdout: '', stderr: '' }; }), stream: () => Stream.empty }),
    Layer.succeed(Privilege, { run: spec => Effect.sync(() => { calls.push({ kind: 'admin', spec }); return { code: 0, stdout: '', stderr: '' }; }) }),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({ makeDirectory: () => Effect.void, writeFileString: () => Effect.void, chmod: () => Effect.void, remove: () => Effect.void })),
  );
  const runtime = ManagedRuntime.make(Onboarding.layer.pipe(Layer.provide(deps)));
  try {
    const tools = await runtime.runPromise(Effect.gen(function* () { return yield* (yield* Onboarding).setup(manager, false, () => {}); }));
    expect(tools[manager].version).toBeDefined();
    expect(downloads[0]).toContain(manager === 'nix' ? 'install.determinate.systems' : 'Homebrew/install');
    expect(calls[0]?.kind).toBe(manager === 'nix' ? 'admin' : 'user');
    if (manager === 'brew') expect(calls[0]?.spec.env?.SUDO_ASKPASS).toBeDefined();
  } finally { await runtime.dispose(); }
});
