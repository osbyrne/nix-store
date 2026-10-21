import { execFile } from 'node:child_process';
import { createSignal, onCleanup } from 'solid-js';

type Appearance = 'light' | 'dark';

// GPUIX does not expose native appearance notifications. Read the macOS
// preference periodically so an open window follows automatic theme changes.
export function createSystemAppearance() {
  const [appearance, setAppearance] = createSignal<Appearance>('light');
  if (process.platform !== 'darwin') return appearance;
  let disposed = false;
  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    execFile('/usr/bin/defaults', ['read', '-g', 'AppleInterfaceStyle'], { timeout: 1500 }, (error, stdout) => {
      pending = false;
      if (!disposed) setAppearance(!error && stdout.trim() === 'Dark' ? 'dark' : 'light');
    });
  };
  refresh();
  const timer = setInterval(refresh, 2000);
  onCleanup(() => { disposed = true; clearInterval(timer); });
  return appearance;
}
