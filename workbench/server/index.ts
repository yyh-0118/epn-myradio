import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app';

const app = buildApp();
const root = fileURLToPath(new URL('../dist', import.meta.url));
if (existsSync(root)) await app.register(fastifyStatic, { root });
const shutdown = async () => { await app.close(); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  await app.listen({ port: 3108, host: '127.0.0.1' });
  console.log('Afterglow API: http://127.0.0.1:3108');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to start Afterglow');
  process.exit(1);
}
