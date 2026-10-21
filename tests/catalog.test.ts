import { expect, test } from 'bun:test';
import { Effect, FileSystem, Layer, ManagedRuntime, Stream } from 'effect';
import { Catalog, normalizeBrew, normalizeNix, preferredSource, searchCatalog, unify, validIdentifier } from '../src/services/Catalog';
import { Discovery } from '../src/services/Discovery';
import { AppError, Http, Shell } from '../src/services/Platform';
import { memoryStorage } from './helpers';
const formulae = [{ name: 'ripgrep', desc: 'Search files', versions: { stable: '14' }, homepage: 'https://example.com', aliases: ['rg'] }];
const casks = [{ token: 'firefox', name: ['Mozilla Firefox'], desc: 'Web browser', version: '130', homepage: 'https://mozilla.org' }];
const nix = { ripgrep: { pname: 'ripgrep', version: '15', meta: { description: 'Search files', platforms: ['aarch64-darwin', 'x86_64-darwin'], mainProgram: 'rg' } }, linux: { name: 'linux', meta: { platforms: ['x86_64-linux'] } } };
test('normalizes Darwin metadata, resolves sources and preserves versions', () => {
  const catalog = unify([...normalizeBrew(formulae, casks), ...normalizeNix(nix, 'aarch64-darwin')]);
  const rg = searchCatalog(catalog, 'ripgrep', 'cli', 'all', 'aarch64-darwin')[0]!;
  expect(rg.sources.map(s => s.version)).toEqual(['14', '15']);
  expect(preferredSource(rg, 'automatic', 'aarch64-darwin')?.manager).toBe('nix');
  expect(preferredSource(catalog.find(p => p.key === 'firefox')!, 'automatic', 'aarch64-darwin')?.manager).toBe('brew-cask');
  expect(catalog.some(p => p.key === 'linux')).toBe(false);
  expect(searchCatalog(catalog, 'rg', 'cli', 'brew-formula', 'aarch64-darwin').length).toBe(1);
});
test('rejects command injection and option identifiers', () => {
  for (const id of ['--help', '-x', 'hello; rm -rf /', 'a\nb', '../../Applications', '$(whoami)', 'a b']) {
    expect(validIdentifier('nix', id)).toBe(false);
    expect(validIdentifier('brew-cask', id)).toBe(false);
  }
});
test('catalog refresh uses fake Http and saves normalized offline data atomically', async () => {
  const storage = memoryStorage();
  const deps = Layer.mergeAll(storage.layer,
    Layer.succeed(Http, { text: url => Effect.succeed(JSON.stringify(url.includes('formula.json') ? formulae : casks)) }),
    Layer.succeed(Shell, { run: () => Effect.die('no shell expected'), stream: () => Stream.empty }),
    Layer.succeed(Discovery, { check: Effect.succeed({ nix: {}, brew: {}, declarative: [], platform: 'aarch64-darwin' as const }) }),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
  );
  const runtime = ManagedRuntime.make(Catalog.layer.pipe(Layer.provide(deps)));
  try {
    const catalog = await runtime.runPromise(Effect.gen(function* () { const service = yield* Catalog; yield* service.refreshBrew; return yield* service.load; }));
    expect(catalog.length).toBe(2);
    expect(storage.data.has('catalog-brew')).toBe(true);
  } finally { await runtime.dispose(); }
});

test('Homebrew excludes Linux requirements and respects cask architecture', () => {
  const entries = normalizeBrew([{ name: 'linux-only', requirements: [{ name: 'linux' }] }], [{ token: 'arm-only', name: ['Arm only'], depends_on: { arch: [{ type: 'arm', bits: 64 }] } }]);
  expect(entries.length).toBe(1);
  expect(searchCatalog(entries, '', 'all', 'all', 'x86_64-darwin')).toEqual([]);
  expect(searchCatalog(entries, '', 'all', 'all', 'aarch64-darwin').length).toBe(1);
});

test('online search queries the Nix index and keeps Homebrew results when Nix fails', async () => {
  const requests: { url: string; body?: any }[] = [];
  let failNix = false;
  const deps = Layer.mergeAll(memoryStorage().layer,
    Layer.succeed(Http, { text: (url, _limit, options) => {
      requests.push({ url, body: options?.body });
      if (url.includes('formula.json')) return Effect.succeed(JSON.stringify(formulae));
      if (url.includes('cask.json')) return Effect.succeed(JSON.stringify(casks));
      if (failNix) return Effect.fail(new AppError({ message: 'Network unavailable' }));
      if (url.endsWith('.js')) return Effect.succeed('elasticsearchMappingSchemaVersion:parseInt("43"),elasticsearchUsername:"public",elasticsearchPassword:"public"');
      if (url.includes('/backend/')) return Effect.succeed(JSON.stringify({ hits: { hits: [{ _index: 'nixos-unstable', _source: {
        package_attr_name: 'ripgrep', package_pname: 'ripgrep', package_pversion: '15', package_platforms: ['aarch64-darwin'], package_description: 'Search files',
      } }] } }));
      return Effect.succeed('<script src="/static/js/index.test.js"></script>');
    } }),
    Layer.succeed(Shell, { run: () => Effect.die('no shell expected'), stream: () => Stream.empty }),
    Layer.succeed(Discovery, { check: Effect.succeed({ nix: {}, brew: {}, declarative: [], platform: 'aarch64-darwin' as const }) }),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
  );
  const runtime = ManagedRuntime.make(Catalog.layer.pipe(Layer.provide(deps)));
  try {
    const search = () => runtime.runPromise(Effect.gen(function* () { return yield* (yield* Catalog).search('ripgrep', 'all'); }));
    const online = await search();
    expect(online.warnings).toEqual([]);
    expect(online.entries.find(p => p.key === 'ripgrep')?.sources.length).toBe(2);
    expect(requests.find(r => r.body)?.body.query.bool.must[0].simple_query_string.query).toBe('ripgrep');
    failNix = true;
    const partial = await search();
    expect(partial.warnings[0]).toContain('Nix:');
    expect(partial.entries.some(p => p.key === 'ripgrep')).toBe(true);
  } finally { await runtime.dispose(); }
});
