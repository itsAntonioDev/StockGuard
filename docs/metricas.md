# Métricas e fórmulas

Implementação: `backend/src/services/dashboard.service.ts`, `productivity.service.ts` e `analytics-period.ts`. Todas as consultas são parametrizadas. Agrupamentos por dia/semana/mês usam o fuso `APP_TIMEZONE`.

## Princípios

1. **Nenhuma métrica é inventada.** Sem base de cálculo, o valor é "—" (nulo), nunca 0%.
2. **Numerador e denominador aparecem junto com a taxa.**
3. **Comparação de taxas em pontos percentuais**, não em variação relativa (1% → 2% é +1 p.p., não "+100%").
4. **Sem ranking de pessoas.** Indicadores são agregados por tipo de operação e setor; a visão individual existe para apoio e treinamento, com contexto.
5. **Amostra mínima** (`productivity.minSampleSize`, padrão 20): abaixo dela não há sugestões nem conclusões.

## Dashboard

| Indicador | Fórmula |
|---|---|
| Total de movimentações | Movimentações com status `CONFIRMED` e `confirmedAt` no período |
| Operações conferidas | Movimentações com `checkStartedAt` no período (houve ao menos uma leitura de conferência) |
| **Taxa de divergência** | Operações conferidas no período com ≥ 1 divergência **não descartada** vinculada ÷ operações conferidas no período × 100 |
| Divergências encontradas | Divergências criadas no período, exceto descartadas (descartadas são exibidas à parte) |
| Valor estimado | Σ `|esperado − encontrado| × custo unitário de referência` das divergências não descartadas. Divergências sem custo cadastrado **não entram** e são contadas à parte. |
| Tempo médio de resolução | Média de `resolvedAt − createdAt` das divergências `CORRECTED` ou `CONFIRMED` resolvidas no período |
| Operações pendentes | Movimentações `PENDING_CHECK` + `PENDING_APPROVAL` no momento da consulta |
| Comparação | Mesmo cálculo no período imediatamente anterior, de mesma duração |

**Por que o denominador são operações conferidas:** operações sem conferência não têm como revelar divergência. Incluí-las diluiria a taxa e daria uma falsa sensação de controle.

## Produtividade

| Indicador | Definição |
|---|---|
| Tempo médio por operação | Média de `checkedAt − checkStartedAt` (minutos), por tipo de operação |
| Contexto de complexidade | Itens médios e quantidade média por operação (sempre exibidos junto do tempo) |
| Minutos por item | Média de `minutos ÷ itens` |
| Operações por hora ativa | Operações conferidas ÷ horas distintas com atividade registrada. **Não** representa a jornada de trabalho. |
| Conferência correta na 1ª tentativa | Operações conferidas sem nenhuma leitura `MISMATCH` ÷ operações conferidas × 100 |
| Retrabalho | Leituras `MISMATCH` ÷ operações conferidas |
| Leituras corretas por setor | Leituras `MATCH` ÷ leituras totais no setor do endereço conferido |
| Recontagens de inventário | Itens com recontagem ÷ itens contados |
| Tempo de resolução por setor | Média de resolução das divergências cujo endereço pertence ao setor |

Contexto da visão individual: dias desde `trainingStartedAt`, perfil, setor e operações por classe de manuseio (padrão, frágil, pesado, perecível, controlado).

## Sugestões de treinamento

Calculadas sobre a distribuição dos códigos de erro das leituras incorretas, respeitando a amostra mínima:

| Padrão | Limite | Sugestão (resumo) |
|---|---|---|
| Endereço/destino incorreto | ≥ 30% dos erros | Revisar sinalização física e procedimento de leitura de endereço |
| Produto incorreto/não cadastrado | ≥ 30% | Revisar etiquetas e códigos de barras; treinar identificação de itens semelhantes |
| Quantidade divergente | ≥ 30% | Revisar método de contagem e unidade de medida |
| Lote incorreto/ausente | ≥ 20% | Treinar controle de lote e validade (FEFO) |
| Fração em unidade inteira | ≥ 10% | Revisar unidade de medida no cadastro |

As sugestões falam de processo, sinalização, cadastro e treinamento — nunca de punição.
