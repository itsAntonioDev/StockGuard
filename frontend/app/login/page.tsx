'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Eye, EyeOff, Lock, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { stepRoute } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Checkbox, Field, Input } from '@/components/ui/form';
import { ME_QUERY_KEY } from '@/hooks/use-session';
import { authService } from '@/services';

/** "Lembrar de mim" guarda somente o e-mail neste dispositivo — nunca senha ou sessão. */
const REMEMBER_KEY = 'sg:lembrar-email';

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

const noopSubscribe = () => () => undefined;

/** true somente no navegador (após hidratação), sem efeitos colaterais. */
function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Foto do armazém servida pela própria aplicação (public/), com leve escurecimento à esquerda para legibilidade do texto. */
const WAREHOUSE_BACKGROUND = "linear-gradient(90deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.15) 70%), url('/login-armazem.jpg')";

function BrandPanel() {
  return (
    <section
      className="relative hidden overflow-hidden bg-neutral-950 bg-cover bg-center text-white lg:flex"
      style={{ backgroundImage: WAREHOUSE_BACKGROUND }}
    >
      <div className="relative flex w-full flex-col justify-between p-12">
        <div>
          <div className="flex items-center gap-3">
            <Shield className="size-10" strokeWidth={1.5} aria-hidden />
            <span className="text-3xl font-semibold tracking-tight">StockGuard</span>
          </div>
          <p className="mt-2 text-xs text-neutral-300">Controle de estoque. Mais precisão. Mais resultados.</p>
        </div>
        <ul className="mb-16 space-y-5 text-[13px]">
          {['Reduza divergências', 'Aumente a produtividade', 'Tenha total controle'].map((text) => (
            <li key={text} className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full border border-neutral-500">
                <CircleCheck className="size-4" aria-hidden />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(readRememberedEmail);
  const [remember, setRemember] = useState(() => readRememberedEmail() !== '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [missing, setMissing] = useState(false);
  const [forgot, setForgot] = useState(false);

  const login = useMutation({
    mutationFn: () => authService.login(email.trim(), password),
    onSuccess: async ({ pendingStep }) => {
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        // Armazenamento indisponível: apenas não lembra o e-mail.
      }
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.replace(pendingStep ? stepRoute(pendingStep) : '/');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setMissing(true);
      return;
    }
    setMissing(false);
    login.mutate();
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <Shield className="size-7" aria-hidden />
        <span className="text-xl font-semibold">StockGuard</span>
      </div>
      <h1 className="text-xl font-semibold text-neutral-900">Bem-vindo de volta!</h1>
      <p className="mt-1 text-xs text-neutral-500">Faça login para acessar o sistema.</p>

      <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
        <Field label="Usuário ou e-mail">
          {(id) => <Input id={id} type="email" autoComplete="username" placeholder="Digite seu usuário ou e-mail" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus={!email} />}
        </Field>
        <Field label="Senha">
          {(id) => (
            <div className="relative">
              <Input
                id={id}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-10"
                autoFocus={Boolean(email)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-neutral-500 hover:text-neutral-900"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          )}
        </Field>

        <div className="flex items-center justify-between gap-3">
          <Checkbox label="Lembrar de mim" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          <button type="button" onClick={() => setForgot((value) => !value)} className="text-xs text-neutral-700 hover:text-neutral-900 hover:underline">
            Esqueceu sua senha?
          </button>
        </div>

        {forgot && <Notice tone="neutral">Por segurança, a redefinição é feita pelo administrador ou pelo seu gestor, que gera uma senha temporária para o primeiro acesso.</Notice>}
        {missing && <Notice tone="danger">Informe o usuário ou e-mail e a senha.</Notice>}
        {login.error && <ErrorMessage error={login.error} />}

        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
          Entrar
        </Button>
      </form>

      <div className="mt-10 flex items-center justify-center gap-3 text-xs text-neutral-500">
        <Lock className="size-4 shrink-0 text-neutral-700" aria-hidden />
        <p>
          <span className="block font-medium text-neutral-800">Acesso seguro</span>
          Suas informações estão protegidas.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const isClient = useIsClient();
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,42fr)_minmax(0,58fr)]">
      <BrandPanel />
      <section className="flex items-center justify-center px-6 py-12">{isClient ? <LoginForm /> : <div className="h-[28rem] w-full max-w-sm" />}</section>
    </div>
  );
}
