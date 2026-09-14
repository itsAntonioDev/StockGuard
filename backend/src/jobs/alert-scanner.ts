import type { FastifyBaseLogger } from 'fastify';
import { getPrisma } from '../lib/prisma.js';
import { scanPendingOperations } from '../services/alert.service.js';

/** Lock consultivo: com várias instâncias da API, apenas uma executa a varredura. */
const SCANNER_LOCK_ID = 7_210_002;
const DEFAULT_INTERVAL_MS = 5 * 60_000;

export function startAlertScanner(log: FastifyBaseLogger, intervalMs = DEFAULT_INTERVAL_MS): () => void {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await getPrisma().$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(${SCANNER_LOCK_ID}) AS locked`;
          if (!rows[0]?.locked) return;
          const result = await scanPendingOperations(tx);
          log.debug(result, 'Varredura de operações pendentes concluída');
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      log.error({ err: error }, 'Falha na varredura de alertas');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
