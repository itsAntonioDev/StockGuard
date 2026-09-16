import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../auth/password.js';

export const loginBodySchema = z.object({
  email: z.email('E-mail inválido.').max(254),
  password: z.string().min(1, 'Informe a senha.').max(PASSWORD_MAX_LENGTH),
});

export const mfaCodeBodySchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/u, 'O código deve ter 6 dígitos.'),
  /** Dispensa o código neste navegador pelos próximos dias (MFA_REMEMBER_DAYS). */
  rememberDevice: z.boolean().default(false),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type MfaCodeBody = z.infer<typeof mfaCodeBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
