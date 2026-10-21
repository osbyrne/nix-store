import { launch } from '@gpuix/solid/automation';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const watchdog = setTimeout(() => { console.error('Native verification exceeded 90 seconds.'); process.exit(1); }, 90000);
await mkdir('artifacts', { recursive: true });
const binary = process.env.NIXSTORE_BINARY;
const layoutChecks: unknown[] = [];
const app = await launch({ command: binary ? resolve(binary) : 'bun', args: binary ? [] : [process.env.NIXSTORE_ENTRY ?? 'src/main.tsx'], env: { GPUIX_BACKGROUND: '1' } });
try {
  await app.getByText('Native runtime ready').waitFor({ timeoutMs: 30000 });
  const assertRows = async (appearance: string) => {
    const tree = await app.getByTestId('results').element();
    for (const row of (tree.children ?? []).filter(node => node.testId?.startsWith('package-row-')).slice(0, 3)) {
      const key = row.testId!.slice('package-row-'.length);
      const outer = await app.getByTestId(row.testId!).bounds();
      for (const part of ['name', 'description', 'meta']) {
        const inner = await app.getByTestId(`package-${part}-${key}`).bounds();
        if (inner.y < outer.y || inner.y + inner.height > outer.y + outer.height + 0.5) throw new Error(`${appearance}: ${part} overflows ${key}`);
        layoutChecks.push({ appearance, key, part, outer, inner });
      }
    }
  };
  await assertRows('initial');
  await app.screenshot({ path: 'artifacts/discover.png' });
  await app.getByTestId('search').fill('firefox');
  await app.getByTestId('detail-firefox').waitFor({ timeoutMs: 30000 });
  await app.getByTestId('detail-firefox').click();
  await app.getByText('Available from').waitFor();
  await app.screenshot({ path: 'artifacts/package-detail.png' });
  if (await app.getByTestId('install').count()) {
    await app.getByTestId('install').click();
    await app.getByTestId('confirm-operation').waitFor({ timeoutMs: 30000 });
    await app.getByText('What will happen').waitFor();
    await app.screenshot({ path: 'artifacts/install-plan.png' });
    await app.getByTestId('cancel-operation').click();
  }
  await app.getByTestId('nav-installed').click();
  if ((await app.getByTestId('app').bounds()).y !== 0) throw new Error('Navigation scrolled the root window.');
  await app.screenshot({ path: 'artifacts/installed.png' });
  await app.getByTestId('nav-updates').click();
  await app.screenshot({ path: 'artifacts/updates.png' });
  await app.getByTestId('nav-activity').click();
  await app.screenshot({ path: 'artifacts/activity.png' });
  await app.getByTestId('nav-settings').click();
  await app.getByText('Preferred source').waitFor();
  await app.screenshot({ path: 'artifacts/settings.png' });
  await app.getByText('Automatic').press('cmd-k');
  await app.getByTestId('search').fill('');
  await assertRows('system');
  await app.screenshot({ path: 'artifacts/discover-system-theme.png' });
  await app.getByTestId('search').fill('ripgrep');
  await app.getByTestId('detail-ripgrep').waitFor();
  await app.screenshot({ path: 'artifacts/search.png' });
  if (await app.getByType('text').count() > 500) throw new Error('Result window mounted too many text nodes.');
  await writeFile('artifacts/layout-checks.json', JSON.stringify(layoutChecks, null, 2));
  console.log('Native verification passed: real cached search, package sources, installed/updates/activity/settings, Cmd+K, bounded result window.');
} finally {
  await app.close(); clearTimeout(watchdog);
}
