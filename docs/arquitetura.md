# Arquitetura

## Decisão principal: frontend e backend separados

| Parte | Tecnologia | Responsabilidade |
|---|---|---|
| `frontend/` | Next.js 16, React 19, Tailwind 4, TanStack Query | Somente interface. Não acessa o banco nem contém regra de negócio. |
| `backend/` | Node.js, Fastify 5, Zod 4, Prisma 7, PostgreSQL | Toda regra de negócio, autorização, validação, transações e auditoria. |

**Por quê:** a API independente atende a interface web e, no futuro, leitores/coletores, apps móveis e integrações com ERP/WMS, sem duplicar regras. A separação física também impede que código de interface acesse dados diretamente.

O navegador fala com **uma única origem**: o Next.js repassa `/api/*` ao backend (`rewrites` em `next.config.ts`). Assim o cookie de sessão é `SameSite=Strict`, não há CORS aberto e nenhum token fica acessível ao JavaScript.

```
Navegador ──HTTPS──▶ Next.js (frontend)
                       ├── proxy.ts: CSP com nonce, redireciona ao login sem cookie (conveniência)
                       └── /api/* ──rewrite──▶ Fastify (backend, 127.0.0.1:3333)
                                                 │
                                                 ▼
                                             PostgreSQL (papel stockguard_app)
```

## Camadas do backend

```
routes/        declaração da rota: método, schema Zod, permissões exigidas
controllers/   adaptação HTTP → serviço (sem regra de negócio)
services/      regras de negócio, transações, auditoria, alertas
repositories/  consultas reutilizáveis e filtros de visibilidade (escopo do usuário)
middlewares/   autenticação/autorização, verificação de Origin, tratamento de erros
validators/    schemas Zod (entrada) compartilhados entre rotas e testes
auth/          senhas (Argon2id), TOTP, criptografia de segredos, catálogo de permissões
lib/           Prisma, transações com retry, logger, erros
jobs/          varredura periódica de operações pendentes (lock consultivo no banco)
```

### Ciclo de uma requisição

1. **Rate limit** por IP (`@fastify/rate-limit`; login com limite próprio).
2. **Verificação de Origin** em métodos que alteram dados (CSRF).
3. **Autenticação**: resolve a sessão pelo hash do token do cookie; checa expiração, inatividade e usuário ativo.
4. **Etapas pendentes**: MFA e troca de senha bloqueiam o restante do sistema.
5. **Autorização**: toda rota não pública declara `config.permissions`; a API **não inicia** se alguma rota esquecer.
6. **Validação** do corpo, parâmetros, query e cabeçalhos com Zod.
7. **Serviço**: regras de negócio + filtros de visibilidade (evita IDOR) + transação.
8. **Erros** padronizados `{ error: { code, message, details?, requestId } }`, sem stack trace.

## Estoque: consistência sob concorrência

- O saldo (`stock_balances`) só muda pela função `sg_apply_stock_delta` no banco, que grava o **ledger** na mesma operação e valida estado da movimentação, quantidade e endereço.
- Saídas usam atualização condicional atômica (`quantity + delta >= 0`): duas confirmações simultâneas nunca deixam o saldo negativo.
- A movimentação é travada (`SELECT … FOR UPDATE`) antes de ser confirmada; lançamentos são aplicados em ordem determinística para reduzir deadlocks, e deadlocks/serialização são repetidos automaticamente (`runTransaction`).
- **Idempotência**: toda criação de movimentação exige `Idempotency-Key`. Mesma chave + mesmo conteúdo devolve a movimentação existente; mesma chave + conteúdo diferente é recusada.
- **Inventário** congela os endereços do escopo: nenhuma movimentação nova é aceita neles até aprovação ou cancelamento.

## Fluxos de estado

```
Movimentação:  PENDING_CHECK ──conferência──▶ CONFIRMED
               PENDING_APPROVAL (ajuste) ──aprovação por outra pessoa──▶ CONFIRMED | REJECTED
               pendente ──cancelamento com justificativa──▶ CANCELLED

Divergência:   OPEN ─▶ IN_ANALYSIS ─▶ CORRECTED | CONFIRMED | DISCARDED   (finalizadas são imutáveis)

Inventário:    OPEN ─▶ SUBMITTED (gera divergências) ─▶ APPROVED (ajusta estoque) | CANCELLED
```

## Frontend

```
app/            rotas (App Router); grupo (app) exige sessão via AppShell
components/     UI reutilizável (ui/), layout, gráficos, filtros
hooks/          sessão/permissões, debounce
lib/            cliente HTTP, formatação, rótulos pt-BR
services/       chamadas tipadas à API por módulo
types/          contratos das respostas da API
proxy.ts        CSP com nonce por requisição
```

O frontend usa as permissões apenas para **mostrar ou esconder** elementos. Toda decisão de acesso é repetida no backend.

## Decisões registradas

| Decisão | Motivo |
|---|---|
| Sessão opaca no banco em vez de JWT | Logout, bloqueio e troca de senha têm efeito imediato |
| Argon2id (`@node-rs/argon2`) | Recomendação OWASP; binário pré-compilado para Windows |
| TOTP implementado sobre `node:crypto` | Evita dependência de terceiros; validado com vetores da RFC 6238 |
| Auditoria com HMAC encadeado | Detecta alteração ou remoção de registros; a chave fica fora do banco |
| Dois papéis no PostgreSQL | Migrações com o dono do schema; a API roda sem DDL e sem escrita direta em saldo/ledger/auditoria |
| Contagem cega na conferência | Reduz o viés de confirmar o número esperado |
| Métricas por processo, não ranking | Objetivo é treinamento e melhoria, não punição |
| Rate limit em memória | Suficiente para uma instância; para várias, usar Redis (ver `seguranca.md`) |
