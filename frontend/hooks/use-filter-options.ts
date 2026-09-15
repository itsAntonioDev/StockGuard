'use client';

import { useQuery } from '@tanstack/react-query';
import { adminService, catalogService, locationService } from '@/services';
import { usePermissions } from './use-session';

type Option = { value: string; label: string };

/** Produtos para selects de filtro (até 100 ativos; a busca completa fica na tela de produtos). */
export function useProductOptions(): Option[] {
  const { can } = usePermissions();
  const { data } = useQuery({
    queryKey: ['options', 'products'],
    queryFn: () => catalogService.products({ active: 'true', pageSize: 100 }),
    enabled: can('products.read'),
    staleTime: 60_000,
  });
  return (data?.items ?? []).map((product) => ({ value: product.id, label: `${product.internalCode} · ${product.name}` }));
}

/** Operadores para filtros — somente para quem já pode listar usuários. */
export function useOperatorOptions(): Option[] {
  const { can } = usePermissions();
  const { data } = useQuery({
    queryKey: ['options', 'users'],
    queryFn: () => adminService.users({ active: 'true', pageSize: 100 }),
    enabled: can('users.read'),
    staleTime: 60_000,
  });
  return (data?.items ?? []).map((user) => ({ value: user.id, label: user.name }));
}

export function useSectorOptions(): Option[] {
  const { can } = usePermissions();
  const { data } = useQuery({ queryKey: ['sectors'], queryFn: () => locationService.sectors(), enabled: can('locations.read'), staleTime: 60_000 });
  return (data?.items ?? []).map((sector) => ({ value: sector.id, label: `${sector.warehouse.code} · ${sector.name}` }));
}
