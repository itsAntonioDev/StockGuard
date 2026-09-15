import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-neutral-500">404</p>
      <h1 className="text-xl font-semibold text-neutral-900">Página não encontrada</h1>
      <LinkButton href="/" variant="secondary">
        Voltar ao início
      </LinkButton>
    </div>
  );
}
