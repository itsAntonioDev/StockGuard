import * as controller from '../controllers/alert.controller.js';
import type { App } from '../types/fastify.js';
import { alertListQuerySchema } from '../validators/alert.schemas.js';
import { idParamSchema } from '../validators/common.js';

export async function alertRoutes(app: App) {
  const tags = ['Alertas'];

  app.get('/alerts', { config: { permissions: ['alerts.read'] }, schema: { tags, querystring: alertListQuerySchema } }, controller.listAlerts);

  app.get('/alerts/summary', { config: { permissions: ['alerts.read'] }, schema: { tags } }, controller.summary);

  app.post('/alerts/:id/acknowledge', { config: { permissions: ['alerts.manage'] }, schema: { tags, params: idParamSchema } }, controller.acknowledge);

  app.post('/alerts/:id/resolve', { config: { permissions: ['alerts.manage'] }, schema: { tags, params: idParamSchema } }, controller.resolve);
}
