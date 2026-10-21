import { Context, Effect, FileSystem, Layer } from 'effect';
import { AppError, Http, Privilege, Shell, Storage, dataRoot, failure, type ProcessEvent } from './Platform';
import { Discovery, type DiscoveryResult } from './Discovery';
export class Onboarding extends Context.Service<Onboarding, {
  readonly setup: (manager: 'nix' | 'brew', repair: boolean, onEvent: (text: string) => void) => Effect.Effect<DiscoveryResult, AppError>;
}>()('nixstore/Onboarding') {
  static readonly layer = Layer.effect(Onboarding, Effect.gen(function* () {
    const http = yield* Http;
    const shell = yield* Shell;
    const privilege = yield* Privilege;
    const fs = yield* FileSystem.FileSystem;
    const discovery = yield* Discovery;
    return { setup: (manager, repair, onEvent) => Effect.gen(function* () {
      const current = yield* discovery.check;
      if (!repair && current[manager].version) return current;
      if (repair && manager === 'nix' && current.nix.path && !current.nix.problem) {
        // Do not replace a working upstream Nix with Determinate Nix during repair.
        const ping = yield* shell.run({ executable: current.nix.path, args: ['--extra-experimental-features', 'nix-command', 'store', 'ping'], timeoutMs: 20000 }, event => onEvent(event.text));
        if (ping.code === 0) { onEvent('Nix is healthy. No repair was needed.\n'); return current; }
      }
      const url = manager === 'nix' ? 'https://install.determinate.systems/nix' : 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh';
      onEvent(`Downloading the official ${manager === 'nix' ? 'Determinate Nix' : 'Homebrew'} installer…\n`);
      const script = yield* http.text(url, 2 * 1024 * 1024);
      yield* fs.makeDirectory(dataRoot, { recursive: true });
      const path = `${dataRoot}/${manager}-installer-${crypto.randomUUID()}.sh`;
      yield* fs.writeFileString(path, script, { mode: 0o700 });
      const command = { executable: '/bin/bash', args: manager === 'nix' ? [path, 'install', '--no-confirm'] : [path], timeoutMs: 1800000 };
      const result = yield* (manager === 'nix'
        ? privilege.run(command, event => onEvent(event.text))
        : Effect.gen(function* () {
          const askpass = `${dataRoot}/setup-askpass`;
          yield* fs.writeFileString(askpass, '#!/usr/bin/osascript\non run\nset reply to display dialog "Homebrew setup needs administrator access. Enter your Mac login password." default answer "" with hidden answer buttons {"Cancel", "Allow"} default button "Allow" with title "Nixstore"\nreturn text returned of reply\nend run\n', { mode: 0o700 });
          yield* fs.chmod(askpass, 0o700);
          return yield* shell.run({ ...command, env: { NONINTERACTIVE: '1', SUDO_ASKPASS: askpass } }, event => onEvent(event.text));
        })).pipe(Effect.ensuring(fs.remove(path, { force: true }).pipe(Effect.ignore)));
      if (result.code !== 0) return yield* Effect.fail(new AppError({ message: 'Setup did not finish. Review the log and retry. A Mac administrator account and Apple command-line tools may be required.', detail: result.stderr }));
      const verified = yield* discovery.check;
      if (!verified[manager].version) return yield* Effect.fail(new AppError({ message: 'The installer finished, but the tool is still unavailable. Restart the Mac and recheck sources.' }));
      onEvent(`${verified[manager].version} verified.\n`);
      return verified;
    }).pipe(Effect.mapError(failure('Source setup could not finish. Recheck sources before retrying.'))) };
  }));
}
