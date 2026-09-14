import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { startAlertScanner } from './jobs/alert-scanner.js';
import { disconnectPrisma } from './lib/prisma.js';

const env = getEnv();
const app = await buildApp();
const stopAlertScanner = startAlertScanner(app.log);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Encerrando a API');
  stopAlertScanner();
  await app.close();
  await disconnectPrisma();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error({ err: error }, 'Falha ao iniciar a API');
  await disconnectPrisma();
  process.exit(1);
}
