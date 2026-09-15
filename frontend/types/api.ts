/** Contratos das respostas da API do StockGuard (datas chegam como ISO string). */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ItemsResponse<T> {
  items: T[];
}

export interface Ref {
  id: string;
  name: string;
}

export interface CodeRef {
  id: string;
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Autenticação e administração
// ---------------------------------------------------------------------------

export type AuthStep = 'MFA_SETUP' | 'MFA_VERIFY' | 'CHANGE_PASSWORD';
export type RoleCode = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'CHECKER';

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    sectorId: string | null;
    mfaEnabled: boolean;
    role: { id: string; code: RoleCode | string; name: string };
  };
  permissions: string[];
  pendingStep: AuthStep | null;
  sessionExpiresAt: string;
}

export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  failedLoginCount: number;
  trainingStartedAt: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  role: { id: string; code: RoleCode | string; name: string };
  sector: CodeRef | null;
}

export interface RoleRow {
  id: string;
  code: RoleCode | string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
}

export interface PermissionRow {
  code: string;
  module: string;
  description: string;
}

export interface SettingRow {
  key: string;
  description: string;
  value: unknown;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: Ref | null;
}

export interface AuditRow {
  id: string;
  createdAt: string;
  requestId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED';
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  actor: { id: string; name: string; email: string } | null;
}

// ---------------------------------------------------------------------------
// Cadastros
// ---------------------------------------------------------------------------

export type Unit = 'UN' | 'CX' | 'PCT' | 'KG' | 'G' | 'L' | 'ML' | 'M';
export type HandlingClass = 'STANDARD' | 'FRAGILE' | 'HEAVY' | 'PERISHABLE' | 'CONTROLLED';
export type LocationStatus = 'ACTIVE' | 'BLOCKED' | 'INACTIVE';

export interface Category {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  _count?: { products: number };
}

export interface Lot {
  id: string;
  code: string;
  expiresAt: string | null;
  createdAt?: string;
}

export interface ProductSummary {
  id: string;
  internalCode: string;
  barcode: string | null;
  name: string;
  unit: Unit;
  minStock: number;
  unitCost: number | null;
  tracksLot: boolean;
  tracksExpiry: boolean;
  handlingClass: HandlingClass;
  active: boolean;
  updatedAt: string;
  category: { id: string; name: string } | null;
  stockTotal: number;
  belowMinimum: boolean;
}

export interface ProductDetail extends ProductSummary {
  description: string | null;
  createdAt: string;
  balances: Array<{
    quantity: number;
    updatedAt: string;
    lot: Lot | null;
    location: { id: string; code: string; status: LocationStatus; sector: CodeRef };
  }>;
  lots: Lot[];
}

export interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  createdAt: string;
  location: { id: string; code: string };
  lot: { id: string; code: string } | null;
  createdBy: Ref;
  movement: { id: string; number: number; type: MovementType; reason: string | null; referenceDoc: string | null };
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  active: boolean;
  _count: { sectors: number; locations: number };
}

export interface Sector {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
  active: boolean;
  warehouse: CodeRef;
  _count: { locations: number };
}

export interface LocationSummary {
  id: string;
  code: string;
  aisle: string;
  shelf: string;
  position: string;
  capacity: number | null;
  status: LocationStatus;
  updatedAt: string;
  warehouse: CodeRef;
  sector: CodeRef;
}

export interface LocationDetail extends LocationSummary {
  occupiedQuantity: number;
  contents: Array<{
    quantity: number;
    updatedAt: string;
    product: { id: string; internalCode: string; barcode: string | null; name: string; unit: Unit };
    lot: Lot | null;
  }>;
}

// ---------------------------------------------------------------------------
// Movimentações e conferência
// ---------------------------------------------------------------------------

export type MovementType = 'ENTRY' | 'EXIT' | 'PICKING' | 'TRANSFER' | 'ADJUSTMENT' | 'INVENTORY';
export type MovementStatus = 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'CANCELLED' | 'REJECTED';

export interface MovementListItem {
  id: string;
  number: number;
  type: MovementType;
  status: MovementStatus;
  referenceDoc: string | null;
  createdAt: string;
  checkStartedAt: string | null;
  confirmedAt: string | null;
  warehouse: CodeRef;
  createdBy: Ref;
  checkedBy: Ref | null;
  _count: { items: number; discrepancies: number };
}

export interface MovementLocationRef {
  id: string;
  code: string;
  status: LocationStatus;
  warehouseId: string;
  sectorId: string;
  capacity: number | null;
}

export interface MovementItem {
  id: string;
  productId: string;
  lotId: string | null;
  fromLocationId: string | null;
  toLocationId: string | null;
  expectedQuantity: number;
  quantity: number | null;
  unit: Unit;
  direction: number;
  product: { id: string; internalCode: string; barcode: string | null; name: string; unit: Unit; tracksLot: boolean; tracksExpiry: boolean; unitCost: number | null };
  lot: Lot | null;
  fromLocation: MovementLocationRef | null;
  toLocation: MovementLocationRef | null;
}

export interface MovementDetail {
  id: string;
  number: number;
  type: MovementType;
  status: MovementStatus;
  warehouseId: string;
  reason: string | null;
  notes: string | null;
  referenceDoc: string | null;
  createdById: string;
  createdAt: string;
  checkStartedAt: string | null;
  checkedAt: string | null;
  approvedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  warehouse: CodeRef;
  createdBy: Ref;
  checkedBy: Ref | null;
  approvedBy: Ref | null;
  cancelledBy: Ref | null;
  items: MovementItem[];
  discrepancies: Array<{ id: string; number: number; type: DiscrepancyType; status: DiscrepancyStatus; createdAt: string }>;
}

export interface MovementCreateResult {
  movement: MovementDetail;
  replayed: boolean;
  warnings: string[];
}

export interface MovementItemInput {
  productId: string;
  lotId?: string;
  lotCode?: string;
  lotExpiresAt?: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantity: string;
  direction?: 'IN' | 'OUT';
}

export interface MovementCreateInput {
  type: Exclude<MovementType, 'INVENTORY'>;
  warehouseId: string;
  referenceDoc?: string;
  reason?: string;
  notes?: string;
  items: MovementItemInput[];
}

export interface CheckScan {
  itemId: string;
  locationCode: string;
  destinationCode?: string;
  productCode: string;
  lotCode?: string;
  quantity: string;
}

export interface CheckErrorDetail {
  code: string;
  message: string;
  expected: string | null;
  informed: string | null;
}

export interface CheckResult {
  itemId: string;
  result: 'MATCH' | 'MISMATCH';
  product: { internalCode: string; name: string };
  errors: CheckErrorDetail[];
}

// ---------------------------------------------------------------------------
// Divergências, alertas e inventário
// ---------------------------------------------------------------------------

export type DiscrepancyType =
  | 'WRONG_PRODUCT'
  | 'QUANTITY_MISMATCH'
  | 'WRONG_LOCATION'
  | 'PRODUCT_NOT_FOUND'
  | 'NEGATIVE_STOCK'
  | 'DUPLICATE_PRODUCT'
  | 'WRONG_LOT'
  | 'WRONG_UNIT';
export type DiscrepancyStatus = 'OPEN' | 'IN_ANALYSIS' | 'CORRECTED' | 'CONFIRMED' | 'DISCARDED';
export type DiscrepancyOrigin = 'CHECK' | 'INVENTORY' | 'MANUAL';
export type ProbableCause =
  | 'NOT_DETERMINED'
  | 'PROCESS'
  | 'TRAINING'
  | 'LABELING'
  | 'SYSTEM_DATA'
  | 'SUPPLIER'
  | 'PHYSICAL_LAYOUT'
  | 'DAMAGE'
  | 'LOSS'
  | 'OTHER';

export interface DiscrepancyRow {
  id: string;
  number: number;
  type: DiscrepancyType;
  status: DiscrepancyStatus;
  origin: DiscrepancyOrigin;
  probableCause: ProbableCause;
  expectedQuantity: number | null;
  foundQuantity: number | null;
  estimatedValue: number | null;
  createdAt: string;
  resolvedAt: string | null;
  product: { id: string; internalCode: string; name: string; unit: Unit } | null;
  location: { id: string; code: string; sector: CodeRef } | null;
  movement: { id: string; number: number; type: MovementType } | null;
  reportedBy: Ref;
  operationUser: Ref | null;
  assignedTo: Ref | null;
}

export interface DiscrepancyDetail extends Omit<DiscrepancyRow, 'movement'> {
  description: string;
  correctiveAction: string | null;
  expectedCode: string | null;
  foundCode: string | null;
  unitCostSnapshot: number | null;
  analysisStartedAt: string | null;
  lot: Lot | null;
  movement: { id: string; number: number; type: MovementType; status: MovementStatus } | null;
  actions: Array<{
    id: string;
    kind: 'CREATED' | 'COMMENT' | 'STATUS_CHANGE' | 'ASSIGNMENT' | 'CAUSE_UPDATE' | 'EVIDENCE_ADDED';
    fromStatus: DiscrepancyStatus | null;
    toStatus: DiscrepancyStatus | null;
    note: string | null;
    createdAt: string;
    user: Ref;
  }>;
  evidences: Array<{ id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; uploadedBy: Ref }>;
}

export type AlertType =
  | 'LOW_STOCK'
  | 'NEGATIVE_STOCK_ATTEMPT'
  | 'WRONG_LOCATION'
  | 'QUANTITY_MISMATCH'
  | 'RECURRING_DISCREPANCY'
  | 'PENDING_OPERATION'
  | 'REPEATED_INVALID_ATTEMPTS';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface AlertRow {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  occurrences: number;
  createdAt: string;
  lastOccurredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  product: { id: string; internalCode: string; name: string } | null;
  location: { id: string; code: string } | null;
  movement: { id: string; number: number; type: MovementType; status: MovementStatus } | null;
  relatedUser: Ref | null;
  acknowledgedBy: Ref | null;
}

export type InventoryStatus = 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED';

export interface InventoryRow {
  id: string;
  number: number;
  status: InventoryStatus;
  blind: boolean;
  notes: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  createdById: string;
  warehouse: CodeRef;
  sector: CodeRef | null;
  createdBy: Ref;
  approvedBy: Ref | null;
  progress: { total: number; counted: number };
}

export interface InventoryDetail extends InventoryRow {
  movement: { id: string; number: number; status: MovementStatus } | null;
  discrepancies: number;
  showsSystemQuantity: boolean;
}

export interface InventoryItemRow {
  id: string;
  location: { id: string; code: string };
  product: { id: string; internalCode: string; barcode: string | null; name: string; unit: Unit; tracksLot: boolean };
  lot: Lot | null;
  countedBy: Ref | null;
  countedAt: string | null;
  countedQuantity: number | null;
  recountQuantity: number | null;
  systemQuantity: number | null;
  difference: number | null;
}

// ---------------------------------------------------------------------------
// Indicadores e relatórios
// ---------------------------------------------------------------------------

export interface PeriodMetrics {
  confirmedMovements: number;
  analyzedOperations: number;
  operationsWithDiscrepancy: number;
  discrepancyRate: number | null;
  discrepancies: number;
  discardedDiscrepancies: number;
  estimatedValue: number;
  discrepanciesWithoutValue: number;
}

export interface DiscrepancyTypeCount {
  type: DiscrepancyType;
  label: string;
  count: number;
  share: number;
}

export interface Dashboard {
  period: { from: string; to: string; granularity: 'day' | 'week' | 'month' };
  metrics: PeriodMetrics;
  comparison: {
    confirmedMovements: number | null;
    discrepancies: number | null;
    estimatedValue: number | null;
    discrepancyRatePoints: number | null;
  };
  discrepanciesByType: DiscrepancyTypeCount[];
  topProducts: Array<{ id: string; internalCode: string; name: string; count: number; estimatedValue: number }>;
  topSectors: Array<{ id: string; code: string; name: string; count: number }>;
  series: Array<{ bucket: string; movements: number; analyzedOperations: number; operationsWithDiscrepancy: number; discrepancies: number; discrepancyRate: number | null }>;
  resolution: { averageHours: number | null; resolvedCount: number };
  pending: { pendingCheck: number; pendingApproval: number; total: number; oldestCreatedAt: string | null };
  openAlerts: Partial<Record<AlertSeverity, number>>;
  definitions: { discrepancyRate: string; estimatedValue: string };
}

export interface TrainingSuggestion {
  codes: string[];
  share: number;
  message: string;
}

export interface Productivity {
  period: { from: string; to: string };
  scope: 'INDIVIDUAL' | 'OPERATION';
  minSampleSize: number;
  individual: {
    user: { id: string; name: string; role: string; sector: { code: string; name: string } | null };
    trainingDays: number | null;
    operationsByHandlingClass: Array<{ handlingClass: HandlingClass; operations: number }>;
  } | null;
  byOperationType: Array<{
    type: MovementType;
    label: string;
    operations: number;
    sufficientSample: boolean;
    averageItems: number | null;
    averageQuantity: number | null;
    averageMinutes: number | null;
    averageMinutesPerItem: number | null;
    operationsPerActiveHour: number | null;
    firstPassAccuracy: number | null;
    reworkPerOperation: number | null;
  }>;
  bySector: Array<{
    sector: CodeRef;
    attempts: number;
    sufficientSample: boolean;
    attemptAccuracy: number | null;
    errorMix: Record<string, number>;
    averageResolutionHours: number | null;
    resolvedDiscrepancies: number;
    suggestions: TrainingSuggestion[];
  }>;
  weeklyEvolution: Array<{ week: string; sectorCode: string; attempts: number; attemptAccuracy: number | null }>;
  inventoryRework: { countedItems: number; recounts: number };
  suggestions: TrainingSuggestion[];
  notes: string[];
}

export interface ReportSummary {
  period: { from: string; to: string };
  metrics: PeriodMetrics;
  discrepanciesByType: DiscrepancyTypeCount[];
}

export type ReportRow = Record<string, string | number | boolean | null>;
