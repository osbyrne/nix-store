import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const run = (command: string, args: string[]) => {
  const result = Bun.spawnSync([command, ...args], { stdout: 'ignore', stderr: 'inherit' });
  if (result.exitCode !== 0) throw new Error(`Icon conversion failed: ${command}`);
};
const directory = await mkdtemp(join(tmpdir(), 'nixstore-icon-'));
const iconset = join(directory, 'Nixstore.iconset');
try {
  await import('node:fs/promises').then(fs => fs.mkdir(iconset));
  run('/usr/bin/sips', ['-s', 'format', 'png', '-z', '1024', '1024', 'assets/icon-source.webp', '--out', 'assets/icon-1024.png']);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = String(size * scale);
      run('/usr/bin/sips', ['-z', pixels, pixels, 'assets/icon-1024.png', '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
    }
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', 'assets/Nixstore.icns']);
  console.log('Built Nixstore.icns from the supplied image, preserving transparency.');
} finally { await rm(directory, { recursive: true, force: true }); }
