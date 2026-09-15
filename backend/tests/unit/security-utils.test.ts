import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, safeEqual, sha256Hex } from '../../src/auth/crypto.js';
import { hashPassword, validatePasswordPolicy, verifyPassword } from '../../src/auth/password.js';
import { computeLockMinutes } from '../../src/services/auth.service.js';
import { computeAuditHash } from '../../src/services/audit.service.js';
import { detectFileType, sanitizeFileName } from '../../src/services/evidence-storage.js';
import { pendingAuthStep } from '../../src/services/session.service.js';
import type { Env } from '../../src/config/env.js';
import { canonicalJson } from '../../src/utils/canonical-json.js';
import { escapeCsvCell, toCsv } from '../../src/utils/csv.js';
import { redactSensitive } from '../../src/utils/redact.js';

const key = randomBytes(32).toString('base64');

describe('criptografia de segredos (AES-256-GCM)', () => {
  it('cifra e decifra', () => {
    const payload = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(payload).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(payload, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('detecta adulteração e chave errada', () => {
    const payload = encryptSecret('segredo', key);
    const parts = payload.split('.');
    parts[3] = Buffer.from('xxxxxxx').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
    expect(() => decryptSecret(payload, randomBytes(32).toString('base64'))).toThrow();
  });

  it('comparação em tempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(sha256Hex('x')).toHaveLength(64);
  });
});

describe('senhas', () => {
  it('gera hash Argon2id e verifica', async () => {
    const hash = await hashPassword('Senha-Forte#2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Senha-Forte#2026')).toBe(true);
    expect(await verifyPassword(hash, 'senha-forte#2026')).toBe(false);
    expect(await verifyPassword('hash-invalido', 'x')).toBe(false);
  });

  it('aplica a política de senha', () => {
    expect(validatePasswordPolicy('Curta#1')).not.toHaveLength(0);
    expect(validatePasswordPolicy('somenteminusculas')).not.toHaveLength(0);
    expect(validatePasswordPolicy('Aaaaa-Senha#2026')).not.toHaveLength(0);
    expect(validatePasswordPolicy('joao.silva#X2026', { email: 'joao.silva@empresa.com' })).not.toHaveLength(0);
    expect(validatePasswordPolicy('Estoque-Seguro#2026', { email: 'ana@empresa.com', name: 'Ana Lima' })).toHaveLength(0);
  });

  it('bloqueio progressivo a partir da 5ª falha, limitado a 60 minutos', () => {
    expect(computeLockMinutes(4)).toBeNull();
    expect(computeLockMinutes(5)).toBe(1);
    expect(computeLockMinutes(6)).toBe(2);
    expect(computeLockMinutes(8)).toBe(8);
    expect(computeLockMinutes(20)).toBe(60);
  });

  it('exige MFA antes da troca de senha para perfis obrigados', () => {
    const env = { MFA_REQUIRED_ROLES: ['ADMIN'] } as unknown as Env;
    const role = { id: '1', code: 'ADMIN', name: 'Administrador' };
    expect(pendingAuthStep({ role, mfaEnabled: false, mustChangePassword: true }, false, env)).toBe('MFA_SETUP');
    expect(pendingAuthStep({ role, mfaEnabled: true, mustChangePassword: true }, false, env)).toBe('MFA_VERIFY');
    expect(pendingAuthStep({ role, mfaEnabled: true, mustChangePassword: true }, true, env)).toBe('CHANGE_PASSWORD');
    expect(pendingAuthStep({ role: { ...role, code: 'OPERATOR' }, mfaEnabled: false, mustChangePassword: false }, false, env)).toBeNull();
  });
});

describe('auditoria', () => {
  const record = {
    createdAt: '2026-09-15T12:00:00.000Z',
    requestId: 'r1',
    actorId: null,
    action: 'movements.create',
    entityType: 'StockMovement',
    entityId: 'm1',
    result: 'SUCCESS',
    ip: '127.0.0.1',
    userAgent: null,
    metadata: { b: 1, a: 2 },
  };

  it('hash independe da ordem das chaves e muda com qualquer alteração', () => {
    const first = computeAuditHash(null, record, key);
    expect(computeAuditHash(null, { ...record, metadata: { a: 2, b: 1 } }, key)).toBe(first);
    expect(computeAuditHash(null, { ...record, entityId: 'm2' }, key)).not.toBe(first);
    expect(computeAuditHash('0'.repeat(64), record, key)).not.toBe(first);
    expect(canonicalJson({ z: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"z":1}');
  });

  it('remove dados sensíveis sem apagar códigos de negócio', () => {
    const output = redactSensitive({ password: 'x', token: 'y', code: '123456', internalCode: 'P-1', nested: { newPassword: 'z' } }) as Record<string, unknown>;
    expect(output.password).toBe('[REDACTED]');
    expect(output.token).toBe('[REDACTED]');
    expect(output.code).toBe('[REDACTED]');
    expect(output.internalCode).toBe('P-1');
    expect((output.nested as Record<string, unknown>).newPassword).toBe('[REDACTED]');
  });
});

describe('CSV', () => {
  it('neutraliza fórmulas (CSV injection)', () => {
    expect(escapeCsvCell('=HYPERLINK("http://mal")')).toBe(`"'=HYPERLINK(""http://mal"")"`);
    expect(escapeCsvCell('+55 11')).toBe("'+55 11");
    expect(escapeCsvCell('-cmd')).toBe("'-cmd");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell(-5)).toBe('-5');
  });

  it('usa ; como separador, vírgula decimal e BOM UTF-8', () => {
    const csv = toCsv([{ header: 'Nome', value: (r: { n: string; q: number }) => r.n }, { header: 'Qtd', value: (r) => r.q }], [{ n: 'a;b', q: 1.5 }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"a;b";1,5');
  });
});

describe('evidências', () => {
  it('identifica o tipo pelos bytes, não pelo nome', () => {
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    expect(detectFileType(Buffer.from('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WEBP'))?.mime).toBe('image/webp');
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\x00'))).toBeNull();
  });

  it('sanitiza nomes de arquivo', () => {
    const name = sanitizeFileName('../../etc/"passwd"\r\n.pdf');
    expect(name).not.toMatch(/[/\\"\r\n]/u);
    expect(sanitizeFileName('')).toBe('arquivo');
  });
});
