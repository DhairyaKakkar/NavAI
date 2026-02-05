import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'fs';

const watch = process.argv.includes('--watch');

if (!existsSync('dist'))    mkdirSync('dist', { recursive: true });
if (!existsSync('dist/ui')) mkdirSync('dist/ui', { recursive: true });

const shared = {
  bundle: true,
  target: 'chrome120',
  minify: !watch,
  logLevel: 'info',
};

async function run() {
  const configs = [
    { ...shared, entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'esm' },
    { ...shared, entryPoints: ['src/content.ts'],    outfile: 'dist/content.js',    format: 'iife' },
    { ...shared, entryPoints: ['src/ui/sidepanel.ts'], outfile: 'dist/ui/sidepanel.js', format: 'iife' },
  ];

  if (watch) {
    const ctxs = await Promise.all(configs.map(c => esbuild.context(c)));
    await Promise.all(ctxs.map(c => c.watch()));
    console.log('\n  Watching for changes…\n');
  } else {
    await Promise.all(configs.map(c => esbuild.build(c)));
  }

  // Copy static assets into dist/
  cpSync('manifest.json',        'dist/manifest.json');
  cpSync('src/ui/sidepanel.html', 'dist/ui/sidepanel.html');
  cpSync('src/ui/sidepanel.css',  'dist/ui/sidepanel.css');

  if (!watch) console.log('\n  Build complete → dist/\n');
}

run().catch(e => { console.error(e); process.exit(1); });
