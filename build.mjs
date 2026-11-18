// node build.mjs → dist/app.js，並將版本號寫入 index.html / sw.js
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['safari15', 'chrome100'],
  outfile: 'dist/app.js',
  legalComments: 'linked',
  logLevel: 'info',
});
const h = createHash('sha256');
for (const f of ['dist/app.js', 'styles.css']) h.update(readFileSync(f));
const version = h.digest('hex').slice(0, 8);
for (const [src, out] of [['src/index.template.html', 'index.html'], ['src/sw.template.js', 'sw.js']]) {
  writeFileSync(out, readFileSync(src, 'utf8').replaceAll('__VERSION__', version));
}
writeFileSync('dist/app.js', readFileSync('dist/app.js', 'utf8').replaceAll('__VERSION__', version));
console.log('version', version);
