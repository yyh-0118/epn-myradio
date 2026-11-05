'use strict';

const { execFileSync } = require('node:child_process');
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const workbench = join(root, 'workbench');
const output = join(root, 'public', 'afterglow');
if (process.platform === 'win32') {
  execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run build'], { cwd: workbench, stdio: 'inherit' });
} else {
  execFileSync('npm', ['run', 'build'], { cwd: workbench, stdio: 'inherit' });
}
const source = join(workbench, 'dist');
if (!existsSync(source)) throw new Error('Workbench build did not produce dist/.');
rmSync(output, { recursive: true, force: true });
cpSync(source, output, { recursive: true });
console.log('Afterglow workbench copied to public/afterglow/.');
