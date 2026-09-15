import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, hotp, totpStep, verifyTotp } from '../../src/auth/totp.js';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP (RFC 4226)', () => {
  it.each([
    [0, '755224'], [1, '287082'], [2, '359152'], [3, '969429'], [4, '338314'],
    [5, '254676'], [6, '287922'], [7, '162583'], [8, '399871'], [9, '520489'],
  ])('contador %i gera %s', (counter, expected) => {
    expect(hotp(RFC_SECRET, counter)).toBe(expected);
  });
});

describe('TOTP (RFC 6238, SHA-1, 8 dígitos)', () => {
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])('tempo %i gera %s', (seconds, expected) => {
    expect(hotp(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(expected);
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);
  const codeAt = (step: number) => hotp(base32Decode(secret), step);

  it('aceita o código do passo atual e devolve o passo', () => {
    const step = totpStep(now);
    expect(verifyTotp(secret, codeAt(step), { nowMs: now })).toBe(step);
  });

  it('tolera um passo de diferença de relógio, mas não dois', () => {
    const step = totpStep(now);
    expect(verifyTotp(secret, codeAt(step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(step - 2), { nowMs: now })).toBeNull();
  });

  it('recusa reutilização de um código já usado', () => {
    const step = totpStep(now);
    expect(verifyTotp(secret, codeAt(step), { nowMs: now, lastUsedStep: step })).toBeNull();
  });

  it('recusa formatos inválidos', () => {
    expect(verifyTotp(secret, '12345', { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { nowMs: now })).toBeNull();
  });

  it('base32 faz ida e volta sem perda e a semente tem 160 bits', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode(secret)).toHaveLength(20);
  });
});
