import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const run = (executable: string, args: string[]) => {
  const child = Bun.spawnSync([executable, ...args], { stdout: 'inherit', stderr: 'inherit', env: process.env });
  if (child.exitCode !== 0) throw new Error(`${executable} exited with ${child.exitCode}`);
};
run(process.execPath, ['scripts/build.ts', '--compile']);
const config = JSON.parse(await readFile('packager.json', 'utf8'));
if (process.argv.includes('--app')) config.formats = ['app'];
// Never advertise an older macOS baseline than the embedded runtime supports.
const macho = execFileSync('/usr/bin/otool', ['-l', 'dist/nixstore'], { encoding: 'utf8' });
const minimum = macho.match(/minos\s+(\d+\.\d+(?:\.\d+)?)/)?.[1];
if (minimum) config.macos.minimumSystemVersion = minimum;
await writeFile('.packager-local.json', JSON.stringify(config, null, 2));
try {
  run(process.env.CARGO_PACKAGER ?? 'cargo-packager', ['--config', '.packager-local.json']);
  console.log(`Unsigned local build complete; minimum macOS ${config.macos.minimumSystemVersion}.`);
} finally { await unlink('.packager-local.json'); }
