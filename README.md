# StockGuard

Sistema web para **reduzir divergências de estoque**: valida as operações antes de confirmá-las, registra tudo de forma rastreável e transforma erros em informação para melhorar processos e treinamentos — sem ranking punitivo de pessoas.

## Estrutura

```
ProjetoKahalD/
├── backend/    API Node.js (Fastify + Prisma + PostgreSQL) — regras de negócio, segurança e auditoria
├── frontend/   Interface Next.js (React + Tailwind) — somente telas; fala com a API via /api
└── docs/       Arquitetura, modelo de dados, métricas, segurança, integrações e vulnerabilidades
```

## Funcionalidades

| Módulo | O que faz |
|---|---|
| Autenticação | Login com Argon2id, sessões no servidor (cookie HttpOnly), bloqueio progressivo, rate limit, MFA (TOTP) obrigatório para administradores, troca de senha obrigatória no primeiro acesso |
| Perfis e permissões | Administrador, Gestor, Operador e Conferente; permissões configuráveis e verificadas no backend em toda rota |
| Produtos e endereços | Cadastro com lote/validade, unidade, estoque mínimo, custo de referência; armazéns, setores e endereços (inclusive geração em lote) |
| Movimentações | Entrada, saída, separação, transferência e ajuste (com aprovação por outra pessoa); idempotência contra duplicidade |
| Conferência | Fluxo Produto → Quantidade (contagem cega) → Endereço → Confirmação, com mensagens claras de erro e dupla checagem |
| Inventário | Abertura com congelamento dos endereços, contagem cega, recontagem, divergências automáticas e aprovação segregada |
| Divergências | Registro, análise (causa provável definida por quem analisa), ação corretiva, histórico imutável e evidências |
| Alertas | Estoque mínimo, tentativa acima do saldo, produto em endereço incorreto, recorrência, operações pendentes, tentativas inválidas repetidas |
| Dashboard, produtividade e relatórios | Indicadores com fórmulas documentadas, visão por processo/setor, sugestões de treinamento, exportação CSV auditada |
| Auditoria | Registro somente-inserção com hash encadeado (HMAC) e verificação de integridade |

## Requisitos

- Node.js 22.12 ou superior
- PostgreSQL 15 ou superior (desenvolvido e testado no 18)
- Windows PowerShell para o script de configuração do banco (ou execute o SQL de `backend/scripts` manualmente)

## Como executar (desenvolvimento)

```powershell
# 1. Backend: dependências
cd backend
npm install

# 2. Banco: cria papéis com privilégio mínimo, bancos dev/test e gera .env e .env.test
#    (pede a senha do superusuário do PostgreSQL apenas no seu terminal)
powershell -ExecutionPolicy Bypass -File scripts\setup-database.ps1

# 3. Migrações e dados iniciais (perfis, permissões e administrador)
npm run db:deploy
npm run db:seed              # adicione "-- --demo" para um catálogo de DEMONSTRAÇÃO sem saldo

# 4. API em http://127.0.0.1:3333
npm run dev

# 5. Em outro terminal: frontend em http://localhost:3000
cd ..\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

No primeiro acesso, entre com o e-mail informado no script e a **senha temporária** exibida por ele. O sistema exigirá a configuração do MFA e a troca da senha. Depois, remova `SEED_ADMIN_PASSWORD` do `backend/.env`.

## Verificações

| Comando (em `backend/`) | O que valida |
|---|---|
| `npm run typecheck` | Tipos do backend e dos testes |
| `npm run lint` | ESLint com regras de segurança (inclui proibição de SQL não parametrizado) |
| `npm run test:unit` | Regras puras: TOTP (vetores RFC), senhas, CSV injection, comparação da conferência, transições de divergência, métricas |
| `npm run test:integration` | API + PostgreSQL real (`stockguard_test`): autenticação, autorização/IDOR, estoque insuficiente, concorrência, rollback, idempotência, auditoria, inventário, divergências, exportação |
| `npm audit` | Dependências vulneráveis |

| Comando (em `frontend/`) | O que valida |
|---|---|
| `npm run typecheck` | Tipos e rotas do Next.js |
| `npm run lint` | ESLint (Next.js + React) |
| `npm run build` | Build de produção |

## Documentação

- [Arquitetura](docs/arquitetura.md)
- [Modelo de dados e integridade](docs/modelo-dados.md)
- [Métricas e fórmulas](docs/metricas.md)
- [Segurança](docs/seguranca.md)
- [Integrações futuras](docs/integracoes.md)
- [Gestão de vulnerabilidades](docs/vulnerabilidades.md)
