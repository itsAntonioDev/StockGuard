'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { stepRoute } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Notice, Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input } from '@/components/ui/form';
import { ME_QUERY_KEY, useMe } from '@/hooks/use-session';
import { authService } from '@/services';

export default function ChangePasswordPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me, error } = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (error) router.replace('/login');
    if (me?.pendingStep === 'MFA_SETUP' || me?.pendingStep === 'MFA_VERIFY') router.replace(stepRoute(me.pendingStep));
  }, [me, error, router]);

  const change = useMutation({
    mutationFn: () => authService.changePassword(current, next),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setConfirmation('');
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.replace('/');
    },
  });

  const mismatch = confirmation.length > 0 && confirmation !== next;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!mismatch) change.mutate();
  }

  if (!me) return <Spinner />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-lg border border-neutral-200 bg-white p-8">
        <KeyRound className="size-8" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold">{me.pendingStep === 'CHANGE_PASSWORD' ? 'Defina uma nova senha' : 'Trocar senha'}</h1>
          <p className="mt-1 text-sm text-neutral-500">Ao trocar a senha, as outras sessões abertas são encerradas.</p>
        </div>
        <Notice tone="info">
          Use pelo menos 12 caracteres combinando 3 destes: minúsculas, maiúsculas, números e símbolos. Não use seu nome ou e-mail.
        </Notice>
        <Field label="Senha atual" required>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />}
        </Field>
        <Field label="Nova senha" required>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />}
        </Field>
        <Field label="Confirme a nova senha" required error={mismatch ? 'As senhas não conferem.' : null}>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" value={confirmation} aria-invalid={mismatch} onChange={(event) => setConfirmation(event.target.value)} />
          )}
        </Field>
        {change.error && <ErrorMessage error={change.error} />}
        <Button type="submit" className="w-full" loading={change.isPending} disabled={!current || !next || next !== confirmation}>
          Salvar nova senha
        </Button>
        {!me.pendingStep && (
          <button type="button" onClick={() => router.back()} className="w-full text-center text-xs text-neutral-500 hover:text-neutral-900">
            Voltar
          </button>
        )}
      </form>
    </div>
  );
}
