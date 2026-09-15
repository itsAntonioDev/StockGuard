import type {
  AlertSeverity,
  AlertStatus,
  AlertType,
  DiscrepancyOrigin,
  DiscrepancyStatus,
  DiscrepancyType,
  HandlingClass,
  InventoryStatus,
  LocationStatus,
  MovementStatus,
  MovementType,
  ProbableCause,
  Unit,
} from '@/types/api';

export const MOVEMENT_TYPE: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  PICKING: 'Separação',
  TRANSFER: 'Transferência',
  ADJUSTMENT: 'Ajuste',
  INVENTORY: 'Inventário',
};

export const MOVEMENT_STATUS: Record<MovementStatus, string> = {
  PENDING_CHECK: 'Aguardando conferência',
  PENDING_APPROVAL: 'Aguardando aprovação',
  CONFIRMED: 'Concluída',
  CANCELLED: 'Cancelada',
  REJECTED: 'Rejeitada',
};

export const DISCREPANCY_TYPE: Record<DiscrepancyType, string> = {
  WRONG_PRODUCT: 'Produto incorreto',
  QUANTITY_MISMATCH: 'Quantidade incorreta',
  WRONG_LOCATION: 'Endereço incorreto',
  PRODUCT_NOT_FOUND: 'Produto não encontrado',
  NEGATIVE_STOCK: 'Estoque negativo',
  DUPLICATE_PRODUCT: 'Produto duplicado',
  WRONG_LOT: 'Lote incorreto',
  WRONG_UNIT: 'Unidade de medida incorreta',
};

export const DISCREPANCY_STATUS: Record<DiscrepancyStatus, string> = {
  OPEN: 'Aberta',
  IN_ANALYSIS: 'Em análise',
  CORRECTED: 'Corrigida',
  CONFIRMED: 'Confirmada',
  DISCARDED: 'Descartada',
};

export const DISCREPANCY_ORIGIN: Record<DiscrepancyOrigin, string> = {
  CHECK: 'Conferência',
  INVENTORY: 'Inventário',
  MANUAL: 'Registro manual',
};

export const PROBABLE_CAUSE: Record<ProbableCause, string> = {
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

export const ALERT_TYPE: Record<AlertType, string> = {
  LOW_STOCK: 'Estoque abaixo do mínimo',
  NEGATIVE_STOCK_ATTEMPT: 'Tentativa acima do saldo',
  WRONG_LOCATION: 'Produto em endereço incorreto',
  QUANTITY_MISMATCH: 'Quantidade incompatível',
  RECURRING_DISCREPANCY: 'Divergências recorrentes',
  PENDING_OPERATION: 'Operação pendente',
  REPEATED_INVALID_ATTEMPTS: 'Tentativas inválidas repetidas',
};

export const ALERT_SEVERITY: Record<AlertSeverity, string> = { INFO: 'Informativo', WARNING: 'Atenção', CRITICAL: 'Crítico' };
export const ALERT_STATUS: Record<AlertStatus, string> = { OPEN: 'Aberto', ACKNOWLEDGED: 'Reconhecido', RESOLVED: 'Resolvido' };

export const INVENTORY_STATUS: Record<InventoryStatus, string> = {
  OPEN: 'Em contagem',
  SUBMITTED: 'Em revisão',
  APPROVED: 'Aprovado',
  CANCELLED: 'Cancelado',
};

export const LOCATION_STATUS: Record<LocationStatus, string> = { ACTIVE: 'Ativo', BLOCKED: 'Bloqueado', INACTIVE: 'Inativo' };

export const UNIT: Record<Unit, string> = {
  UN: 'Unidade (UN)',
  CX: 'Caixa (CX)',
  PCT: 'Pacote (PCT)',
  KG: 'Quilograma (KG)',
  G: 'Grama (G)',
  L: 'Litro (L)',
  ML: 'Mililitro (ML)',
  M: 'Metro (M)',
};

export const HANDLING_CLASS: Record<HandlingClass, string> = {
  STANDARD: 'Padrão',
  FRAGILE: 'Frágil',
  HEAVY: 'Pesado',
  PERISHABLE: 'Perecível',
  CONTROLLED: 'Controlado',
};

export const PERMISSION_MODULE: Record<string, string> = {
  products: 'Produtos',
  locations: 'Endereços',
  stock: 'Estoque',
  movements: 'Movimentações',
  checks: 'Conferência',
  inventory: 'Inventário',
  discrepancies: 'Divergências',
  alerts: 'Alertas',
  analytics: 'Indicadores e relatórios',
  admin: 'Administração',
};

export const CHECK_ERROR: Record<string, string> = {
  WRONG_LOCATION: 'Endereço incorreto',
  WRONG_DESTINATION: 'Destino incorreto',
  PRODUCT_NOT_FOUND: 'Código não cadastrado',
  WRONG_PRODUCT: 'Produto incorreto',
  LOT_REQUIRED: 'Lote obrigatório',
  WRONG_LOT: 'Lote incorreto',
  INVALID_QUANTITY_FOR_UNIT: 'Quantidade inválida para a unidade',
  QUANTITY_MISMATCH: 'Quantidade divergente',
};

export function label<T extends string>(map: Record<T, string>, value: T | null | undefined): string {
  return value ? (map[value] ?? value) : '—';
}
