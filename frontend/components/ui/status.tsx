import { ALERT_SEVERITY, DISCREPANCY_STATUS, INVENTORY_STATUS, LOCATION_STATUS, MOVEMENT_STATUS } from '@/lib/labels';
import type { AlertSeverity, DiscrepancyStatus, InventoryStatus, LocationStatus, MovementStatus } from '@/types/api';
import { Badge, type Tone } from './display';

const MOVEMENT_TONE: Record<MovementStatus, Tone> = {
  PENDING_CHECK: 'warning',
  PENDING_APPROVAL: 'info',
  CONFIRMED: 'success',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
};

const DISCREPANCY_TONE: Record<DiscrepancyStatus, Tone> = {
  OPEN: 'danger',
  IN_ANALYSIS: 'info',
  CORRECTED: 'success',
  CONFIRMED: 'warning',
  DISCARDED: 'neutral',
};

const INVENTORY_TONE: Record<InventoryStatus, Tone> = { OPEN: 'warning', SUBMITTED: 'info', APPROVED: 'success', CANCELLED: 'neutral' };
const SEVERITY_TONE: Record<AlertSeverity, Tone> = { INFO: 'info', WARNING: 'warning', CRITICAL: 'danger' };
const LOCATION_TONE: Record<LocationStatus, Tone> = { ACTIVE: 'success', BLOCKED: 'warning', INACTIVE: 'neutral' };

export const MovementStatusBadge = ({ status }: { status: MovementStatus }) => <Badge tone={MOVEMENT_TONE[status]}>{MOVEMENT_STATUS[status]}</Badge>;
export const DiscrepancyStatusBadge = ({ status }: { status: DiscrepancyStatus }) => <Badge tone={DISCREPANCY_TONE[status]}>{DISCREPANCY_STATUS[status]}</Badge>;
export const InventoryStatusBadge = ({ status }: { status: InventoryStatus }) => <Badge tone={INVENTORY_TONE[status]}>{INVENTORY_STATUS[status]}</Badge>;
export const SeverityBadge = ({ severity }: { severity: AlertSeverity }) => <Badge tone={SEVERITY_TONE[severity]}>{ALERT_SEVERITY[severity]}</Badge>;
export const LocationStatusBadge = ({ status }: { status: LocationStatus }) => <Badge tone={LOCATION_TONE[status]}>{LOCATION_STATUS[status]}</Badge>;
export const ActiveBadge = ({ active }: { active: boolean }) => <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Ativo' : 'Inativo'}</Badge>;
