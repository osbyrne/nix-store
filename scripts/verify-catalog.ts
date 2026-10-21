import { Effect } from 'effect';
import { makeAppRuntime } from '../src/app/runtime';
import { Catalog, searchCatalog } from '../src/services/Catalog';
import { Discovery } from '../src/services/Discovery';
const runtime = makeAppRuntime();
try {
  await runtime.runPromise(Effect.gen(function* () {
    const tools = yield* (yield* Discovery).check;
    console.log('Discovery:', JSON.stringify(tools));
    const catalog = yield* Catalog;
    if (process.env.NIXSTORE_VERIFY_SOURCE !== 'nix') {
      const brew = yield* catalog.refreshBrew;
      console.log('Live Homebrew catalog:', brew.entries.length);
    }
    if (process.env.NIXSTORE_VERIFY_SOURCE === 'nix') {
      const nix = yield* catalog.refreshNix;
      console.log('Live Nix catalog:', nix.entries.length);
    }
    const entries = yield* catalog.load;
    console.log('Unified offline catalog:', entries.length);
    for (const query of ['firefox', 'ripgrep']) {
      const result = searchCatalog(entries, query, 'all', 'all', tools.platform);
      if (!result.length) throw new Error(`No ${query} results`);
      console.log(query, result.slice(0, 2).map(p => ({ name: p.name, sources: p.sources })));
    }
  }));
} finally { await runtime.dispose(); }
