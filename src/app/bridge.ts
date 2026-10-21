import { createSignal, onCleanup, onMount } from 'solid-js';
import { Effect, Exit, ManagedRuntime } from 'effect';

export type ResourceState<A> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: A }
  | { readonly state: 'failed'; readonly message: string };

/** Promise completion cannot update a disposed Solid owner. */
export function createRuntimeResource<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, never>, effect: Effect.Effect<A, E, R>) {
  const [state, setState] = createSignal<ResourceState<A>>({ state: 'loading' });
  const controller = new AbortController();
  onMount(() => {
    void runtime.runPromiseExit(effect.pipe(Effect.timeout('5 seconds')), { signal: controller.signal })
      .then(exit => {
        if (controller.signal.aborted) return;
        if (Exit.isSuccess(exit)) setState({ state: 'ready', value: exit.value });
        else setState({ state: 'failed', message: 'The app could not start its runtime. Please reopen Nixstore.' });
      }).catch(() => {
        if (!controller.signal.aborted) setState({ state: 'failed', message: 'The app runtime could not start.' });
      });
  });
  onCleanup(() => controller.abort());
  return state;
}
