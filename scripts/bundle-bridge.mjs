// note-bridge を自己完結 ESM にバンドルする（@modelcontextprotocol/sdk を inline）。
// 配布時はこの1ファイルだけを resources に置けばよい（node_modules 不要 / asarUnpack 最小）。
// dev では src の bridge を直接使うため、これは packaged 用。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await build({
  entryPoints: [`${root}src/main/note/bridge/note-bridge.mjs`],
  outfile: `${root}out/bridge/note-bridge.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // ESM の import.meta / top-level await をそのまま使う
  banner: { js: '// bundled note-bridge (self-contained)\n' },
});

console.log('[bundle-bridge] wrote out/bridge/note-bridge.mjs');
