/**
 * Catálogo de permissões (RBAC). Os vínculos perfil→permissão ficam no banco e
 * podem ser ajustados pelo administrador; os padrões abaixo são aplicados pelo seed.
 *
 * Toda rota declara a permissão exigida e o backend a verifica — o frontend
 * apenas usa a mesma lista para esconder o que o usuário não pode fazer.
 */
export const PERMISSIONS = {
  'products.read': { module: 'products', description: 'Consultar produtos, categorias e lotes' },
  'products.manage': { module: 'products', description: 'Criar e editar produtos, categorias e lotes' },
  'locations.read': { module: 'locations', description: 'Consultar armazéns, setores e endereços' },
  'locations.manage': { module: 'locations', description: 'Criar e editar armazéns, setores e endereços' },
  'stock.read': { module: 'stock', description: 'Consultar saldos e histórico de estoque' },

  'movements.read.own': { module: 'movements', description: 'Consultar as próprias movimentações' },
  'movements.read.all': { module: 'movements', description: 'Consultar todas as movimentações' },
  'movements.create': { module: 'movements', description: 'Registrar entradas, saídas, separações e transferências' },
  'movements.cancel': { module: 'movements', description: 'Cancelar movimentações pendentes' },
  'movements.adjust.request': { module: 'movements', description: 'Solicitar ajuste de estoque (com justificativa)' },
  'movements.adjust.approve': { module: 'movements', description: 'Aprovar ou rejeitar ajustes de estoque' },
  'movements.confirm_variance': { module: 'movements', description: 'Confirmar conferência com diferença de quantidade (gera divergência)' },

  'checks.perform': { module: 'checks', description: 'Executar conferência de produtos' },

  'inventory.count': { module: 'inventory', description: 'Registrar contagens de inventário' },
  'inventory.manage': { module: 'inventory', description: 'Abrir, enviar para revisão e cancelar inventários' },
  'inventory.approve': { module: 'inventory', description: 'Aprovar inventários e aplicar ajustes' },

  'discrepancies.read.own': { module: 'discrepancies', description: 'Consultar divergências ligadas às próprias operações' },
  'discrepancies.read.all': { module: 'discrepancies', description: 'Consultar todas as divergências' },
  'discrepancies.create': { module: 'discrepancies', description: 'Registrar divergências' },
  'discrepancies.manage': { module: 'discrepancies', description: 'Analisar, atribuir e resolver divergências' },

  'alerts.read': { module: 'alerts', description: 'Consultar alertas' },
  'alerts.manage': { module: 'alerts', description: 'Reconhecer e resolver alertas' },

  'dashboard.read': { module: 'analytics', description: 'Visualizar dashboard gerencial' },
  'productivity.read.own': { module: 'analytics', description: 'Visualizar os próprios indicadores' },
  'productivity.read.all': { module: 'analytics', description: 'Visualizar indicadores de produtividade da operação' },
  'reports.read': { module: 'analytics', description: 'Consultar relatórios' },
  'reports.export': { module: 'analytics', description: 'Exportar relatórios (CSV)' },

  'users.read': { module: 'admin', description: 'Consultar usuários' },
  'users.manage': { module: 'admin', description: 'Gerenciar todos os usuários' },
  'users.manage_operators': { module: 'admin', description: 'Gerenciar operadores e conferentes' },
  'roles.manage': { module: 'admin', description: 'Configurar permissões dos perfis' },
  'settings.manage': { module: 'admin', description: 'Gerenciar configurações do sistema' },
  'audit.read': { module: 'admin', description: 'Consultar e verificar logs de auditoria' },
} as const satisfies Record<string, { module: string; description: string }>;

export type PermissionCode = keyof typeof PERMISSIONS;

export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export const ROLE_CODES = ['ADMIN', 'MANAGER', 'OPERATOR', 'CHECKER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_DEFINITIONS: Record<RoleCode, { name: string; description: string; permissions: PermissionCode[] }> = {
  ADMIN: {
    name: 'Administrador',
    description: 'Configura usuários, perfis, cadastros e parâmetros do sistema. Não movimenta estoque por padrão.',
    permissions: [
      'products.read', 'products.manage', 'locations.read', 'locations.manage', 'stock.read',
      'movements.read.all', 'discrepancies.read.all', 'alerts.read', 'dashboard.read',
      'productivity.read.all', 'reports.read', 'reports.export',
      'users.read', 'users.manage', 'roles.manage', 'settings.manage', 'audit.read',
    ],
  },
  MANAGER: {
    name: 'Gestor',
    description: 'Acompanha indicadores, analisa divergências, aprova ajustes e gerencia a equipe operacional.',
    permissions: [
      'products.read', 'locations.read', 'stock.read',
      'movements.read.all', 'movements.create', 'movements.cancel', 'movements.adjust.request',
      'movements.adjust.approve', 'movements.confirm_variance', 'checks.perform',
      'inventory.count', 'inventory.manage', 'inventory.approve',
      'discrepancies.read.all', 'discrepancies.create', 'discrepancies.manage',
      'alerts.read', 'alerts.manage', 'dashboard.read', 'productivity.read.all',
      'reports.read', 'reports.export', 'users.read', 'users.manage_operators',
    ],
  },
  OPERATOR: {
    name: 'Operador',
    description: 'Executa movimentações autorizadas, conferências e contagens.',
    permissions: [
      'products.read', 'locations.read', 'stock.read',
      'movements.read.own', 'movements.create', 'movements.adjust.request', 'checks.perform',
      'inventory.count', 'discrepancies.read.own', 'discrepancies.create', 'productivity.read.own',
    ],
  },
  CHECKER: {
    name: 'Conferente',
    description: 'Confere operações de outros usuários e registra divergências.',
    permissions: [
      'products.read', 'locations.read', 'stock.read',
      'movements.read.own', 'checks.perform', 'inventory.count',
      'discrepancies.read.own', 'discrepancies.create', 'productivity.read.own',
    ],
  },
};

/** Permissões que nunca podem ser removidas do perfil ADMIN (evita perder o acesso administrativo). */
export const ADMIN_LOCKED_PERMISSIONS: PermissionCode[] = ['users.manage', 'roles.manage', 'audit.read'];

/** Perfis que um gestor com `users.manage_operators` pode atribuir. */
export const OPERATIONAL_ROLE_CODES: RoleCode[] = ['OPERATOR', 'CHECKER'];
