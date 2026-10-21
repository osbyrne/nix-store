import { expect, test } from 'bun:test';
import { createTestRoot } from '@gpuix/solid/testing';
import { connectTest } from '@gpuix/solid/automation';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { createRuntimeResource } from '../src/app/bridge';
import { create, props } from '../src/ui/styles';

const styles = create({ text: { color: '#202B3B' } });

test('bridge shows a safe message instead of internal errors', async () => {
  const runtime = ManagedRuntime.make(Layer.empty);
  const root = createTestRoot();
  function Probe() {
    const value = createRuntimeResource(runtime, Effect.fail('secret internal failure'));
    return <text {...props(styles.text)}>{value().state === 'failed' ? 'Safe failure' : 'Loading'}</text>;
  }
  root.render(() => <Probe />);
  const app = await connectTest(root.renderer);
  try {
    await app.getByText('Safe failure').waitFor();
    expect(root.renderer.getAllText().join(' ')).not.toContain('secret');
  } finally { await app.close(); root.unmount(); await runtime.dispose(); }
});

test('disposing a Solid owner interrupts its pending runtime work', async () => {
  const runtime = ManagedRuntime.make(Layer.empty);
  const root = createTestRoot();
  let started = false;
  let interrupted = false;
  function Probe() {
    createRuntimeResource(runtime, Effect.gen(function* () {
      started = true;
      return yield* Effect.never;
    }).pipe(Effect.ensuring(Effect.sync(() => { interrupted = true; }))));
    return <text {...props(styles.text)}>Pending</text>;
  }
  try {
    root.render(() => <Probe />);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(started).toBe(true);
    root.unmount();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(interrupted).toBe(true);
  } finally { root.unmount(); await runtime.dispose(); }
});
