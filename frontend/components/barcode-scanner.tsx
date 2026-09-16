'use client';

import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/display';
import { Modal } from '@/components/ui/modal';

/**
 * Leitura de código de barras pela câmera do aparelho.
 * O vídeo é processado no próprio navegador (biblioteca local, sem enviar imagem
 * para lugar nenhum) e a câmera é desligada ao fechar. Leitores tipo "pistola"
 * continuam funcionando normalmente digitando no campo.
 */
function ScannerModal({ open, onClose, onDetected }: { open: boolean; onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const video = videoRef.current;

    if (!video || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setError('Este navegador não permite usar a câmera. Use um leitor de código de barras ou digite o código.');
      return;
    }

    new BrowserMultiFormatReader()
      .decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video, (result, _error, controls) => {
        if (!result) return;
        controls.stop();
        if (!cancelled) onDetected(result.getText().trim());
      })
      .then((controls) => {
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const name = cause instanceof Error ? cause.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Permissão de câmera negada. Libere o acesso à câmera nas configurações do navegador.'
            : name === 'NotFoundError'
              ? 'Nenhuma câmera encontrada neste aparelho.'
              : 'Não foi possível abrir a câmera. Digite o código manualmente.',
        );
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDetected]);

  return (
    <Modal open={open} title="Ler código de barras" description="Aponte a câmera para o código. A leitura é automática." onClose={onClose}>
      <div className="space-y-3">
        {error ? (
          <Notice tone="warning">{error}</Notice>
        ) : (
          <>
            <video ref={videoRef} className="aspect-video w-full rounded-md bg-neutral-900 object-cover" muted playsInline />
            <p className="text-xs text-neutral-500">Mantenha o código dentro do quadro, com boa iluminação.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Botão que abre a câmera e devolve o código lido. */
export function BarcodeScannerButton({
  onDetected,
  label = 'Escanear',
  size = 'md',
  variant = 'secondary',
  className,
}: {
  onDetected: (code: string) => void;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} icon={<Camera className="size-4" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <ScannerModal
          open
          onClose={() => setOpen(false)}
          onDetected={(code) => {
            setOpen(false);
            onDetected(code);
          }}
        />
      )}
    </>
  );
}
