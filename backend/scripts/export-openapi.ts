/** Gera backend/openapi.json a partir das rotas e schemas Zod (contrato para o frontend e integrações). */
import { writeFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import { disconnectPrisma } from '../src/lib/prisma.js';

const app = await buildApp();
try {
  await app.ready();
  await writeFile('openapi.json', `${JSON.stringify(app.swagger(), null, 2)}\n`, 'utf8');
  console.log('OpenAPI gerado em backend/openapi.json');
} finally {
  await app.close();
  await disconnectPrisma();
}
