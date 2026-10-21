import { Context, Effect, Layer } from 'effect';
import { checkUpdate, type AvailableUpdate } from '@gpuix/native';
import config from '../release-config.json';
import { AppError, failure } from './Platform';
export class Updater extends Context.Service<Updater, {
  readonly check: Effect.Effect<string, AppError>;
  readonly install: Effect.Effect<string, AppError>;
}>()('nixstore/Updater') {
  static readonly layer = Layer.sync(Updater, () => {
    let pending: AvailableUpdate | null = null;
    return {
      check: Effect.gen(function* () {
        if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository) || !config.publicKey) {
          return 'App updates are not configured in this unsigned development build. A GitHub Releases repository and updater public key must be set before distribution.';
        }
        pending = yield* Effect.tryPromise({ try: () => checkUpdate('0.1.0', { endpoints: [`https://github.com/${config.repository}/releases/latest`], pubkey: config.publicKey, timeoutMs: 30000 }), catch: failure('Could not check app updates.') }).pipe(Effect.timeout('30 seconds'), Effect.mapError(failure('App update check timed out.')));
        return pending ? `Nixstore ${pending.version} is available. Install it below, then quit and reopen Nixstore.` : 'Nixstore is up to date.';
      }),
      install: Effect.gen(function* () {
        if (!pending) return yield* Effect.fail(new AppError({ message: 'Check for an app update first.' }));
        yield* Effect.tryPromise({ try: () => pending!.downloadAndInstall(), catch: failure('The update could not be installed. The download must have a valid signature.') }).pipe(Effect.timeout('10 minutes'), Effect.mapError(failure('The app update timed out.')));
        pending = null;
        return 'Update installed. Quit and reopen Nixstore to use it.';
      }),
    };
  });
}
