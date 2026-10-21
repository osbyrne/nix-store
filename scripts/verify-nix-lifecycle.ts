import { Effect, Stream } from 'effect';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeAppRuntime } from '../src/app/runtime';
import { Discovery } from '../src/services/Discovery';
import { Shell } from '../src/services/Platform';
import { nixFlags, normalizeProfile } from '../src/services/Managers';
const root = await mkdtemp(join(tmpdir(), 'nixstore-profile-'));
const runtime = makeAppRuntime();
const transcript: { step: string; output: string }[] = [];
try {
  await runtime.runPromise(Effect.gen(function* () {
    const shell = yield* Shell;
    const tools = yield* (yield* Discovery).check;
    if (!tools.nix.path) throw new Error('Nix is required for this live verification.');
    const profile = join(root, 'profile');
    const mutate = (action: string, rest: string[]) => Effect.gen(function* () {
      let output = '';
      yield* shell.stream({ executable: tools.nix.path!, args: [...nixFlags, 'profile', action, '--profile', profile, ...rest], timeoutMs: 300000 }).pipe(Stream.runForEach(event => Effect.sync(() => { output = (output + event.text).slice(-65536); })));
      transcript.push({ step: action, output });
      console.log('Disposable profile:', action, 'passed');
    });
    const read = Effect.gen(function* () {
      const result = yield* shell.run({ executable: tools.nix.path!, args: [...nixFlags, 'profile', 'list', '--profile', profile, '--json'], maxOutput: 1024 * 1024 });
      if (result.code !== 0) throw new Error(result.stderr);
      return normalizeProfile(JSON.parse(result.stdout));
    });
    yield* mutate('install', ['github:NixOS/nixpkgs/nixpkgs-unstable#hello']);
    const installed = yield* read;
    if (installed.length !== 1 || installed[0]?.identifier !== 'hello') throw new Error('Installed inventory did not match hello.');
    const hello = installed[0]!;
    const execution = yield* shell.run({ executable: `${profile}/bin/hello`, args: [], maxOutput: 1024 });
    if (!execution.stdout.includes('Hello, world!')) throw new Error('Installed binary did not run.');
    yield* mutate('upgrade', [hello.profileName!]);
    yield* mutate('remove', [hello.profileName!]);
    if ((yield* read).length) throw new Error('Removal did not empty the disposable profile.');
    yield* mutate('rollback', ['--to', '1']);
    if ((yield* read).length !== 1) throw new Error('Rollback did not restore hello.');
    yield* mutate('remove', [(yield* read)[0]!.profileName!]);
  }));
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/nix-lifecycle.json', JSON.stringify({ scope: 'Disposable temporary profile; user profile unchanged', transcript }, null, 2));
} finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }); }
