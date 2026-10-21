import { expect, test } from 'bun:test';
import { createTestRoot } from '@gpuix/solid/testing';
import { connectTest } from '@gpuix/solid/automation';
import { makeAppRuntime } from '../src/app/runtime';
import { memoryStorage } from './helpers';
import { App } from '../src/ui/App';

test('native controls navigate and focus search with Cmd+K', async () => {
  const runtime = makeAppRuntime(memoryStorage().layer);
  const root = createTestRoot({ width: 1120, height: 760 });
  root.render(() => <App runtime={runtime} start={false} />);
  const app = await connectTest(root.renderer);
  try {
    await app.getByText('Native runtime ready').waitFor();
    await app.getByTestId('nav-settings').click();
    await app.getByText('Preferred source').waitFor();
    await app.getByText('Automatic').press('cmd-k');
    const search = await app.getByTestId('search').waitFor();
    expect(root.renderer.getFocusedElementId()).toBe(search.id);
    root.renderer.simulateKeystrokes('h e l l o');
    await app.getByTestId('search-preview').waitFor();
    expect(await app.getByTestId('search-preview').textContent()).toContain('hello');
    root.renderer.simulateKeystrokes('tab');
    expect(root.renderer.getFocusedElementId()).not.toBe(search.id);
  } finally { await app.close(); root.unmount(); await runtime.dispose(); }
});
