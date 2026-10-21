import { Effect, Layer } from 'effect';
import { Storage } from '../src/services/Platform';
export function memoryStorage(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, layer: Layer.succeed(Storage, {
    read: <A>(name: string, fallback: A) => Effect.succeed((data.get(name) ?? fallback) as A),
    write: (name: string, value: unknown) => Effect.sync(() => { data.set(name, value); }),
  }) };
}
