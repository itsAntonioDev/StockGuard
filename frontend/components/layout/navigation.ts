import {
  ArrowLeftRight,
  ChartColumn,
  ClipboardCheck,
  FileText,
  House,
  MapPin,
  Package,
  Settings,
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
  /** Rotas que também deixam o item destacado (telas acessadas a partir dele). */
  match?: string[];
}

/** Menu conforme o protótipo. Alertas, Inventários, Perfis e Auditoria são acessados a partir destes itens. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Início', icon: House, permissions: [], match: ['/', '/dashboard', '/alertas', '/minha-conta'] },
  { href: '/produtos', label: 'Produtos', icon: Package, permissions: ['products.read'] },
  { href: '/enderecos', label: 'Endereços', icon: MapPin, permissions: ['locations.read'] },
  { href: '/movimentacoes', label: 'Movimentações', icon: ArrowLeftRight, permissions: ['movements.read.own', 'movements.read.all'] },
  { href: '/conferencia', label: 'Conferência', icon: ClipboardCheck, permissions: ['checks.perform'], match: ['/conferencia', '/inventarios'] },
  { href: '/divergencias', label: 'Divergências', icon: TriangleAlert, permissions: ['discrepancies.read.own', 'discrepancies.read.all'] },
  { href: '/relatorios', label: 'Relatórios', icon: FileText, permissions: ['reports.read'] },
  { href: '/produtividade', label: 'Produtividade', icon: ChartColumn, permissions: ['productivity.read.all', 'productivity.read.own'] },
  { href: '/usuarios', label: 'Usuários', icon: Users, permissions: ['users.read'] },
  { href: '/configuracoes', label: 'Configurações', icon: Settings, permissions: ['settings.manage', 'roles.manage', 'audit.read'], match: ['/configuracoes', '/perfis', '/auditoria'] },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return (item.match ?? [item.href]).some((path) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)));
}
