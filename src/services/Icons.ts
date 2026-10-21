import { Context, Effect, FileSystem, Layer, Semaphore, Stream } from 'effect';
import { HttpClient } from 'effect/unstable/http';
import { dataRoot } from './Platform';
export class Icons extends Context.Service<Icons, {
  readonly favicon: (homepage: string) => Effect.Effect<string | undefined>;
}>()('nixstore/Icons') {
  static readonly layer = Layer.effect(Icons, Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const fs = yield* FileSystem.FileSystem;
    const slots = yield* Semaphore.make(3);
    return { favicon: homepage => slots.withPermit(Effect.gen(function* () {
      const url = yield* Effect.try(() => new URL('/favicon.ico', homepage));
      if (url.protocol !== 'https:') return undefined;
      const directory = `${dataRoot}/icons`;
      const path = `${directory}/${Bun.hash(url.href).toString(16)}.ico`;
      if (yield* fs.exists(path)) return path;
      const response = yield* client.get(url);
      if (response.status !== 200) return undefined;
      const chunks: Uint8Array[] = [];
      let size = 0;
      yield* response.stream.pipe(Stream.runForEach(chunk => {
        size += chunk.length;
        if (size > 256 * 1024) return Effect.fail('Icon too large');
        chunks.push(chunk); return Effect.void;
      }));
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const image = bytes[0] === 137 && bytes[1] === 80 || bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 || bytes[0] === 255 && bytes[1] === 216;
      if (!image) return undefined;
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFile(path, bytes);
      return path;
    }).pipe(Effect.scoped, Effect.timeout('4 seconds'), Effect.catch(() => Effect.succeed(undefined)))) };
  }));
}
