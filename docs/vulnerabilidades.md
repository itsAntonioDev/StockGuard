# Gestão de vulnerabilidades

## Processo

1. **Identificar** — fontes: `npm audit` (a cada build e semanalmente), alertas do GitHub/Dependabot, SAST (Semgrep), DAST (OWASP ZAP em homologação), revisão de código, relatos internos e testes de intrusão autorizados.
2. **Classificar** — severidade pelo CVSS v3.1, ajustada ao contexto (exposição, dados envolvidos, possibilidade de alterar estoque ou auditoria).
3. **Priorizar** — prazos máximos abaixo.
4. **Corrigir** — em branch própria, com o menor escopo possível.
5. **Testar** — escrever um teste de regressão que falhe antes e passe depois; rodar a suíte completa.
6. **Registrar** — preencher a tabela de registro (sem detalhes exploráveis enquanto não houver correção implantada).
7. **Monitorar** — acompanhar novas versões e avisos das dependências afetadas.

## Prazos por severidade

| Severidade | Exemplos no contexto do StockGuard | Prazo para correção em produção |
|---|---|---|
| Crítica | Execução remota de código; bypass de autenticação; alteração de saldo ou auditoria sem registro | 24 horas (mitigação imediata) |
| Alta | Escalonamento de privilégio; IDOR com leitura de dados de outros usuários; injeção | 7 dias |
| Média | Divulgação de informação limitada; ausência de rate limit em rota sensível | 30 dias |
| Baixa | Cabeçalho de segurança ausente sem impacto direto | Próximo ciclo |

## Regras

- Não executar testes destrutivos em produção.
- Não registrar dados sensíveis (senhas, tokens, dados pessoais) em tickets.
- Vulnerabilidades em dependências só de desenvolvimento também são corrigidas (ex.: `overrides` do CLI do Prisma).

## Registro

| Data | Identificação | Componente | Severidade | Situação | Correção / teste de regressão |
|---|---|---|---|---|---|
| 2026-09-14 | GHSA-ggr8-5vv4-36mx (deepmerge-ts) | CLI Prisma (dev) | Alta | Corrigida | `overrides` para deepmerge-ts ≥ 8.0.2; `npm audit` sem ocorrências |
| 2026-09-14 | GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3 (mysql2) | CLI Prisma (dev) | Alta | Corrigida | `overrides` para mysql2 ≥ 3.24.4; `npm audit` sem ocorrências |
| 2026-09-15 | Rate limit de login compartilhado atrás do proxy do frontend | Backend | Média | Corrigida | `TRUST_PROXY` aceita lista de IPs confiáveis (127.0.0.1) |
