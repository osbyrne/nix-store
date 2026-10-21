import { expect, test } from 'bun:test';
import { Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { BunServices } from '@effect/platform-bun';
import { Shell } from '../src/services/Platform';
const layer = Shell.layer.pipe(Layer.provide(BunServices.layer));
test('real process runner treats shell metacharacters as literal argv', async () => {
  const runtime = ManagedRuntime.make(layer);
  try {
    const result = await runtime.runPromise(Effect.gen(function* () {
      return yield* (yield* Shell).run({ executable: '/usr/bin/printf', args: ['%s', '$(whoami); & | literal'], maxOutput: 1024 });
    }));
    expect(result.stdout).toBe('$(whoami); & | literal');
  } finally { await runtime.dispose(); }
});
test('real process runner terminates timed-out commands and excessive output', async () => {
  const runtime = ManagedRuntime.make(layer);
  try {
    const started = Date.now();
    const timeout = await runtime.runPromiseExit(Effect.gen(function* () { return yield* (yield* Shell).run({ executable: '/bin/sleep', args: ['10'], timeoutMs: 30 }); }));
    expect(Exit.isFailure(timeout)).toBe(true);
    expect(Date.now() - started).toBeLessThan(3000);
    const output = await runtime.runPromiseExit(Effect.gen(function* () { return yield* (yield* Shell).run({ executable: '/usr/bin/yes', args: [], maxOutput: 1024, timeoutMs: 5000 }); }));
    expect(Exit.isFailure(output)).toBe(true);
  } finally { await runtime.dispose(); }
});
