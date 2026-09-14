import * as controller from '../controllers/discrepancy.controller.js';
import type { App } from '../types/fastify.js';
import { idParamSchema } from '../validators/common.js';
import {
  discrepancyAssignSchema,
  discrepancyCommentSchema,
  discrepancyCreateSchema,
  discrepancyListQuerySchema,
  discrepancyStatusChangeSchema,
  evidenceParamsSchema,
} from '../validators/discrepancy.schemas.js';

export async function discrepancyRoutes(app: App) {
  const tags = ['Divergências'];
  const read = { permissions: ['discrepancies.read.own' as const, 'discrepancies.read.all' as const] };
  const contribute = { permissions: ['discrepancies.create' as const, 'discrepancies.manage' as const] };

  app.get('/discrepancies', { config: read, schema: { tags, querystring: discrepancyListQuerySchema } }, controller.listDiscrepancies);

  app.get('/discrepancies/:id', { config: read, schema: { tags, params: idParamSchema } }, controller.getDiscrepancy);

  app.post('/discrepancies', {
    config: { permissions: ['discrepancies.create'] },
    schema: { tags, body: discrepancyCreateSchema },
  }, controller.createDiscrepancy);

  app.post('/discrepancies/:id/status', {
    config: { permissions: ['discrepancies.manage'] },
    schema: { tags, params: idParamSchema, body: discrepancyStatusChangeSchema },
  }, controller.changeStatus);

  app.post('/discrepancies/:id/assign', {
    config: { permissions: ['discrepancies.manage'] },
    schema: { tags, params: idParamSchema, body: discrepancyAssignSchema },
  }, controller.assign);

  app.post('/discrepancies/:id/comments', {
    config: contribute,
    schema: { tags, params: idParamSchema, body: discrepancyCommentSchema },
  }, controller.comment);

  // Upload multipart (sem schema de corpo); limite de tamanho e tipo validados no servidor.
  app.post('/discrepancies/:id/evidences', {
    config: { ...contribute, rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags, params: idParamSchema },
  }, controller.uploadEvidence);

  app.get('/discrepancies/:id/evidences/:evidenceId', {
    config: read,
    schema: { tags, params: evidenceParamsSchema },
  }, controller.downloadEvidence);
}
