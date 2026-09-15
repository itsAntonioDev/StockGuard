/**
 * Cliente HTTP da API. Tudo passa por /api/v1 (mesma origem, repassado ao backend).
 * O cookie de sessão é HttpOnly: o JavaScript nunca lê nem guarda tokens.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function buildQuery(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: QueryParams;
  idempotencyKey?: string;
  formData?: FormData;
}

async function toApiError(response: Response): Promise<ApiError> {
  const payload = (await response.json().catch(() => null)) as { error?: ApiErrorBody } | null;
  const error = payload?.error;
  return new ApiError(
    response.status,
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? 'Não foi possível concluir a operação. Tente novamente.',
    error?.details,
    error?.requestId,
  );
}

function notify(error: ApiError) {
  if (typeof window === 'undefined') return;
  if (error.status === 401) window.dispatchEvent(new CustomEvent('sg:unauthorized'));
  if (error.status === 403 && error.code === 'AUTH_STEP_REQUIRED') window.dispatchEvent(new CustomEvent('sg:auth-step'));
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const response = await fetch(`/api/v1${path}${buildQuery(options.query)}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await toApiError(response);
    notify(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Baixa um arquivo gerado pela API (CSV, evidência) sem expô-lo em URL pública. */
export async function downloadFile(path: string, query: QueryParams, fallbackName: string): Promise<void> {
  const response = await fetch(`/api/v1${path}${buildQuery(query)}`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    const error = await toApiError(response);
    notify(error);
    throw error;
  }
  const blob = await response.blob();
  const match = /filename="([^"]+)"/u.exec(response.headers.get('content-disposition') ?? '');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ?? fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Chave de idempotência: a mesma operação reenviada (duplo clique, rede instável) não duplica. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replaceAll('-', '');
}
