import type {
  DiscrepancyOrigin,
  DiscrepancyStatus,
  DiscrepancyType,
  MovementStatus,
  MovementType,
  ProbableCause,
} from '../generated/prisma/enums.js';

/** Rótulos pt-BR usados em mensagens e relatórios exportados. */
export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  PICKING: 'Separação',
  TRANSFER: 'Transferência',
  ADJUSTMENT: 'Ajuste',
  INVENTORY: 'Inventário',
};

export const MOVEMENT_STATUS_LABEL: Record<MovementStatus, string> = {
  PENDING_CHECK: 'Aguardando conferência',
  PENDING_APPROVAL: 'Aguardando aprovação',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rejeitada',
};

export const DISCREPANCY_TYPE_LABEL: Record<DiscrepancyType, string> = {
  WRONG_PRODUCT: 'Produto incorreto',
  QUANTITY_MISMATCH: 'Quantidade incorreta',
  WRONG_LOCATION: 'Endereço incorreto',
  PRODUCT_NOT_FOUND: 'Produto não encontrado',
  NEGATIVE_STOCK: 'Estoque negativo',
  DUPLICATE_PRODUCT: 'Produto duplicado',
  WRONG_LOT: 'Lote incorreto',
  WRONG_UNIT: 'Unidade de medida incorreta',
};

export const DISCREPANCY_STATUS_LABEL: Record<DiscrepancyStatus, string> = {
  OPEN: 'Aberta',
  IN_ANALYSIS: 'Em análise',
  CORRECTED: 'Corrigida',
  CONFIRMED: 'Confirmada',
  DISCARDED: 'Descartada',
};

export const DISCREPANCY_ORIGIN_LABEL: Record<DiscrepancyOrigin, string> = {
  CHECK: 'Conferência',
  INVENTORY: 'Inventário',
  MANUAL: 'Registro manual',
};

export const PROBABLE_CAUSE_LABEL: Record<ProbableCause, string> = {
  NOT_DETERMINED: 'Não determinada',
  PROCESS: 'Processo',
  TRAINING: 'Treinamento',
  LABELING: 'Etiquetagem',
  SYSTEM_DATA: 'Dados do sistema',
  SUPPLIER: 'Fornecedor',
  PHYSICAL_LAYOUT: 'Layout físico',
  DAMAGE: 'Avaria',
  LOSS: 'Perda/extravio',
  OTHER: 'Outra',
};
