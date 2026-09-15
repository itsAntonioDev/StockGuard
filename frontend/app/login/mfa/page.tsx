'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { stepRoute } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/display';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Input } from '@/components/ui/form';
import { ME_QUERY_KEY, useMe } from '@/hooks/use-session';
import { authService } from '@/services';

export default function MfaPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me, error } = useMe();
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);

  useEffect(() => {
    if (error) router.replace('/login');
    if (me && me.pendingStep !== 'MFA_SETUP' && me.pendingStep !== 'MFA_VERIFY') {
      router.replace(me.pendingStep ? stepRoute(me.pendingStep) : '/');
    }
  }, [me, error, router]);

  const start = useMutation({
    mutationFn: authService.startMfaSetup,
    onSuccess: async ({ secret, otpauthUri }) => {
      // QR gerado localmente: a semente nunca é enviada a serviços de terceiros.
      const qr = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 });
      setSetup({ secret, qr });
    },
  });

  const finish = useMutation({
    mutationFn: () => (me?.pendingStep === 'MFA_SETUP' ? authService.confirmMfaSetup(code) : authService.verifyMfa(code)),
    onSuccess: async () => {
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      const updated = await queryClient.fetchQuery({ queryKey: ME_QUERY_KEY, queryFn: authService.me });
      router.replace(updated.pendingStep ? stepRoute(updated.pendingStep) : '/');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    finish.mutate();
  }

  if (!me) return <Spinner />;
  const isSetup = me.pendingStep === 'MFA_SETUP';

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8">
        <ShieldCheck className="size-8" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">{isSetup ? 'Configure a verificação em duas etapas' : 'Verificação em duas etapas'}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {isSetup
            ? 'Seu perfil exige MFA. Use um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy).'
            : 'Digite o código de 6 dígitos exibido no seu aplicativo autenticador.'}
        </p>

        {isSetup && !setup && (
          <div className="mt-6 space-y-3">
            {start.error && <ErrorMessage error={start.error} />}
            <Button className="w-full" onClick={() => start.mutate()} loading={start.isPending}>
              Gerar QR code
            </Button>
          </div>
        )}

        {isSetup && setup && (
          <div className="mt-6 flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- imagem data: gerada localmente */}
            <img src={setup.qr} alt="QR code para o aplicativo autenticador" width={220} height={220} className="rounded-md border border-neutral-200" />
            <p className="text-center text-xs text-neutral-500">
              Sem câmera? Digite a chave manualmente:
              <span className="mt-1 block select-all break-all font-mono text-sm text-neutral-900">{setup.secret}</span>
            </p>
          </div>
        )}

        {(!isSetup || setup) && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Código de 6 dígitos" required>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  autoFocus
                />
              )}
            </Field>
            {finish.error && <ErrorMessage error={finish.error} />}
            <Button type="submit" className="w-full" loading={finish.isPending} disabled={code.length !== 6}>
              {isSetup ? 'Ativar MFA' : 'Verificar'}
            </Button>
          </form>
        )}

        <button
          type="button"
          onClick={async () => {
            await authService.logout().catch(() => undefined);
            queryClient.clear();
            router.replace('/login');
          }}
          className="mt-6 w-full text-center text-xs text-neutral-500 hover:text-neutral-900"
        >
          Sair e entrar com outra conta
        </button>
      </div>
    </div>
  );
}
