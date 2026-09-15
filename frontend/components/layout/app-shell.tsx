'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleUser, LogOut, Menu, Shield, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/display';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ME_QUERY_KEY, useMe } from '@/hooks/use-session';
import { authService } from '@/services';
import type { AuthStep } from '@/types/api';
import { NAV_ITEMS } from './navigation';

export function stepRoute(step: AuthStep): string {
  return step === 'CHANGE_PASSWORD' ? '/trocar-senha' : '/login/mfa';
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data: me, error, isPending } = useMe();
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
    return <div className="p-8"><p className="text-sm text-red-700">Não foi possível carregar sua sessão. Recarregue a página.</p></div>;
  }
  if (isPending || !me || me.pendingStep) return <Spinner label="Verificando sessão…" />;

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
    <nav className="flex h-full flex-col bg-neutral-950 text-neutral-300" aria-label="Navegação principal">
      <div className="flex items-center gap-2 px-5 py-5 text-white">
        <Shield className="size-6" aria-hidden />
        <span className="text-lg font-semibold">StockGuard</span>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
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
      <div className="border-t border-neutral-800 p-3">
        <Link href="/minha-conta" className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-neutral-900">
          <CircleUser className="size-8 text-neutral-400" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">{me.user.name}</span>
            <span className="block truncate text-xs text-neutral-400">{me.user.role.name}</span>
          </span>
        </Link>
        <button type="button" onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-neutral-900 hover:text-white">
          <LogOut className="size-4" aria-hidden />
          Sair
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{sidebar}</aside>

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
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
