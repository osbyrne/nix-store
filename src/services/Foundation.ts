import { Context, Data, Effect, Layer } from 'effect';

export interface FoundationStatus {
  readonly message: string;
  readonly architecture: string;
}
export class FoundationError extends Data.TaggedError('FoundationError')<{
  readonly message: string;
}> {}

export class Foundation extends Context.Service<Foundation, {
  readonly status: Effect.Effect<FoundationStatus, FoundationError>;
}>()('nixstore/Foundation') {
  static readonly layer = Layer.succeed(Foundation, {
    status: Effect.sync(() => ({
      message: 'Native runtime ready',
      architecture: process.arch === 'arm64' ? 'Apple Silicon' : 'Intel',
    })),
  });
}
export const readFoundation = Effect.gen(function* () {
  const foundation = yield* Foundation;
  return yield* foundation.status;
});
