import { ApiError } from '@/lib/api';
import { Notice } from './display';

interface Problem {
  message?: string;
  field?: string | null;
}

/** Extrai mensagens úteis dos diferentes formatos de detalhe devolvidos pela API. */
function detailMessages(details: unknown): string[] {
  if (!details) return [];
  if (Array.isArray(details)) {
    return details.map((entry: Problem | string) => (typeof entry === 'string' ? entry : [entry.field, entry.message].filter(Boolean).join(': '))).filter(Boolean);
  }
  if (typeof details === 'object') {
    const record = details as Record<string, unknown>;
    if (Array.isArray(record.problems)) {
      return record.problems.map((entry: Problem | string) => (typeof entry === 'string' ? entry : (entry.message ?? ''))).filter(Boolean);
    }
    if (Array.isArray(record.items)) {
      return (record.items as Array<{ product?: { internalCode: string }; errors?: Array<{ message: string }> }>).flatMap((item) =>
        (item.errors ?? []).map((error) => `${item.product?.internalCode ?? 'Item'}: ${error.message}`),
      );
    }
    if (Array.isArray(record.missingItems)) return [`Itens sem conferência: ${(record.missingItems as string[]).join(', ')}`];
  }
  return [];
}

export function ErrorMessage({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const apiError = error instanceof ApiError ? error : null;
  const message = apiError?.message ?? 'Ocorreu um erro inesperado. Tente novamente.';
  const details = apiError ? detailMessages(apiError.details) : [];

  return (
    <Notice tone="danger" title={title}>
      <p>{message}</p>
      {details.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {details.map((detail, index) => (
            <li key={`${index}-${detail.slice(0, 20)}`}>{detail}</li>
          ))}
        </ul>
      )}
      {apiError?.requestId && apiError.status >= 500 && <p className="mt-2 text-xs opacity-80">Código para o suporte: {apiError.requestId}</p>}
    </Notice>
  );
}
