'use strict';

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'afterglow-sidecar');

async function build() {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'workbench', 'server', 'sidecar.ts')],
    outfile: path.join(output, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    minify: false,
    legalComments: 'linked',
    banner: { js: "import { createRequire as __afterglowCreateRequire } from 'node:module'; const require = __afterglowCreateRequire(import.meta.url);" },
  });
  fs.copyFileSync(
    path.join(root, 'workbench', 'vendor', 'epn', 'server', 'prompts', 'rhyme-analysis.zh.md'),
    path.join(output, 'rhyme-analysis.zh.md'),
  );
  console.log('Afterglow analysis sidecar built in build/afterglow-sidecar/.');
}

build().catch((error) => { console.error(error); process.exit(1); });
