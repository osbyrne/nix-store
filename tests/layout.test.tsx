import { expect, test } from 'bun:test';
import { createTestRoot } from '@gpuix/solid/testing';
import { connectTest } from '@gpuix/solid/automation';
import { App } from '../src/ui/App';
import { normalizeBrew } from '../src/services/Catalog';
import { makeAppRuntime } from '../src/app/runtime';
import { memoryStorage } from './helpers';

for (const width of [900, 1120]) {
  test(`catalog rows contain their labels at ${width}px`, async () => {
    const runtime = makeAppRuntime(memoryStorage().layer);
    const root = createTestRoot({ width, height: 760 });
    const catalog = normalizeBrew([], [
      { token: 'dotnet', name: ['.Net Runtime'], desc: 'Developer platform', version: '10.0.13' },
      { token: 'firefox', name: ['Mozilla Firefox'], desc: 'A deliberately very long browser description that must remain on a single truncated line in the result row', version: '158.0.1' },
    ]);
    root.render(() => <App runtime={runtime} start={false} initial={{ catalog }} />);
    const app = await connectTest(root.renderer);
    try {
      const rows = [];
      for (const key of ['dotnet', 'firefox']) {
        const row = await app.getByTestId(`package-row-${key}`).bounds();
        rows.push(row);
        for (const part of ['name', 'description', 'meta']) {
          const bounds = await app.getByTestId(`package-${part}-${key}`).bounds();
          expect(bounds.height).toBeLessThan(24);
          expect(bounds.y).toBeGreaterThanOrEqual(row.y);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(row.y + row.height);
        }
      }
      expect(rows[1]!.y).toBeGreaterThanOrEqual(rows[0]!.y + rows[0]!.height);
      expect(await app.getByTestId('package-meta-dotnet').textContent()).toBe('Mac app · Homebrew cask 10.0.13');
      const bounds = await app.getByTestId('app').bounds();
      expect(bounds.y).toBe(0);
    } finally { await app.close(); root.unmount(); await runtime.dispose(); }
  });
}
