# Modelo de dados

Fonte: `backend/prisma/schema.prisma` e migrações em `backend/prisma/migrations`.

## Entidades

| Grupo | Tabelas | Observações |
|---|---|---|
| Identidade | `users`, `roles`, `permissions`, `role_permissions`, `sessions` | Senha em Argon2id; semente MFA cifrada (AES-256-GCM); sessão guarda apenas o SHA-256 do token |
| Configuração | `system_settings` | Valores validados por schema Zod por chave |
| Auditoria | `audit_logs` | Somente inserção; `hash = HMAC(prevHash + conteúdo)` |
| Cadastros | `categories`, `products`, `lots`, `warehouses`, `sectors`, `locations` | Código de endereço gerado pelo servidor: `SETOR-CORREDOR-PRATELEIRA-POSIÇÃO` |
| Estoque | `stock_balances`, `stock_movements`, `stock_movement_items`, `stock_ledger_entries` | Saldo é cache; o ledger é a fonte da verdade |
| Conferência | `check_attempts` | Toda leitura, inclusive as incorretas |
| Inventário | `inventory_counts`, `inventory_count_items` | Foto do saldo na abertura, contagem e recontagem separadas |
| Divergências | `discrepancies`, `discrepancy_actions`, `discrepancy_evidences` | Histórico e evidências somente inserção |
| Alertas | `alerts` | `openDedupeKey` único garante um alerta aberto por situação |

Chaves primárias são UUID (não previsíveis). Números sequenciais (`number`) existem apenas para exibição (MOV-0001, DIV-0001, INV-0001). Registros críticos nunca são excluídos fisicamente: usuários são desativados, movimentações canceladas, divergências descartadas.

## Integridade garantida pelo banco

A migração `20260914190100_security_integrity` adiciona proteções que valem mesmo se a API tiver um bug ou for comprometida:

| Proteção | Implementação |
|---|---|
| Saldo nunca negativo | `CHECK (quantity >= 0)` e atualização condicional na função |
| Saldo só muda com ledger | Função `sg_apply_stock_delta` (`SECURITY DEFINER`); o papel da API tem apenas `SELECT` em saldo e ledger |
| Mesmo item não aplicado duas vezes | Índice único `(movementItemId, sign(delta))` no ledger |
| Lançamento coerente com a operação | A função confere estado pendente, quantidade confirmada e endereço de origem/destino |
| Históricos imutáveis | Triggers bloqueiam `UPDATE`/`DELETE` em auditoria, ledger, tentativas, ações e evidências |
| Movimentação finalizada imutável | Trigger bloqueia alteração de movimentações/itens confirmados, cancelados ou rejeitados e qualquer exclusão |
| Divergência finalizada imutável | Trigger bloqueia alteração após corrigida/confirmada/descartada |
| Unicidade com lote nulo | Índices `NULLS NOT DISTINCT` em saldos e itens de inventário |
| Domínio | `CHECK` de quantidades, custos, capacidade, direção do ajuste, e-mail em minúsculas |
| Privilégios | API sem `DELETE` (exceto vínculos perfil↔permissão), sem acesso a `_prisma_migrations`, `statement_timeout` de 30 s |

## Papéis do PostgreSQL

| Papel | Uso | Privilégios |
|---|---|---|
| `stockguard_migrator` | `prisma migrate deploy` | Dono do schema. `CREATEDB` apenas em desenvolvimento (shadow database). |
| `stockguard_app` | API em execução | `SELECT/INSERT/UPDATE` nas tabelas, com as restrições acima |

## Cuidados com migrações futuras

O Prisma não conhece `CHECK`, triggers, funções e índices `NULLS NOT DISTINCT`. Ao gerar novas migrações (`prisma migrate dev --create-only`), **revise o SQL** para garantir que esses objetos não sejam removidos, e aplique `GRANT`/`REVOKE` para tabelas novas conforme a política acima.

## Backups

- Faça `pg_dump` diário do banco de produção com o papel dono, armazenado cifrado e fora do servidor do banco.
- **Teste a restauração** periodicamente em ambiente separado e rode `GET /api/v1/audit-logs/verify` no banco restaurado.
- A chave `AUDIT_HMAC_KEY` deve ser guardada junto ao plano de recuperação (sem ela não é possível verificar a cadeia).
