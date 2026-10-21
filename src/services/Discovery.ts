import { Context, Effect, FileSystem, Layer } from 'effect';
import { AppError, Shell, environment, failure, home } from './Platform';
export interface ToolStatus { readonly path?: string; readonly version?: string; readonly problem?: string }
export interface DiscoveryResult {
  readonly nix: ToolStatus;
  readonly brew: ToolStatus;
  readonly declarative: readonly string[];
  readonly platform: 'aarch64-darwin' | 'x86_64-darwin';
}
export class Discovery extends Context.Service<Discovery, {
  readonly check: Effect.Effect<DiscoveryResult, AppError>;
}>()('nixstore/Discovery') {
  static readonly layer = Layer.effect(Discovery, Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const shell = yield* Shell;
    const probe = (paths: string[]): Effect.Effect<ToolStatus> => Effect.gen(function* () {
      for (const path of paths) {
        if (!(yield* fs.exists(path))) continue;
        const result = yield* shell.run({ executable: path, args: ['--version'], timeoutMs: 15000 });
        return result.code === 0 ? { path, version: result.stdout.trim().split('\n')[0] } : { path, problem: 'The tool is present but cannot run. Try repair in Settings.' };
      }
      return {};
    }).pipe(Effect.catch(() => Effect.succeed({ problem: 'The tool did not respond. Try repair in Settings.' })));
    return { check: Effect.gen(function* () {
      const [nix, brew] = yield* Effect.all([
        probe(['/nix/var/nix/profiles/default/bin/nix', `${home}/.nix-profile/bin/nix`]),
        probe(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']),
      ], { concurrency: 2 });
      if (nix.path && !nix.problem) {
        const ping = yield* shell.run({ executable: nix.path, args: ['--extra-experimental-features', 'nix-command', 'store', 'ping'], timeoutMs: 20000 }).pipe(Effect.catch(() => Effect.succeed({ code: 1 })));
        if (ping.code !== 0) Object.assign(nix, { problem: 'Nix cannot reach its store. A macOS update may have affected its mount or daemon. Use Check / repair in Settings.' });
      }
      const declarative: string[] = [];
      for (const [path, name] of [
        ['/run/current-system', 'nix-darwin'], ['/etc/nix-darwin', 'nix-darwin configuration'],
        [`${home}/.config/home-manager`, 'Home Manager configuration'],
        [`${home}/.local/state/nix/profiles/home-manager`, 'Home Manager profile'],
      ]) if (yield* fs.exists(path!)) declarative.push(name!);
      return { nix, brew, declarative, platform: process.arch === 'arm64' ? 'aarch64-darwin' as const : 'x86_64-darwin' as const };
    }).pipe(Effect.mapError(failure('Could not inspect your package managers.'))) };
  }));
}
