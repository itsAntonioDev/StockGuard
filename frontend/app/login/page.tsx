'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Eye, EyeOff, Lock, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { stepRoute } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input } from '@/components/ui/form';
import { ME_QUERY_KEY } from '@/hooks/use-session';
import { authService } from '@/services';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const login = useMutation({
    mutationFn: () => authService.login(email, password),
    onSuccess: async ({ pendingStep }) => {
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.replace(pendingStep ? stepRoute(pendingStep) : '/');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-neutral-950 p-12 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <Shield className="size-9" aria-hidden />
            <span className="text-3xl font-semibold">StockGuard</span>
          </div>
          <p className="mt-2 text-sm text-neutral-400">Controle de estoque. Mais precisão. Mais resultados.</p>
        </div>
        <ul className="space-y-5 text-sm">
          {['Reduza divergências', 'Aumente a produtividade', 'Tenha total controle'].map((text) => (
            <li key={text} className="flex items-center gap-3">
              <CircleCheck className="size-6 text-neutral-300" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <p className="text-xs text-neutral-500">Operações rastreáveis de ponta a ponta.</p>
      </section>

      <section className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <Shield className="size-7" aria-hidden />
            <span className="text-xl font-semibold">StockGuard</span>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900">Bem-vindo de volta!</h1>
          <p className="mt-1 text-sm text-neutral-500">Faça login para acessar o sistema.</p>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <Field label="E-mail" required>
              {(id) => (
                <Input id={id} type="email" autoComplete="username" placeholder="Digite seu e-mail" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
              )}
            </Field>
            <Field label="Senha" required>
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
                    required
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

            {login.error && <ErrorMessage error={login.error} />}

            <Button type="submit" size="lg" className="w-full" loading={login.isPending} disabled={!email || !password}>
              Entrar
            </Button>
            <p className="text-center text-xs text-neutral-500">Esqueceu a senha? Solicite a redefinição ao administrador ou ao seu gestor.</p>
          </form>

          <div className="mt-10 flex items-start gap-3 rounded-md bg-neutral-50 p-3 text-xs text-neutral-600">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-medium text-neutral-800">Acesso seguro.</span> Tentativas repetidas bloqueiam a conta temporariamente e todos os acessos são auditados.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
