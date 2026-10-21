import { Context, Effect, Layer } from 'effect';
import { AppError, Storage } from './Platform';
export interface Preferences {
  readonly source: 'automatic' | 'nix' | 'brew';
  readonly showCommands: boolean; readonly refreshOnLaunch: boolean;
  readonly skippedNix: boolean; readonly skippedBrew: boolean;
}
export const defaults: Preferences = { source: 'automatic', showCommands: false, refreshOnLaunch: true, skippedNix: false, skippedBrew: false };
export class Settings extends Context.Service<Settings, {
  readonly load: Effect.Effect<Preferences, AppError>;
  readonly save: (settings: Preferences) => Effect.Effect<void, AppError>;
}>()('nixstore/Settings') {
  static readonly layer = Layer.effect(Settings, Effect.gen(function* () {
    const storage = yield* Storage;
    return {
      load: storage.read<Partial<Preferences>>('settings', {}).pipe(Effect.map(saved => ({ ...defaults, ...saved }))),
      save: preferences => storage.write('settings', preferences),
    };
  }));
}
