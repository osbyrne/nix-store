import solidPlugin from '@gpuix/solid/bun-plugin';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const addon = require.resolve(`@gpuix/native-darwin-${process.arch}`);
const nativePlugin: import('bun').BunPlugin = {
  name: 'embed-gpuix-native',
  setup(build) {
    // NAPI's generated createRequire loader becomes opaque after bundling.
    // A static .node import lets Bun embed/extract the actual addon.
    build.onLoad({ filter: /[/\\]@gpuix[/\\]native[/\\]index\.js$/ }, () => ({
      loader: 'js', contents: `import binding from ${JSON.stringify(addon)};
        export const { AvailableUpdate, GpuixRenderer, TestGpuixRenderer, checkUpdate, hasTestGpuixRenderer, isTerminal } = binding;
        export const __napiBindingTarget = 'native';`,
    }));
  },
};
const result = await Bun.build({
  entrypoints: ['./src/main.tsx'], target: 'bun',
  ...(process.argv.includes('--compile') ? { compile: { outfile: './dist/nixstore', autoloadBunfig: false, autoloadDotenv: false } } : { outdir: './dist' }),
  plugins: [solidPlugin, nativePlugin],
});
if (!result.success) throw new AggregateError(result.logs, 'Build failed');
console.log(process.argv.includes('--compile') ? 'Native executable built in dist/nixstore' : 'Solid production bundle built in dist/main.js');
