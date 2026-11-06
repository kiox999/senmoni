import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = await build({
  entryPoints: [path.join(root, 'sync-src/entry.js')],
  outfile: path.join(root, 'sync.bundle.js'),
  bundle: true, minify: true, format: 'iife', target: ['es2018', 'safari13'],
  legalComments: 'none', metafile: true, logLevel: 'info',
  banner: { js: '/* 自動生成: npm run build（ソースは sync-src/） */' }
});
const out = Object.values(r.metafile.outputs)[0];
console.log('sync.bundle.js', Math.round(out.bytes / 1024) + ' KB');
