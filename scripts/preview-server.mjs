// Servidor de preview del juego F1.
// Arranca Vite por API y mantiene el proceso vivo aunque stdin sea /dev/null
// (así funciona bajo launchd, donde `npm run dev` se apaga).
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PREVIEW_PORT || 5174);
const HOST = '127.0.0.1';

const server = await createServer({
  root: ROOT,
  server: { port: PORT, strictPort: true, host: HOST },
  logLevel: 'info',
});

await server.listen();

const keepAlive = setInterval(() => {}, 1 << 30);
const shutdown = async () => {
  clearInterval(keepAlive);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
