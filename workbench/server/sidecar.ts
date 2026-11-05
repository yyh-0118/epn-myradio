import { buildApp } from './app';

const app = buildApp();
const parentPort = (process as typeof process & {
  parentPort?: { on: (event: 'message', listener: (event: { data?: { type?: string } }) => void) => void; postMessage: (message: unknown) => void };
}).parentPort;
const host = '127.0.0.1';
const requestedPort = Math.max(0, Math.min(65535, Number(process.env.AFTERGLOW_PORT) || 0));
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await app.close(); } finally { process.exit(0); }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
parentPort?.on('message', (event) => {
  if (event.data?.type === 'afterglow.shutdown') void shutdown();
});

try {
  await app.listen({ port: requestedPort, host });
  const address = app.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  if (!port) throw new Error('Sidecar did not receive a loopback port.');
  parentPort?.postMessage({ type: 'afterglow.ready', port, pid: process.pid });
  if (!parentPort) console.log(JSON.stringify({ type: 'afterglow.ready', port, pid: process.pid }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unable to start Afterglow sidecar';
  parentPort?.postMessage({ type: 'afterglow.error', message });
  console.error(message);
  process.exit(1);
}
