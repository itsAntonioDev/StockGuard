/**
 * Erros de aplicação com código estável (para o frontend) e mensagem segura
 * (para o usuário). Nada aqui deve carregar detalhes internos do servidor.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos.', details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Autenticação necessária.', code = 'UNAUTHENTICATED') {
    super(401, code, message);
  }
}

export type AuthStep = 'MFA_SETUP' | 'MFA_VERIFY' | 'CHANGE_PASSWORD';

export class AuthStepRequiredError extends AppError {
  constructor(readonly step: AuthStep) {
    super(403, 'AUTH_STEP_REQUIRED', 'Conclua a etapa de segurança pendente para continuar.', { step });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Você não tem permissão para esta operação.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Registro não encontrado.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: unknown) {
    super(409, code, message, details);
  }
}

/** Regra de negócio violada (ex.: estoque insuficiente, endereço bloqueado). */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas tentativas. Aguarde e tente novamente.') {
    super(429, 'TOO_MANY_REQUESTS', message);
  }
}
