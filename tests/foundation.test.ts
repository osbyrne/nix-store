import { expect, test } from 'bun:test';
import { Effect, Exit, Layer, ManagedRuntime } from 'effect';
import { Foundation, FoundationError, readFoundation } from '../src/services/Foundation';

test('foundation is replaceable through an Effect layer', async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(Foundation, {
    status: Effect.succeed({ message: 'Fake runtime', architecture: 'Test Mac' }),
  }));
  try {
    expect(await runtime.runPromise(readFoundation)).toEqual({ message: 'Fake runtime', architecture: 'Test Mac' });
  } finally { await runtime.dispose(); }
});
test('typed service failures remain in the error channel', async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(Foundation, {
    status: Effect.fail(new FoundationError({ message: 'Internal detail' })),
  }));
  try {
    expect(Exit.isFailure(await runtime.runPromiseExit(readFoundation))).toBe(true);
  } finally { await runtime.dispose(); }
});
test('runtime work can be interrupted with an AbortSignal', async () => {
  const runtime = ManagedRuntime.make(Layer.empty);
  const controller = new AbortController();
  try {
    const work = runtime.runPromiseExit(Effect.never, { signal: controller.signal });
    controller.abort();
    expect(Exit.isFailure(await work)).toBe(true);
  } finally { await runtime.dispose(); }
});
