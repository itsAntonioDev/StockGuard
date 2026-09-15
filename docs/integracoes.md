# Integrações futuras

Nenhuma integração externa está implementada. Esta página descreve os pontos de extensão preparados e o que falta para cada uma — sem conectores fictícios.

| Integração | Situação atual | O que falta |
|---|---|---|
| **Leitores de código de barras (USB/Bluetooth)** | Funciona hoje: leitores em modo teclado digitam o código e enviam Enter nas telas de conferência, movimentação e inventário | — |
| **Leitura pela câmera (tablet/celular)** | `Permissions-Policy` já libera câmera para a própria origem | Componente de leitura (ex.: BarcodeDetector API) alimentando os mesmos campos |
| **QR Code em etiquetas de endereço** | Endereços têm código estável gerado pelo servidor | Geração/impressão de etiquetas (PDF) a partir de `/locations` |
| **ERP / WMS** | Contrato OpenAPI gerado (`npm run openapi` no backend); endpoints idempotentes | Autenticação máquina-a-máquina (contas de serviço com chave/credencial própria, escopo mínimo, rotação e auditoria); webhooks ou fila para eventos |
| **Importação de produtos por CSV** | Validação de produto centralizada em `catalog.schemas.ts` | Endpoint de upload com pré-visualização, validação linha a linha reutilizando o schema, limite de tamanho e relatório de erros |
| **Exportação de movimentações** | CSV auditado em `/reports/*` | Agendamento e entrega (e-mail/SFTP) |
| **Relatórios em PDF** | Cada relatório é uma `ReportDefinition` (colunas + consulta) usada pelo CSV | Renderizador PDF que consome as mesmas definições |
| **Notificações** | Alertas deduplicados em `alerts` (severidade, tipo, ocorrências) | Canal de envio (e-mail, Teams/Slack) com preferências por perfil e controle de frequência |
| **Armazenamento de evidências em nuvem** | Interface em `services/evidence-storage.ts` | Implementação S3/Azure Blob com URLs assinadas de curta duração |
| **Inteligência artificial** | Dados estruturados: tentativas de conferência com códigos de erro, divergências com causa provável, ledger | Ver abaixo |

## Inteligência artificial (apoio à decisão)

Usos previstos: identificar padrões de divergência, sugerir causas prováveis, apontar produtos com problemas recorrentes, sugerir treinamentos, prever inconsistências e redigir resumos gerenciais.

Regras obrigatórias para qualquer implementação:

1. **Somente leitura.** A IA nunca cria, confirma, aprova ou ajusta movimentações; qualquer ação sugerida passa pelos fluxos normais com autorização humana e auditoria.
2. **Sugestão, não veredito.** Causa provável sugerida por IA deve ser marcada como sugestão e confirmada por quem analisa; nunca atribuir culpa a pessoas.
3. **Minimização de dados.** Enviar agregados ou dados pseudonimizados; nada de senhas, tokens, e-mails ou dados pessoais desnecessários.
4. **Rastreabilidade.** Registrar na auditoria quando uma sugestão foi exibida e se foi aceita.
5. **Avaliação contínua.** Medir a taxa de acerto das sugestões antes de ampliar o uso.
