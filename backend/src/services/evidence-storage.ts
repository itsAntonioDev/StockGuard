import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../config/env.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

/**
 * Armazenamento de evidências em disco local, FORA de qualquer pasta pública.
 * - Tipo validado pelos bytes iniciais (assinatura), nunca pela extensão ou Content-Type enviados.
 * - Nome aleatório no disco; o nome original fica só no banco (para exibição).
 * Para produção com várias instâncias, troque por um armazenamento de objetos
 * (S3/Azure Blob) mantendo esta mesma interface — veja docs/integracoes.md.
 */
export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

interface FileType {
  mime: string;
  ext: string;
}

const STORAGE_KEY_PATTERN = /^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/u;

export function detectFileType(buffer: Buffer): FileType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  return null;
}

function storageRoot(): string {
  return path.resolve(getEnv().EVIDENCE_STORAGE_DIR);
}

export interface StoredFile {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export async function storeEvidenceFile(buffer: Buffer): Promise<StoredFile> {
  if (buffer.length === 0) throw new ValidationError('Arquivo vazio.');
  if (buffer.length > MAX_EVIDENCE_BYTES) throw new ValidationError('Arquivo maior que o limite de 5 MB.');
  const type = detectFileType(buffer);
  if (!type) throw new ValidationError('Tipo de arquivo não permitido. Envie JPG, PNG, WEBP ou PDF.');

  const storageKey = `${randomBytes(16).toString('hex')}.${type.ext}`;
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  // 'wx' falha se o arquivo existir — nunca sobrescreve evidências.
  await writeFile(path.join(root, storageKey), buffer, { flag: 'wx', mode: 0o600 });

  return {
    storageKey,
    mimeType: type.mime,
    sizeBytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function readEvidenceFile(storageKey: string): Promise<Buffer> {
  // A chave vem do banco, mas validamos o formato para impedir path traversal.
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new NotFoundError('Arquivo não encontrado.');
  try {
    return await readFile(path.join(storageRoot(), storageKey));
  } catch {
    throw new NotFoundError('Arquivo não encontrado.');
  }
}

/** Nome seguro para Content-Disposition (sem caminhos, aspas ou quebras de linha). */
export function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/gu, '_').trim();
  return (base || 'arquivo').slice(0, 200);
}
