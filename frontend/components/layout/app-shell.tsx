'use client';

import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/display';
import { useGeneralSettings } from '@/hooks/use-general-settings';
import { ME_QUERY_KEY, useMe } from '@/hooks/use-session';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { configureDisplay } from '@/lib/format';
import { authService } from '@/services';
import type { AuthStep } from '@/types/api';
import { isNavItemActive, NAV_ITEMS } from './navigation';

export function stepRoute(step: AuthStep): string {
  return step === 'CHANGE_PASSWORD' ? '/trocar-senha' : '/login/mfa';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''}`.toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: me, error, isPending } = useMe();
  const general = useGeneralSettings(Boolean(me && !me.pendingStep));
  const [menuOpen, setMenuOpen] = useState(false);

  // Sessão expirada/revogada em qualquer chamada: limpa o cache e volta ao login.
  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.clear();
      router.replace('/login');
    };
    const onAuthStep = () => void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    window.addEventListener('sg:unauthorized', onUnauthorized);
    window.addEventListener('sg:auth-step', onAuthStep);
    return () => {
      window.removeEventListener('sg:unauthorized', onUnauthorized);
      window.removeEventListener('sg:auth-step', onAuthStep);
    };
  }, [queryClient, router]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) router.replace('/login');
    if (me?.pendingStep) router.replace(stepRoute(me.pendingStep));
  }, [error, me, router]);

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return (
      <div className="p-8">
        <p className="text-sm text-red-700">Não foi possível carregar sua sessão. Recarregue a página.</p>
      </div>
    );
  }
  if (isPending || !me || me.pendingStep || general.isLoading) return <Spinner label="Verificando sessão…" />;

  // Preferências de exibição definidas em Configurações > Geral.
  if (general.data) configureDisplay({ dateFormat: general.data.dateFormat, timeFormat: general.data.timeFormat, timeZone: general.data.timezone });

  const items = NAV_ITEMS.filter((item) => item.permissions.length === 0 || item.permissions.some((code) => me.permissions.includes(code)));

  async function logout() {
    try {
      await authService.logout();
    } finally {
      queryClient.clear();
      router.replace('/login');
    }
  }

  const sidebar = (
    <nav className="flex h-full flex-col bg-neutral-950 text-neutral-400" aria-label="Navegação principal">
      <div className="flex items-center gap-2 px-5 pb-5 pt-6 text-white">
        <Shield className="size-5" aria-hidden />
        <span className="text-[15px] font-semibold">StockGuard</span>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => {
          const active = isNavItemActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors',
                  active ? 'bg-neutral-800 text-white' : 'hover:bg-neutral-900 hover:text-white',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 border-t border-neutral-900 px-4 py-4">
        <Link href="/minha-conta" onClick={() => setMenuOpen(false)} className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 hover:bg-neutral-900">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-700 text-xs font-semibold text-white" aria-hidden>
            {initials(me.user.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-white">{me.user.name}</span>
            <span className="block truncate text-xs text-neutral-400">{me.user.role.name}</span>
          </span>
        </Link>
        <button type="button" onClick={logout} className="rounded-md p-2 text-neutral-400 hover:bg-neutral-900 hover:text-white" aria-label="Sair" title="Sair">
          <LogOut className="size-4" />
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-white">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 lg:block">{sidebar}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-neutral-900/50" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 lg:hidden">
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="rounded-md p-2 hover:bg-neutral-100" aria-label="Abrir menu">
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="flex items-center gap-2 font-semibold">
            <Shield className="size-5" aria-hidden /> StockGuard
          </span>
          <span className="w-9" />
        </header>
        <main className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
