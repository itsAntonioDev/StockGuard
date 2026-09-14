import { z } from 'zod';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { getPrisma, type DbClient } from '../lib/prisma.js';
import type { RequestContext } from '../utils/request-context.js';
import { writeAudit } from './audit.service.js';

/**
 * Configurações operacionais editáveis pelo administrador.
 * Cada chave tem schema próprio: nada é gravado sem validação.
 */
export const SETTING_DEFINITIONS = {
  'check.requiredTypes': {
    description: 'Tipos de movimentação que exigem conferência antes de alterar o estoque.',
    schema: z.array(z.enum(['ENTRY', 'EXIT', 'PICKING', 'TRANSFER'])).max(4),
    defaultValue: ['ENTRY', 'EXIT', 'PICKING', 'TRANSFER'] as Array<'ENTRY' | 'EXIT' | 'PICKING' | 'TRANSFER'>,
  },
  'check.allowSelfCheck': {
    description: 'Permite que quem criou a movimentação também a confira (desativado = dupla checagem).',
    schema: z.boolean(),
    defaultValue: false,
  },
  'alerts.pendingHours': {
    description: 'Horas para uma operação pendente gerar alerta.',
    schema: z.number().int().min(1).max(720),
    defaultValue: 4,
  },
  'alerts.invalidAttempts': {
    description: 'Tentativas de conferência incorretas, por usuário, dentro da janela, para gerar alerta.',
    schema: z.object({ count: z.number().int().min(2).max(100), windowMinutes: z.number().int().min(1).max(1440) }),
    defaultValue: { count: 5, windowMinutes: 15 },
  },
  'alerts.recurringDiscrepancy': {
    description: 'Divergências do mesmo produto, dentro da janela, para gerar alerta de recorrência.',
    schema: z.object({ count: z.number().int().min(2).max(100), windowDays: z.number().int().min(1).max(365) }),
    defaultValue: { count: 3, windowDays: 30 },
  },
  'productivity.minSampleSize': {
    description: 'Quantidade mínima de operações para exibir indicadores e sugestões (evita conclusões com pouca amostra).',
    schema: z.number().int().min(5).max(1000),
    defaultValue: 20,
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFINITIONS)[K]['defaultValue'];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

export async function getSetting<K extends SettingKey>(key: K, db: DbClient = getPrisma()): Promise<SettingValue<K>> {
  const definition = SETTING_DEFINITIONS[key];
  const row = await db.systemSetting.findUnique({ where: { key } });
  if (!row) return definition.defaultValue;
  const parsed = definition.schema.safeParse(row.value);
  // Valor corrompido no banco nunca derruba a operação: volta ao padrão seguro.
  return (parsed.success ? parsed.data : definition.defaultValue) as SettingValue<K>;
}

export async function listSettings() {
  const rows = await getPrisma().systemSetting.findMany({ include: { updatedBy: { select: { id: true, name: true } } } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return (Object.keys(SETTING_DEFINITIONS) as SettingKey[]).map((key) => {
    const row = byKey.get(key);
    const parsed = row ? SETTING_DEFINITIONS[key].schema.safeParse(row.value) : null;
    return {
      key,
      description: SETTING_DEFINITIONS[key].description,
      value: parsed?.success ? parsed.data : SETTING_DEFINITIONS[key].defaultValue,
      isDefault: !row,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

export async function updateSetting(key: string, value: unknown, actorId: string, context: RequestContext) {
  if (!isSettingKey(key)) throw new NotFoundError('Configuração inexistente.');
  const parsed = SETTING_DEFINITIONS[key].schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Valor inválido para a configuração.', parsed.error.issues.map((issue) => issue.message));
  }

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const before = await getSetting(key, tx);
    const row = await tx.systemSetting.upsert({
      where: { key },
      create: { key, value: parsed.data, updatedById: actorId },
      update: { value: parsed.data, updatedById: actorId },
    });
    await writeAudit(tx, context, {
      action: 'settings.update',
      result: 'SUCCESS',
      entityType: 'SystemSetting',
      entityId: key,
      metadata: { before, after: parsed.data },
    });
    return row;
  });
}
