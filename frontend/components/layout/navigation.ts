import {
  ArrowLeftRight,
  Bell,
  ClipboardList,
  FileText,
  Gauge,
  House,
  LayoutDashboard,
  MapPin,
  Package,
  ScanBarcode,
  ScrollText,
  Settings,
  ShieldCheck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Basta uma das permissões. Vazio = qualquer usuário autenticado. */
  permissions: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Início', icon: House, permissions: [] },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permissions: ['dashboard.read'] },
  { href: '/conferencia', label: 'Conferência', icon: ScanBarcode, permissions: ['checks.perform'] },
  { href: '/movimentacoes', label: 'Movimentações', icon: ArrowLeftRight, permissions: ['movements.read.own', 'movements.read.all'] },
  { href: '/inventarios', label: 'Inventários', icon: ClipboardList, permissions: ['inventory.count', 'inventory.manage', 'inventory.approve'] },
  { href: '/divergencias', label: 'Divergências', icon: TriangleAlert, permissions: ['discrepancies.read.own', 'discrepancies.read.all'] },
  { href: '/alertas', label: 'Alertas', icon: Bell, permissions: ['alerts.read'] },
  { href: '/produtos', label: 'Produtos', icon: Package, permissions: ['products.read'] },
  { href: '/enderecos', label: 'Endereços', icon: MapPin, permissions: ['locations.read'] },
  { href: '/produtividade', label: 'Produtividade', icon: Gauge, permissions: ['productivity.read.all', 'productivity.read.own'] },
  { href: '/relatorios', label: 'Relatórios', icon: FileText, permissions: ['reports.read'] },
  { href: '/usuarios', label: 'Usuários', icon: Users, permissions: ['users.read'] },
  { href: '/perfis', label: 'Perfis e permissões', icon: ShieldCheck, permissions: ['roles.manage'] },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, permissions: ['settings.manage'] },
  { href: '/auditoria', label: 'Auditoria', icon: ScrollText, permissions: ['audit.read'] },
];
