import { Context, Effect, FileSystem, Layer } from 'effect';
import type { DarwinPlatform, Manager, Package, PackageSource } from '../domain/package';
import { AppError, Http, Shell, Storage, dataRoot, failure, parseJson } from './Platform';
import { Discovery } from './Discovery';

type Json = Record<string, any>;
export const darwin: DarwinPlatform[] = ['aarch64-darwin', 'x86_64-darwin'];
export interface CatalogEntry extends Package {
  readonly key: string;
  readonly aliases: readonly string[];
}
export interface CatalogSnapshot { readonly entries: readonly CatalogEntry[]; readonly refreshedAt: string; readonly source: 'brew' | 'nix' }
export const validIdentifier = (manager: Manager, value: string) => value.length > 0 && value.length < 240 && !value.startsWith('-') && !value.includes('..') && (
  manager === 'nix' ? /^[a-zA-Z0-9_+-]+(?:\.[a-zA-Z0-9_+-]+)*$/.test(value) : /^[a-zA-Z0-9_+@.-]+(?:\/[a-zA-Z0-9_+@.-]+){0,2}$/.test(value)
);
const safeUrl = (url: unknown): string | undefined => {
  try { const parsed = new URL(String(url)); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : undefined; } catch { return undefined; }
};
const identity = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
export function normalizeBrew(formulae: Json[], casks: Json[]): CatalogEntry[] {
  return [
    ...formulae.filter(f => !f.disabled && !(f.requirements ?? []).some((r: Json) => r.name === 'linux') && validIdentifier('brew-formula', f.name ?? '')).map(f => ({
      id: `brew-formula:${f.name}`, key: f.name, name: f.name, description: f.desc ?? '', kind: 'cli' as const,
      aliases: f.aliases ?? [], homepage: safeUrl(f.homepage),
      sources: [{ manager: 'brew-formula' as const, identifier: f.name, version: f.versions?.stable ?? 'unknown', platforms: darwin }],
    })),
    ...casks.filter(c => !c.disabled && validIdentifier('brew-cask', c.token ?? '')).map(c => {
      const constraints: Json[] = [c, ...Object.values(c.variations ?? {})].flatMap((variant: any) => variant.depends_on?.arch ?? []);
      const platforms = constraints.length ? darwin.filter(system => constraints.some(arch => arch.type === 'arm' && system === 'aarch64-darwin' || arch.type === 'intel' && system === 'x86_64-darwin')) : darwin;
      const artifact = (c.artifacts ?? []).flatMap((a: Json) => a.app ?? [])[0];
      return {
        id: `brew-cask:${c.token}`, key: c.token, name: c.name?.[0] ?? c.token, description: c.desc ?? '', kind: 'gui' as const,
        aliases: c.name ?? [], homepage: safeUrl(c.homepage),
        sources: [{ manager: 'brew-cask' as const, identifier: c.token, version: c.version ?? 'unknown', platforms,
          needsAdmin: (c.artifacts ?? []).some((a: Json) => a.pkg || a.installer), appName: typeof artifact === 'string' ? artifact : undefined,
        }],
      };
    }),
  ];
}
export function normalizeNix(data: Json, platform: DarwinPlatform): CatalogEntry[] {
  return Object.entries(data).flatMap(([attribute, p]: [string, Json]) => {
    const id = p.attrPath ?? attribute;
    const meta = p.meta ?? {};
    const supported = darwin.filter(system => (meta.platforms ?? []).includes(system) && !(meta.badPlatforms ?? []).includes(system));
    if (!validIdentifier('nix', id ?? '') || !supported.includes(platform) || meta.broken) return [];
    const name = p.pname ?? p.name?.replace(/-[0-9].*$/, '') ?? id;
    const gui = /\.app\b/.test(JSON.stringify(meta.outputsToInstall ?? [])) || /\b(application|graphical|desktop|GUI|browser|editor)\b/i.test(meta.description ?? '') && !meta.mainProgram;
    return [{ id: `nix:${id}`, key: id, name, description: meta.description ?? '', kind: gui ? 'gui' as const : 'cli' as const,
      aliases: [id, p.name ?? name], homepage: safeUrl(Array.isArray(meta.homepage) ? meta.homepage[0] : meta.homepage),
      sources: [{ manager: 'nix' as const, identifier: id, version: p.version ?? p.name?.slice(name.length + 1) ?? 'unknown', platforms: supported }],
    }];
  });
}
/** Conservative matching: exact attribute/token/pname or matching display name + homepage origin. */
export function unify(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const groups = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    const key = identity(entry.key);
    const current = groups.get(key);
    if (!current) { groups.set(key, entry); continue; }
    const sources = [...current.sources];
    for (const source of entry.sources) if (!sources.some(s => s.manager === source.manager && s.identifier === source.identifier)) sources.push(source);
    const preferred = entry.sources[0]?.manager === 'brew-cask' ? entry : current;
    groups.set(key, { ...preferred, id: `package:${key}`, sources, aliases: [...current.aliases, ...entry.aliases] });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function searchCatalog(entries: readonly CatalogEntry[], query: string, kind: string, source: string, platform: DarwinPlatform): CatalogEntry[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = entries.filter(p => (kind === 'all' || p.kind === kind) && p.sources.some(s => (source === 'all' || s.manager === source) && s.platforms.includes(platform))
    && words.every(word => `${p.name} ${p.key} ${p.aliases.join(' ')} ${p.description}`.toLowerCase().includes(word)))
  if (!words.length) return matches;
  return [...matches.filter(p => identity(p.key) === identity(query)), ...matches.filter(p => identity(p.key) !== identity(query))];
}
export function preferredSource(pkg: Package, preference: 'automatic' | 'nix' | 'brew', platform: DarwinPlatform): PackageSource | undefined {
  const sources = pkg.sources.filter(s => s.platforms.includes(platform));
  const preferred = preference === 'nix' ? 'nix' : preference === 'brew' ? (pkg.kind === 'gui' ? 'brew-cask' : 'brew-formula') : pkg.kind === 'gui' ? 'brew-cask' : 'nix';
  return sources.find(s => s.manager === preferred) ?? sources[0];
}

export class Catalog extends Context.Service<Catalog, {
  readonly load: Effect.Effect<CatalogEntry[], AppError>;
  readonly refreshBrew: Effect.Effect<CatalogSnapshot, AppError>;
  readonly refreshNix: Effect.Effect<CatalogSnapshot, AppError>;
  readonly search: (query: string, source: string) => Effect.Effect<{ entries: CatalogEntry[]; warnings: string[] }, AppError>;
  readonly clear: Effect.Effect<void, AppError>;
}>()('nixstore/Catalog') {
  static readonly layer = Layer.effect(Catalog, Effect.gen(function* () {
    const storage = yield* Storage;
    const http = yield* Http;
    const shell = yield* Shell;
    const discovery = yield* Discovery;
    const fs = yield* FileSystem.FileSystem;
    const searchNix = (query: string) => Effect.gen(function* () {
        // Discover the public website's current schema and read-only search credentials.
        // These are intentionally published in its JS; no private/user credential is used.
        const page = yield* http.text('https://search.nixos.org/', 1024 * 1024);
        const scriptPath = page.match(/src="(\/static\/js\/index\.[^"]+\.js)"/)?.[1];
        if (!scriptPath) return yield* Effect.fail(new AppError({ message: 'The Nix search service changed. The saved catalog is still available.' }));
        const javascript = yield* http.text(`https://search.nixos.org${scriptPath}`, 8 * 1024 * 1024);
        const schema = javascript.match(/elasticsearchMappingSchemaVersion:parseInt\("(\d+)"\)/)?.[1];
        const user = javascript.match(/elasticsearchUsername:"([^"]+)"/)?.[1];
        const password = javascript.match(/elasticsearchPassword:"([^"]+)"/)?.[1];
        if (!schema || !user || !password) return yield* Effect.fail(new AppError({ message: 'The public Nix catalog configuration is unavailable. Try again later.' }));
        let index = `latest-${schema}-nixos-unstable`;
        let after: unknown[] | undefined;
        const entries: CatalogEntry[] = [];
        for (let pageNumber = 0; pageNumber < 1; pageNumber++) {
          const body = {
            size: 200, sort: ['_score', { package_attr_name: 'asc' }], ...(after ? { search_after: after } : {}),
            _source: ['package_attr_name', 'package_pname', 'package_pversion', 'package_platforms', 'package_description', 'package_homepage', 'package_mainProgram', 'package_outputs', 'package_desktop_entries'],
            query: { bool: { must: [{ simple_query_string: { query, fields: ['package_attr_name^5', 'package_pname^4', 'package_description'], default_operator: 'and', flags: 'NONE' } }], filter: [{ term: { type: 'package' } }, { terms: { package_platforms: darwin } }] } },
          };
          const response = yield* http.text(`https://search.nixos.org/backend/${index}/_search`, 8 * 1024 * 1024, {
            body, headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}` },
          }).pipe(Effect.flatMap(parseJson<Json>));
          const hits = response.hits?.hits;
          if (!Array.isArray(hits) || response.timed_out) return yield* Effect.fail(new AppError({ message: 'The Nix catalog response was incomplete. Your saved catalog was kept.' }));
          if (!hits.length) break;
          const pinnedIndex = hits[0]._index;
          if (!/^nixos-[a-zA-Z0-9-]+$/.test(pinnedIndex)) return yield* Effect.fail(new AppError({ message: 'Unexpected Nix catalog index.' }));
          index = pinnedIndex;
          for (const hit of hits) {
            const p = hit._source;
            const id = p.package_attr_name;
            if (!validIdentifier('nix', id ?? '')) continue;
            const platforms = darwin.filter(system => (p.package_platforms ?? []).includes(system));
            const gui = /\.app\b/.test(JSON.stringify(p.package_outputs ?? [])) || !!p.package_desktop_entries?.length || !p.package_mainProgram && /\b(graphical|desktop|GUI|browser|editor)\b/i.test(p.package_description ?? '');
            entries.push({ id: `nix:${id}`, key: id, name: p.package_pname ?? id, description: p.package_description ?? '',
              kind: gui ? 'gui' : 'cli', aliases: [id], homepage: safeUrl(p.package_homepage?.[0]),
              sources: [{ manager: 'nix', identifier: id, version: p.package_pversion ?? 'unknown', platforms }],
            });
          }
          if (hits.length < 3000) break;
          after = hits.at(-1).sort;
          if (pageNumber === 99) return yield* Effect.fail(new AppError({ message: 'The Nix catalog exceeded its page limit. The saved catalog was kept.' }));
        }
        return entries;
      });
    return {
      load: Effect.gen(function* () {
        const brew = yield* storage.read<CatalogSnapshot | null>('catalog-brew', null);
        const nix = yield* storage.read<CatalogSnapshot | null>('catalog-nix', null);
        return unify([...(brew?.entries ?? []), ...(nix?.entries ?? [])]);
      }),
      refreshBrew: Effect.gen(function* () {
        const [formulae, casks] = yield* Effect.all([
          http.text('https://formulae.brew.sh/api/formula.json').pipe(Effect.flatMap(parseJson<Json[]>)),
          http.text('https://formulae.brew.sh/api/cask.json').pipe(Effect.flatMap(parseJson<Json[]>)),
        ], { concurrency: 2 });
        if (!Array.isArray(formulae) || !Array.isArray(casks)) return yield* Effect.fail(new AppError({ message: 'Homebrew returned an unexpected catalog format.' }));
        const snapshot: CatalogSnapshot = { entries: normalizeBrew(formulae, casks), refreshedAt: new Date().toISOString(), source: 'brew' };
        yield* storage.write('catalog-brew', snapshot);
        return snapshot;
      }),
      refreshNix: Effect.gen(function* () {
        // Discover the public website's current schema and read-only search credentials.
        // These are intentionally published in its JS; no private/user credential is used.
        const page = yield* http.text('https://search.nixos.org/', 1024 * 1024);
        const scriptPath = page.match(/src="(\/static\/js\/index\.[^"]+\.js)"/)?.[1];
        if (!scriptPath) return yield* Effect.fail(new AppError({ message: 'The Nix search service changed. The saved catalog is still available.' }));
        const javascript = yield* http.text(`https://search.nixos.org${scriptPath}`, 8 * 1024 * 1024);
        const schema = javascript.match(/elasticsearchMappingSchemaVersion:parseInt\("(\d+)"\)/)?.[1];
        const user = javascript.match(/elasticsearchUsername:"([^"]+)"/)?.[1];
        const password = javascript.match(/elasticsearchPassword:"([^"]+)"/)?.[1];
        if (!schema || !user || !password) return yield* Effect.fail(new AppError({ message: 'The public Nix catalog configuration is unavailable. Try again later.' }));
        let index = `latest-${schema}-nixos-unstable`;
        let after: unknown[] | undefined;
        const entries: CatalogEntry[] = [];
        for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
          const body = {
            size: 3000, sort: [{ package_attr_name: 'asc' }], ...(after ? { search_after: after } : {}),
            _source: ['package_attr_name', 'package_pname', 'package_pversion', 'package_platforms', 'package_description', 'package_homepage', 'package_mainProgram', 'package_outputs', 'package_desktop_entries'],
            query: { bool: { filter: [{ term: { type: 'package' } }, { terms: { package_platforms: darwin } }] } },
          };
          const response = yield* http.text(`https://search.nixos.org/backend/${index}/_search`, 8 * 1024 * 1024, {
            body, headers: { Authorization: `Basic ${btoa(`${user}:${password}`)}` },
          }).pipe(Effect.flatMap(parseJson<Json>));
          const hits = response.hits?.hits;
          if (!Array.isArray(hits) || response.timed_out) return yield* Effect.fail(new AppError({ message: 'The Nix catalog response was incomplete. Your saved catalog was kept.' }));
          if (!hits.length) break;
          const pinnedIndex = hits[0]._index;
          if (!/^nixos-[a-zA-Z0-9-]+$/.test(pinnedIndex)) return yield* Effect.fail(new AppError({ message: 'Unexpected Nix catalog index.' }));
          index = pinnedIndex;
          for (const hit of hits) {
            const p = hit._source;
            const id = p.package_attr_name;
            if (!validIdentifier('nix', id ?? '')) continue;
            const platforms = darwin.filter(system => (p.package_platforms ?? []).includes(system));
            const gui = /\.app\b/.test(JSON.stringify(p.package_outputs ?? [])) || !!p.package_desktop_entries?.length || !p.package_mainProgram && /\b(graphical|desktop|GUI|browser|editor)\b/i.test(p.package_description ?? '');
            entries.push({ id: `nix:${id}`, key: id, name: p.package_pname ?? id, description: p.package_description ?? '',
              kind: gui ? 'gui' : 'cli', aliases: [id], homepage: safeUrl(p.package_homepage?.[0]),
              sources: [{ manager: 'nix', identifier: id, version: p.package_pversion ?? 'unknown', platforms }],
            });
          }
          if (hits.length < 3000) break;
          after = hits.at(-1).sort;
          if (pageNumber === 99) return yield* Effect.fail(new AppError({ message: 'The Nix catalog exceeded its page limit. The saved catalog was kept.' }));
        }
        if (!entries.length) return yield* Effect.fail(new AppError({ message: 'Nix returned no compatible packages.' }));
        const snapshot: CatalogSnapshot = { entries, refreshedAt: new Date().toISOString(), source: 'nix' };
        yield* storage.write('catalog-nix', snapshot);
        return snapshot;
      }).pipe(Effect.timeout('5 minutes'), Effect.mapError(failure('The Nix catalog could not refresh. The saved catalog is still available.'))),
      search: (query, source) => Effect.gen(function* () {
        const requests: { name: string; effect: Effect.Effect<readonly CatalogEntry[], AppError> }[] = [];
        if (source === 'all' || source.startsWith('brew')) requests.push({ name: 'Homebrew', effect: Effect.gen(function* () {
          const [formulae, casks] = yield* Effect.all([
            http.text('https://formulae.brew.sh/api/formula.json').pipe(Effect.flatMap(parseJson<Json[]>)),
            http.text('https://formulae.brew.sh/api/cask.json').pipe(Effect.flatMap(parseJson<Json[]>)),
          ], { concurrency: 2 });
          if (!Array.isArray(formulae) || !Array.isArray(casks)) return yield* Effect.fail(new AppError({ message: 'Unexpected Homebrew response.' }));
          return normalizeBrew(formulae, casks);
        }) });
        if (source === 'all' || source === 'nix') requests.push({ name: 'Nix', effect: searchNix(query) });
        const results = yield* Effect.all(requests.map(request => request.effect.pipe(
          Effect.map(entries => ({ entries, warning: '' })),
          Effect.catch(error => Effect.succeed({ entries: [] as readonly CatalogEntry[], warning: `${request.name}: ${error.message}` })),
        )), { concurrency: 2 });
        return { entries: unify(results.flatMap(result => [...result.entries])), warnings: results.map(result => result.warning).filter(Boolean) };
      }),
      clear: Effect.gen(function* () {
        for (const name of ['catalog-brew', 'catalog-nix']) yield* fs.remove(`${dataRoot}/${name}.json`, { force: true });
      }).pipe(Effect.mapError(failure('Could not clear the catalog cache.'))),
    };
  }));
}
