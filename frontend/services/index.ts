/**
 * Chamadas à API agrupadas por módulo. Nenhuma regra de negócio mora aqui:
 * o backend valida e autoriza tudo; o frontend apenas envia e exibe.
 */
import { api, type QueryParams } from '@/lib/api';
import type {
  AlertRow,
  AuditRow,
  Category,
  CheckResult,
  CheckScan,
  Dashboard,
  DiscrepancyDetail,
  DiscrepancyRow,
  InventoryDetail,
  InventoryItemRow,
  InventoryRow,
  ItemsResponse,
  LedgerEntry,
  LocationDetail,
  LocationSummary,
  Lot,
  Me,
  MovementCreateInput,
  MovementCreateResult,
  MovementDetail,
  MovementListItem,
  Paginated,
  PermissionRow,
  ProductDetail,
  ProductSummary,
  Productivity,
  ReportRow,
  ReportSummary,
  RoleRow,
  Sector,
  SessionInfo,
  SettingRow,
  UserRow,
  Warehouse,
} from '@/types/api';

type Body = Record<string, unknown>;

export const authService = {
  me: () => api<Me>('/auth/me'),
  login: (email: string, password: string) => api<{ pendingStep: Me['pendingStep'] }>('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
  startMfaSetup: () => api<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', { method: 'POST' }),
  confirmMfaSetup: (code: string) => api<{ ok: true }>('/auth/mfa/confirm', { method: 'POST', body: { code } }),
  verifyMfa: (code: string) => api<{ ok: true }>('/auth/mfa/verify', { method: 'POST', body: { code } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: true }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
  sessions: () => api<ItemsResponse<SessionInfo>>('/auth/sessions'),
  revokeSession: (id: string) => api<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
};

export const catalogService = {
  products: (query: QueryParams) => api<Paginated<ProductSummary>>('/products', { query }),
  product: (id: string) => api<ProductDetail>(`/products/${id}`),
  lookup: (code: string) => api<ProductSummary>('/products/lookup', { query: { code } }),
  createProduct: (body: Body) => api<ProductSummary>('/products', { method: 'POST', body }),
  updateProduct: (id: string, body: Body) => api<ProductSummary>(`/products/${id}`, { method: 'PATCH', body }),
  history: (id: string, query: QueryParams) => api<Paginated<LedgerEntry>>(`/products/${id}/history`, { query }),
  lots: (id: string) => api<ItemsResponse<Lot>>(`/products/${id}/lots`),
  createLot: (id: string, body: Body) => api<Lot>(`/products/${id}/lots`, { method: 'POST', body }),
  categories: (includeInactive = false) => api<ItemsResponse<Category>>('/categories', { query: { includeInactive } }),
  createCategory: (body: Body) => api<Category>('/categories', { method: 'POST', body }),
};

export const locationService = {
  warehouses: () => api<ItemsResponse<Warehouse>>('/warehouses'),
  createWarehouse: (body: Body) => api<Warehouse>('/warehouses', { method: 'POST', body }),
  updateWarehouse: (id: string, body: Body) => api<Warehouse>(`/warehouses/${id}`, { method: 'PATCH', body }),
  sectors: (warehouseId?: string) => api<ItemsResponse<Sector>>('/sectors', { query: { warehouseId } }),
  createSector: (body: Body) => api<Sector>('/sectors', { method: 'POST', body }),
  updateSector: (id: string, body: Body) => api<Sector>(`/sectors/${id}`, { method: 'PATCH', body }),
  locations: (query: QueryParams) => api<Paginated<LocationSummary>>('/locations', { query }),
  location: (id: string) => api<LocationDetail>(`/locations/${id}`),
  lookup: (code: string, warehouseId?: string) => api<LocationSummary>('/locations/lookup', { query: { code, warehouseId } }),
  createLocation: (body: Body) => api<LocationSummary>('/locations', { method: 'POST', body }),
  bulkCreate: (body: Body) => api<{ created: number; skippedCodes: string[] }>('/locations/bulk', { method: 'POST', body }),
  updateLocation: (id: string, body: Body) => api<LocationSummary>(`/locations/${id}`, { method: 'PATCH', body }),
};

export const movementService = {
  list: (query: QueryParams) => api<Paginated<MovementListItem>>('/movements', { query }),
  get: (id: string) => api<MovementDetail>(`/movements/${id}`),
  create: (input: MovementCreateInput, idempotencyKey: string) =>
    api<MovementCreateResult>('/movements', { method: 'POST', body: input, idempotencyKey }),
  cancel: (id: string, reason: string) => api<MovementDetail>(`/movements/${id}/cancel`, { method: 'POST', body: { reason } }),
  approve: (id: string) => api<MovementDetail>(`/movements/${id}/approve`, { method: 'POST' }),
  reject: (id: string, reason: string) => api<MovementDetail>(`/movements/${id}/reject`, { method: 'POST', body: { reason } }),
  check: (id: string, scan: CheckScan) => api<CheckResult>(`/movements/${id}/check`, { method: 'POST', body: scan }),
  confirm: (id: string, items: CheckScan[], varianceReason?: string) =>
    api<MovementDetail>(`/movements/${id}/confirm`, { method: 'POST', body: { items, ...(varianceReason ? { varianceReason } : {}) } }),
};

export const discrepancyService = {
  list: (query: QueryParams) => api<Paginated<DiscrepancyRow>>('/discrepancies', { query }),
  get: (id: string) => api<DiscrepancyDetail>(`/discrepancies/${id}`),
  create: (body: Body) => api<DiscrepancyDetail>('/discrepancies', { method: 'POST', body }),
  changeStatus: (id: string, body: Body) => api<DiscrepancyDetail>(`/discrepancies/${id}/status`, { method: 'POST', body }),
  assign: (id: string, assignedToId: string | null) => api<DiscrepancyDetail>(`/discrepancies/${id}/assign`, { method: 'POST', body: { assignedToId } }),
  comment: (id: string, note: string) => api<DiscrepancyDetail>(`/discrepancies/${id}/comments`, { method: 'POST', body: { note } }),
  uploadEvidence: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api<{ id: string }>(`/discrepancies/${id}/evidences`, { method: 'POST', formData });
  },
};

export const alertService = {
  list: (query: QueryParams) => api<Paginated<AlertRow>>('/alerts', { query }),
  summary: () => api<{ open: Partial<Record<'INFO' | 'WARNING' | 'CRITICAL', number>> }>('/alerts/summary'),
  acknowledge: (id: string) => api<AlertRow>(`/alerts/${id}/acknowledge`, { method: 'POST' }),
  resolve: (id: string) => api<AlertRow>(`/alerts/${id}/resolve`, { method: 'POST' }),
};

export const inventoryService = {
  list: (query: QueryParams) => api<Paginated<InventoryRow>>('/inventories', { query }),
  get: (id: string) => api<InventoryDetail>(`/inventories/${id}`),
  items: (id: string, query: QueryParams) => api<Paginated<InventoryItemRow>>(`/inventories/${id}/items`, { query }),
  open: (body: Body) => api<InventoryDetail>('/inventories', { method: 'POST', body }),
  count: (id: string, body: Body) => api<{ kind: 'UNEXPECTED' | 'COUNT' | 'RECOUNT'; item: InventoryItemRow }>(`/inventories/${id}/counts`, { method: 'POST', body }),
  submit: (id: string) => api<InventoryDetail>(`/inventories/${id}/submit`, { method: 'POST' }),
  approve: (id: string) => api<InventoryDetail>(`/inventories/${id}/approve`, { method: 'POST' }),
  cancel: (id: string, reason: string) => api<InventoryDetail>(`/inventories/${id}/cancel`, { method: 'POST', body: { reason } }),
};

export const analyticsService = {
  dashboard: (query: QueryParams) => api<Dashboard>('/analytics/dashboard', { query }),
  productivity: (query: QueryParams) => api<Productivity>('/analytics/productivity', { query }),
  reportSummary: (query: QueryParams) => api<ReportSummary>('/reports/summary', { query }),
  report: (report: 'movements' | 'discrepancies' | 'stock', query: QueryParams) => api<Paginated<ReportRow>>(`/reports/${report}`, { query }),
};

export const adminService = {
  users: (query: QueryParams) => api<Paginated<UserRow>>('/users', { query }),
  createUser: (body: Body) => api<{ user: UserRow; temporaryPassword: string }>('/users', { method: 'POST', body }),
  updateUser: (id: string, body: Body) => api<UserRow>(`/users/${id}`, { method: 'PATCH', body }),
  resetPassword: (id: string) => api<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST' }),
  unlock: (id: string) => api<void>(`/users/${id}/unlock`, { method: 'POST' }),
  resetMfa: (id: string) => api<void>(`/users/${id}/reset-mfa`, { method: 'POST' }),
  roles: () => api<ItemsResponse<RoleRow>>('/roles'),
  permissions: () => api<ItemsResponse<PermissionRow>>('/permissions'),
  updateRolePermissions: (id: string, permissions: string[]) =>
    api<{ added: string[]; removed: string[] }>(`/roles/${id}/permissions`, { method: 'PUT', body: { permissions } }),
  settings: () => api<ItemsResponse<SettingRow>>('/settings'),
  updateSetting: (key: string, value: unknown) => api<unknown>(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } }),
  auditLogs: (query: QueryParams) => api<Paginated<AuditRow>>('/audit-logs', { query }),
  verifyAudit: () => api<{ valid: boolean; checked: number; firstInvalidId: string | null }>('/audit-logs/verify'),
};
