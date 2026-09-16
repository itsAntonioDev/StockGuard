import * as controller from '../controllers/auth.controller.js';
import type { App } from '../types/fastify.js';
import { changePasswordBodySchema, loginBodySchema, mfaCodeBodySchema } from '../validators/auth.schemas.js';
import { idParamSchema } from '../validators/common.js';

const ALL_STEPS = ['MFA_SETUP', 'MFA_VERIFY', 'CHANGE_PASSWORD'] as const;

export async function authRoutes(app: App, options: { loginRateLimitMax: number }) {
  const tags = ['Autenticação'];
  const strictLimit = { max: options.loginRateLimitMax, timeWindow: '1 minute' };

  app.post('/auth/login', {
    config: { public: true, rateLimit: strictLimit },
    schema: { tags, body: loginBodySchema },
  }, controller.login);

  app.post('/auth/logout', {
    config: { permissions: [], allowSteps: [...ALL_STEPS] },
    schema: { tags },
  }, controller.logout);

  app.get('/auth/me', {
    config: { permissions: [], allowSteps: [...ALL_STEPS] },
    schema: { tags },
  }, controller.me);

  app.post('/auth/mfa/setup', {
    config: { permissions: [], allowSteps: ['MFA_SETUP'] },
    schema: { tags },
  }, controller.startMfaSetup);

  app.post('/auth/mfa/confirm', {
    config: { permissions: [], allowSteps: ['MFA_SETUP'], rateLimit: strictLimit },
    schema: { tags, body: mfaCodeBodySchema },
  }, controller.confirmMfaSetup);

  app.post('/auth/mfa/verify', {
    config: { permissions: [], allowSteps: ['MFA_VERIFY'], rateLimit: strictLimit },
    schema: { tags, body: mfaCodeBodySchema },
  }, controller.verifyMfa);

  app.post('/auth/change-password', {
    config: { permissions: [], allowSteps: ['CHANGE_PASSWORD'], rateLimit: strictLimit },
    schema: { tags, body: changePasswordBodySchema },
  }, controller.changePassword);

  app.delete('/auth/trusted-device', {
    config: { permissions: [], allowSteps: [...ALL_STEPS] },
    schema: { tags },
  }, controller.forgetTrustedDevice);

  app.get('/auth/sessions', {
    config: { permissions: [] },
    schema: { tags },
  }, controller.listSessions);

  app.delete('/auth/sessions/:id', {
    config: { permissions: [] },
    schema: { tags, params: idParamSchema },
  }, controller.revokeSession);
}
