'use client';

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useGeneralSettings } from './use-general-settings';

/**
 * Estado de filtro que, com "Manter último filtro ao sair da página" ativo,
 * é guardado na sessão do navegador (sessionStorage — somente filtros, nunca dados).
 * As telas internas só renderizam no cliente (após carregar a sessão), então ler o
 * armazenamento na inicialização não causa diferença de hidratação.
 */
export function useRememberedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { data } = useGeneralSettings();
  const enabled = data?.rememberFilters ?? false;
  const storageKey = `sg:filtro:${key}`;

  const [value, setValue] = useState<T>(() => {
    if (!enabled) return initial;
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
        if (enabled) {
          try {
            sessionStorage.setItem(storageKey, JSON.stringify(resolved));
          } catch {
            // Armazenamento indisponível (modo privado): o filtro apenas não é lembrado.
          }
        }
        return resolved;
      }),
    [enabled, storageKey],
  );

  return [value, update];
}
