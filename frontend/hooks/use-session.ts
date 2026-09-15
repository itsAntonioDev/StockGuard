'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { authService } from '@/services';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: authService.me, retry: false, staleTime: 60_000 });
}

/**
 * Permissões do usuário para montar a interface (menus, botões).
 * Apenas conveniência visual: o backend recusa tudo o que não for permitido.
 */
export function usePermissions() {
  const { data: me } = useMe();
  const permissions = me?.permissions;
  const can = useCallback((...codes: string[]) => codes.some((code) => permissions?.includes(code) ?? false), [permissions]);
  return { me, can };
}
