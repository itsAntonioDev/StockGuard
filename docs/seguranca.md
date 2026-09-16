# Segurança

Nenhum sistema é invulnerável. Este documento descreve os controles implementados, como verificá-los e as limitações conhecidas.

## Controles por categoria (OWASP Top 10 / API Security Top 10)

| Risco | Controles no StockGuard |
|---|---|
| Broken Access Control / BOLA (IDOR) | RBAC verificado no backend em toda rota (a API não inicia se uma rota não declarar permissões); filtros de visibilidade aplicados também nas buscas por ID (resposta 404 idêntica para "não existe" e "não é seu"); gestores só administram Operador/Conferente; ninguém altera o próprio perfil; último administrador protegido |
| Broken Function Level Authorization | Permissão específica por tipo de operação verificada no serviço; aprovação de ajuste e de inventário por pessoa diferente do solicitante; dupla checagem na conferência |
| Cryptographic Failures | Argon2id (m=19 MiB, t=2); semente TOTP cifrada com AES-256-GCM; token de sessão de 256 bits guardado apenas como SHA-256; cookie `Secure` obrigatório em produção; HSTS em produção |
| Injection | Prisma e `$queryRaw` com template (parametrizado); ESLint proíbe `$queryRawUnsafe`/`$executeRawUnsafe`; validação Zod de tipos, formatos e limites; CSV com neutralização de fórmulas |
| Insecure Design | Saldo só muda via função com ledger; idempotência; transações com trava; contagem cega; congelamento de endereços em inventário; segregação de funções |
| Security Misconfiguration | Configuração validada na inicialização (falha cedo); cabeçalhos com Helmet (CSP `default-src 'none'` na API, `frame-ancestors 'none'`, `nosniff`); CORS restrito à origem do frontend; API ouvindo em 127.0.0.1; sem stack trace nas respostas |
| Vulnerable Components | `npm audit` sem vulnerabilidades conhecidas nos dois projetos; `overrides` para dependências transitivas do CLI do Prisma |
| Identification & Authentication Failures | Mensagem genérica de login e tempo equalizado para contas inexistentes; bloqueio progressivo (1→60 min a partir da 5ª falha); rate limit por IP; MFA obrigatório para administradores com proteção contra reutilização de código; rotação de sessão após MFA e troca de senha; expiração absoluta (12 h) e por inatividade (30 min); logout invalida no servidor; troca de senha encerra outras sessões |
| Software & Data Integrity Failures | Auditoria e históricos somente-inserção (privilégio + trigger); movimentações finalizadas imutáveis; cadeia HMAC verificável |
| Logging & Monitoring Failures | Auditoria de login (sucesso/falha), negações de acesso, origem recusada, mudanças de permissão, usuários, cadastros, movimentações, ajustes, inventário, divergências, exportações e configurações; logs estruturados com `requestId` e remoção de senhas/tokens |
| SSRF | A API não faz requisições a URLs fornecidas pelo usuário |
| Unrestricted Resource Consumption | Rate limit global e de login; limite de corpo (1 MB) e de upload (5 MB, 1 arquivo); paginação máxima; período máximo de 366 dias; limite de 50 mil linhas por exportação; `statement_timeout` no banco |

## Sessões e CSRF

- Cookie `sg_session` (produção: `__Host-sg_session`) com `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` em produção.
- Métodos que alteram dados exigem `Origin` igual a `FRONTEND_ORIGIN` (ou `Sec-Fetch-Site: same-origin`); recusas são auditadas.
- Nenhum token é armazenado em `localStorage` ou exposto em URL.
- "Lembrar este dispositivo" (`sg_trusted`, produção `__Host-sg_trusted`, validade `MFA_REMEMBER_DAYS`): comprovante assinado com HMAC que dispensa **apenas** o código MFA — a senha é exigida em todo login. A assinatura inclui uma impressão digital da conta (`passwordChangedAt` + semente MFA cifrada), então trocar/redefinir a senha ou redefinir o MFA invalida imediatamente todos os dispositivos lembrados. O cookie não guarda segredo nem concede sessão, e `DELETE /auth/trusted-device` o remove.

## Frontend

- CSP por requisição com **nonce** para scripts (`proxy.ts`), `frame-ancestors 'none'`, `object-src 'none'`.
- `style-src 'unsafe-inline'` é permitido por causa dos gráficos (atributos `style`); scripts inline continuam bloqueados.
- Nenhum uso de `dangerouslySetInnerHTML`; mensagens multilinha são exibidas como texto.
- QR code do MFA gerado localmente (a semente não sai do navegador para terceiros).
- Leitura de código de barras pela câmera processada no próprio navegador (biblioteca empacotada com o app); nenhuma imagem é enviada a servidores e a câmera é liberada ao fechar a janela. `Permissions-Policy` libera a câmera apenas para a própria origem.

## Uploads (evidências)

- Tipo validado pelos **bytes iniciais** (JPG, PNG, WEBP, PDF), não pela extensão.
- Nome aleatório no disco, fora de pasta pública; download sempre como `attachment` com `nosniff`.
- Máximo de 5 MB por arquivo e 10 evidências por divergência; divergência finalizada não aceita anexos.

## Banco de dados

Ver [modelo-dados.md](modelo-dados.md): papéis separados, função única para saldo, triggers de imutabilidade e privilégios mínimos.

## Checklist de implantação em produção

- [ ] HTTPS obrigatório no proxy reverso (TLS 1.2+); `COOKIE_SECURE=true`; `FRONTEND_ORIGIN` com `https://`
- [ ] API (`HOST=127.0.0.1`) e PostgreSQL **não expostos** à internet; firewall liberando apenas o necessário
- [ ] PostgreSQL com `listen_addresses` restrito (nesta máquina de desenvolvimento ele está em `*` — ajustar)
- [ ] `TRUST_PROXY` configurado apenas com o IP do proxy confiável
- [ ] Segredos (`MFA_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`, senhas do banco) em cofre/variáveis de ambiente, diferentes de desenvolvimento
- [ ] Papel `stockguard_migrator` **sem** `CREATEDB` em produção
- [ ] `SEED_ADMIN_PASSWORD` removido após o primeiro acesso
- [ ] Containers (se usados) com usuário não-root, imagem mínima e sistema de arquivos somente leitura exceto `storage/`
- [ ] Backups cifrados diários e **teste de restauração** periódico
- [ ] Monitoramento de erros e alertas sobre `authz.denied`, `security.origin_rejected` e falhas de login em massa
- [ ] Rodar `GET /api/v1/audit-logs/verify` periodicamente

## Testes de segurança

Automatizados (`backend/tests`):

- controle de acesso por perfil, escalonamento de privilégio e manipulação de IDs;
- login genérico, bloqueio, sessão expirada/ociosa/revogada, MFA obrigatório e reutilização de código;
- CSRF (origem não autorizada), rate limit de login, erros sem detalhes internos;
- quantidades inválidas, estoque insuficiente, concorrência e rollback;
- proibição de escrita direta em saldo/ledger/auditoria pelo papel da API e imutabilidade mesmo para o dono das tabelas;
- upload disfarçado, neutralização de fórmulas em CSV, integridade da cadeia de auditoria.

Manuais/ferramentas (somente em desenvolvimento ou homologação, **nunca em produção**):

```bash
# Análise dinâmica (DAST) básica com OWASP ZAP contra o frontend em homologação
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://homologacao.exemplo -r zap.html

# Análise estática (SAST)
npx semgrep --config p/owasp-top-ten backend/src frontend

# Dependências (SCA)
npm audit --prefix backend && npm audit --prefix frontend
```

## Limitações conhecidas

| Limitação | Impacto | Mitigação planejada |
|---|---|---|
| Rate limit em memória | Com várias instâncias, cada uma conta separadamente | Store Redis no `@fastify/rate-limit` |
| Evidências em disco local | Não compartilhadas entre instâncias; backup separado | Armazenamento de objetos (S3/Azure Blob) mantendo a interface de `evidence-storage.ts` |
| Sem códigos de recuperação de MFA | Administrador que perde o autenticador depende de outro administrador | Códigos de recuperação de uso único; WebAuthn/passkeys |
| Rotação de `AUDIT_HMAC_KEY` não automatizada | Troca exige estratégia de verificação por época | Guardar identificador da chave por registro |
| Sem API keys para integrações | Integrações máquina-a-máquina ainda não suportadas | Contas de serviço com escopo mínimo (ver `integracoes.md`) |
| `style-src 'unsafe-inline'` no frontend | Injeção de CSS teria mais margem | Gráficos sem estilos inline ou hashes de estilo |
