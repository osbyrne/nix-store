import { Layer, ManagedRuntime } from 'effect';
import { BunServices, BunHttpClient } from '@effect/platform-bun';
import { Foundation } from '../services/Foundation';
import { Shell, Http, Storage, Privilege } from '../services/Platform';
import { Discovery } from '../services/Discovery';
import { BrewClient, NixClient } from '../services/Managers';
import { Updater } from '../services/Updater';
import { Icons } from '../services/Icons';
import { Onboarding } from '../services/Onboarding';
import { Operations } from '../services/Operations';
import { Settings } from '../services/Settings';
import { Catalog } from '../services/Catalog';

export const platformLayer = Layer.mergeAll(BunServices.layer, BunHttpClient.layer);
export const ioLayer = Layer.mergeAll(Shell.layer, Http.layer, Storage.layer).pipe(Layer.provideMerge(platformLayer));
export const discoveryLayer = Layer.mergeAll(Discovery.layer, Privilege.layer).pipe(Layer.provideMerge(ioLayer));
export const managersLayer = Layer.mergeAll(BrewClient.layer, NixClient.layer, Catalog.layer, Settings.layer, Foundation.layer, Icons.layer, Updater.layer).pipe(Layer.provideMerge(discoveryLayer));
export const appLayer = Layer.mergeAll(Operations.layer, Onboarding.layer).pipe(Layer.provideMerge(managersLayer));
export function makeAppRuntime(storage?: Layer.Layer<Storage>) {
  if (!storage) return ManagedRuntime.make(appLayer);
  const io = Layer.mergeAll(Shell.layer, Http.layer, storage).pipe(Layer.provideMerge(platformLayer));
  const discovery = Layer.mergeAll(Discovery.layer, Privilege.layer).pipe(Layer.provideMerge(io));
  const managers = Layer.mergeAll(BrewClient.layer, NixClient.layer, Catalog.layer, Settings.layer, Foundation.layer, Icons.layer, Updater.layer).pipe(Layer.provideMerge(discovery));
  return ManagedRuntime.make(Layer.mergeAll(Operations.layer, Onboarding.layer).pipe(Layer.provideMerge(managers)));
}
export type AppRuntime = ReturnType<typeof makeAppRuntime>;
