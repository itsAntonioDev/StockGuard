'use client';

import { useQuery } from '@tanstack/react-query';
import { settingsService } from '@/services';

export const GENERAL_SETTINGS_KEY = ['settings', 'general'] as const;

/** Preferências de exibição da empresa (nome, fuso, formatos, manter filtros). */
export function useGeneralSettings(enabled = true) {
  return useQuery({ queryKey: GENERAL_SETTINGS_KEY, queryFn: settingsService.general, enabled, staleTime: 5 * 60_000, retry: false });
}
