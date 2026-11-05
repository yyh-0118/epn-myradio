'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { after, before, test } = require('node:test');

const root = path.resolve(__dirname, '..');
let sidecar;
let server;
let sidecarPort = 0;
let serverPort = 0;
const token = 'integration-' + Math.random().toString(36).slice(2);

function openPort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForLine(child, predicate, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Process output timeout: ${output}`)), timeout);
    const onData = (chunk) => {
      output += String(chunk);
      for (const line of output.split(/\r?\n/)) {
        try {
          const parsed = JSON.parse(line);
          if (predicate(parsed)) { clearTimeout(timer); child.stdout.off('data', onData); resolve(parsed); return; }
        } catch (_) {}
      }
    };
    child.stdout.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Process exited before ready: ${code}`)); });
  });
}

async function waitForHttp(url, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const response = await fetch(url); if (response.status < 500) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HTTP readiness timeout: ${url}`);
}

before(async () => {
  sidecar = spawn(process.execPath, ['build/afterglow-sidecar/index.mjs'], {
    cwd: root, env: { ...process.env, AFTERGLOW_SIDECAR_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  sidecar.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const ready = await waitForLine(sidecar, (message) => message.type === 'afterglow.ready');
  sidecarPort = ready.port;
  serverPort = await openPort();
  server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(serverPort), AFTERGLOW_SIDECAR_PORT: String(sidecarPort), AFTERGLOW_SIDECAR_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await waitForHttp(`http://127.0.0.1:${serverPort}/`);
});

after(() => {
  server?.kill('SIGTERM');
  sidecar?.kill('SIGTERM');
});

test('proxy exposes identified health without wildcard CORS', async () => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/afterglow-api/health`, { headers: { origin: `http://127.0.0.1:${serverPort}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await response.json()).service, 'afterglow-analysis');
});

test('proxy runs EPN rules and rejects foreign origins and routes', async () => {
  const response = await fetch(`http://127.0.0.1:${serverPort}/afterglow-api/analysis/run`, {
    method: 'POST', headers: { origin: `http://127.0.0.1:${serverPort}`, 'content-type': 'application/json', cookie: 'must-not-be-forwarded=1', authorization: 'Bearer must-not-be-forwarded' },
    body: JSON.stringify({ rawLyrics: '晚风经过街巷\n心事轻轻收藏\n站台望向远方\n落日放在心上' }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.source, 'rules');
  assert.ok(result.units.length > 0);
  assert.ok(result.steps.length > 5);
  const foreign = await fetch(`http://127.0.0.1:${serverPort}/afterglow-api/health`, { headers: { origin: 'https://unrelated.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`http://127.0.0.1:${serverPort}/afterglow-api/unknown`)).status, 404);
});

test('sidecar rejects direct unauthenticated access', async () => {
  const response = await fetch(`http://127.0.0.1:${sidecarPort}/api/health`);
  assert.equal(response.status, 401);
});

test('sidecar crash degrades to a structured proxy error', async () => {
  const exited = new Promise((resolve) => sidecar.once('exit', resolve));
  sidecar.kill('SIGTERM');
  await exited;
  const response = await fetch(`http://127.0.0.1:${serverPort}/afterglow-api/health`);
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.error, 'AFTERGLOW_SIDECAR_FAILED');
  assert.match(result.message, /笔记和播放不受影响/);
});
