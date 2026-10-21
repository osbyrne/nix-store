import { Context, Effect, FileSystem, Layer, Semaphore, Stream } from 'effect';
import { AppError, Shell, Storage, dataRoot, failure, type CommandSpec } from './Platform';
import { BrewClient, NixClient, type InstalledPackage, type Plan } from './Managers';
import { Discovery } from './Discovery';
import type { OperationState } from '../domain/package';

export interface Operation {
  readonly id: string; readonly title: string; readonly plan: Plan; readonly state: OperationState;
  readonly startedAt: string; readonly finishedAt?: string; readonly logs: string; readonly message?: string;
}
const allowed: Record<OperationState, readonly OperationState[]> = {
  queued: ['running', 'cancelled'], running: ['needs-admin', 'succeeded', 'failed', 'cancelled'],
  'needs-admin': ['running', 'succeeded', 'failed', 'cancelled'], succeeded: [], failed: [], cancelled: [],
};
export function transition(operation: Operation, state: OperationState, message?: string): Operation {
  if (!allowed[operation.state].includes(state)) throw new Error(`Invalid operation transition ${operation.state} → ${state}`);
  return { ...operation, state, message, ...(['succeeded', 'failed', 'cancelled'].includes(state) ? { finishedAt: new Date().toISOString() } : {}) };
}
export function conflicts(plan: Plan, inventory: readonly InstalledPackage[]): string[] {
  const same = inventory.filter(p => p.identifier === plan.identifier || p.name.toLowerCase() === plan.identifier.toLowerCase());
  if (same.some(p => p.declared)) return ['This package is managed declaratively. Change nix-darwin or Home Manager, then rebuild that configuration.'];
  if (plan.action === 'install' && same.some(p => p.manager === plan.manager)) return ['This package is already installed from this source. Use Installed to remove or update it.'];
  if (plan.action === 'install' && same.some(p => p.manager !== plan.manager)) return ['Another source already provides this package. Remove that copy in Installed before installing a second copy.'];
  return [];
}

export class Operations extends Context.Service<Operations, {
  readonly execute: (plan: Plan, onEvent: (text: string) => void, onAdmin: () => void, onStart?: () => void) => Effect.Effect<void, AppError>;
}>()('nixstore/Operations') {
  static readonly layer = Layer.effect(Operations, Effect.gen(function* () {
    const shell = yield* Shell;
    const nix = yield* NixClient;
    const brew = yield* BrewClient;
    const fs = yield* FileSystem.FileSystem;
    const discovery = yield* Discovery;
    const lock = yield* Semaphore.make(1);
    return { execute: (plan, onEvent, onAdmin, onStart) => lock.withPermit(Effect.gen(function* () {
      onStart?.();
      // Fresh inventory after the queue lock prevents duplicate queued installs.
      const tools = yield* discovery.check;
      const nixInventory = tools.nix.path && !tools.nix.problem ? yield* nix.installed : [];
      const brewInventory = tools.brew.path && !tools.brew.problem ? yield* brew.installed : [];
      const inventory = [...nixInventory, ...brewInventory];
      const problems = conflicts(plan, inventory);
      if (problems.length) return yield* Effect.fail(new AppError({ message: problems[0]! }));
      let stream = plan.manager === 'nix' ? nix.execute(plan) : brew.execute(plan);
      if (plan.manager.startsWith('brew')) {
        // sudo consumes the helper's stdout directly. Passwords never enter JS, logs, or files.
        yield* fs.makeDirectory(dataRoot, { recursive: true });
        const askpass = `${dataRoot}/askpass`;
        yield* fs.writeFileString(askpass, '#!/usr/bin/osascript\non run\nset reply to display dialog "Homebrew needs administrator access to finish this operation. Enter your Mac login password." default answer "" with hidden answer buttons {"Cancel", "Allow"} default button "Allow" with title "Nixstore"\nreturn text returned of reply\nend run\n', { mode: 0o700 });
        yield* fs.chmod(askpass, 0o700);
        if (plan.needsAdmin) onAdmin();
        stream = shell.stream({ ...plan.commands[0]!, env: { ...plan.commands[0]!.env, SUDO_ASKPASS: askpass } });
      }
      yield* stream.pipe(Stream.runForEach(event => Effect.sync(() => onEvent(event.text))));
      if (plan.manager === 'nix') yield* nix.relink;
    }).pipe(Effect.mapError(failure('The operation could not finish. Refresh Installed before retrying; a partial install may need removal or repair.')))) };
  }));
}
