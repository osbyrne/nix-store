import { Context, Data, Effect, FileSystem, Layer, Queue, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { HttpClient, HttpClientRequest } from 'effect/unstable/http';
import { homedir } from 'node:os';

export class AppError extends Data.TaggedError('AppError')<{
  readonly message: string;
  readonly detail?: string;
}> {}
export const failure = (message: string) => (cause: unknown) => cause instanceof AppError ? cause : new AppError({ message, detail: String(cause) });
export const home = homedir();
export const dataRoot = process.env.NIXSTORE_DATA_DIR ?? `${home}/Library/Application Support/Nixstore`;
export const environment = {
  HOME: home, USER: process.env.USER ?? '', LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
  PATH: '/opt/homebrew/bin:/usr/local/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR ?? '/tmp',
  HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ANALYTICS: '1', HOMEBREW_NO_ENV_HINTS: '1',
  GIT_TERMINAL_PROMPT: '0', CI: '1',
};
export interface CommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly maxOutput?: number;
}
export interface ProcessEvent { readonly channel: 'stdout' | 'stderr'; readonly text: string }
export interface ProcessResult { readonly stdout: string; readonly stderr: string; readonly code: number }
export interface Progress extends ProcessEvent { readonly at?: number }

export class Shell extends Context.Service<Shell, {
  readonly run: (spec: CommandSpec, onEvent?: (event: ProcessEvent) => void) => Effect.Effect<ProcessResult, AppError>;
  readonly stream: (spec: CommandSpec) => Stream.Stream<ProcessEvent, AppError>;
}>()('nixstore/Shell') {
  static readonly layer = Layer.effect(Shell, Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const run = (spec: CommandSpec, onEvent?: (event: ProcessEvent) => void) => Effect.scoped(Effect.gen(function* () {
      if (!spec.executable.startsWith('/') || spec.args.some(arg => arg.includes('\0'))) {
        return yield* Effect.fail(new AppError({ message: 'The command is not safe to run.' }));
      }
      const child = yield* spawner.spawn(ChildProcess.make(spec.executable, spec.args, {
        env: { ...environment, ...spec.env }, extendEnv: false, shell: false,
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: '2 seconds',
      }));
      const capture = (input: typeof child.stdout, channel: ProcessEvent['channel'], limit: number) => Effect.gen(function* () {
        let output = '';
        let bytes = 0;
        yield* input.pipe(Stream.decodeText(), Stream.runForEach(text => Effect.gen(function* () {
          bytes += text.length;
          onEvent?.({ channel, text: text.slice(-16384) });
          // Read paths fail before growing beyond their explicit budget. Log-only calls retain a tail.
          if (channel === 'stdout' && spec.maxOutput && bytes > limit) {
            return yield* Effect.fail(new AppError({ message: 'This command returned too much data. Try refreshing a smaller source.' }));
          }
          output = (output + text).slice(-limit);
        })));
        return output;
      });
      const [stdout, stderr, code] = yield* Effect.all([
        capture(child.stdout, 'stdout', spec.maxOutput ?? 65536),
        capture(child.stderr, 'stderr', 65536), child.exitCode,
      ], { concurrency: 'unbounded' });
      return { stdout, stderr, code: Number(code) };
    })).pipe(Effect.timeout(spec.timeoutMs ?? 120000), Effect.mapError(failure('The command failed or timed out. See Activity for details.')));
    return {
      run,
      stream: spec => Stream.callback<ProcessEvent, AppError>(queue => Effect.gen(function* () {
        const result = yield* run(spec, event => { Queue.offerUnsafe(queue, event); });
        if (result.code !== 0) return yield* Effect.fail(new AppError({ message: 'The package manager could not finish.', detail: result.stderr }));
        yield* Queue.end(queue);
      }), { bufferSize: 128, strategy: 'sliding' }),
    };
  }));
}

export class Http extends Context.Service<Http, {
  readonly text: (url: string, maxBytes?: number, options?: { body: unknown; headers?: Record<string, string> }) => Effect.Effect<string, AppError>;
}>()('nixstore/Http') {
  static readonly layer = Layer.effect(Http, Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return { text: (url, maxBytes = 64 * 1024 * 1024, options) => Effect.scoped(Effect.gen(function* () {
      if (!url.startsWith('https://')) return yield* Effect.fail(new AppError({ message: 'Downloads must use HTTPS.' }));
      const response = yield* (options ? client.execute(HttpClientRequest.post(url, { headers: options.headers }).pipe(HttpClientRequest.bodyJsonUnsafe(options.body))) : client.get(url));
      if (response.status !== 200) return yield* Effect.fail(new AppError({ message: `The catalog server returned ${response.status}.` }));
      let bytes = 0;
      const parts: string[] = [];
      yield* response.stream.pipe(Stream.decodeText(), Stream.runForEach(chunk => {
        bytes += new TextEncoder().encode(chunk).length;
        if (bytes > maxBytes) return Effect.fail(new AppError({ message: 'The download exceeded its size limit.' }));
        parts.push(chunk);
        return Effect.void;
      }));
      return parts.join('');
    })).pipe(Effect.timeout('90 seconds'), Effect.mapError(failure('The download failed. Your saved catalog is still available.'))) };
  }));
}

export const parseJson = <A = unknown>(text: string): Effect.Effect<A, AppError> => Effect.try({
  try: () => JSON.parse(text) as A, catch: failure('The package manager returned unreadable data. Try refreshing.'),
});

export class Storage extends Context.Service<Storage, {
  readonly read: <A>(name: string, fallback: A) => Effect.Effect<A, AppError>;
  readonly write: (name: string, value: unknown) => Effect.Effect<void, AppError>;
}>()('nixstore/Storage') {
  static readonly layer = Layer.effect(Storage, Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return {
      read: <A>(name: string, fallback: A) => Effect.gen(function* () {
        const path = `${dataRoot}/${name}.json`;
        if (!(yield* fs.exists(path))) return fallback;
        const info = yield* fs.stat(path);
        if (Number(info.size) > 96 * 1024 * 1024) return yield* Effect.fail(new AppError({ message: 'The saved catalog is too large. Clear its cache in Settings.' }));
        return yield* parseJson<A>(yield* fs.readFileString(path));
      }).pipe(Effect.mapError(failure('Could not read Nixstore’s saved data.'))),
      write: (name, value) => Effect.gen(function* () {
        yield* fs.makeDirectory(dataRoot, { recursive: true });
        const path = `${dataRoot}/${name}.json`;
        const temporary = `${path}.${crypto.randomUUID()}.tmp`;
        const serialized = JSON.stringify(value);
        if (new TextEncoder().encode(serialized).length > 96 * 1024 * 1024) return yield* Effect.fail(new AppError({ message: 'The data exceeded its saved size limit. The previous cache was kept.' }));
        yield* fs.writeFileString(temporary, serialized, { mode: 0o600 });
        yield* fs.rename(temporary, path);
      }).pipe(Effect.mapError(failure('Could not save Nixstore’s data. Check available disk space.'))),
    };
  }));
}
/** Escaping is only for the unavoidable AppleScript privileged boundary and display copy. */
export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export const displayCommand = (spec: CommandSpec) => [spec.executable, ...spec.args].map(quote).join(' ');
export class Privilege extends Context.Service<Privilege, {
  readonly run: (spec: CommandSpec, onEvent?: (event: ProcessEvent) => void) => Effect.Effect<ProcessResult, AppError>;
}>()('nixstore/Privilege') {
  static readonly layer = Layer.effect(Privilege, Effect.gen(function* () {
    const shell = yield* Shell;
    return { run: (spec, onEvent) => {
      // Only internal, preconstructed plans reach this method; every argv/env value is quoted.
      const command = ['/usr/bin/env', ...Object.entries({ ...environment, ...spec.env }).map(([k, v]) => `${k}=${v}`), spec.executable, ...spec.args].map(quote).join(' ');
      const script = `do shell script ${JSON.stringify(command)} with administrator privileges`;
      return shell.run({ executable: '/usr/bin/osascript', args: ['-e', script], timeoutMs: spec.timeoutMs ?? 1800000 }, onEvent);
    } };
  }));
}
