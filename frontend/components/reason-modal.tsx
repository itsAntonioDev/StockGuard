'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Field, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';

interface ReasonModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  minLength?: number;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/** Ações sensíveis (cancelar, rejeitar, descartar) sempre exigem justificativa registrada. */
export function ReasonModal({ open, title, description, confirmLabel, tone = 'danger', minLength = 5, pending, error, onClose, onConfirm }: ReasonModalProps) {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= minLength;

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant={tone} loading={pending} disabled={!valid} onClick={() => onConfirm(reason.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Justificativa" required hint={`Mínimo de ${minLength} caracteres. Fica registrada na auditoria.`}>
          {(id) => <Textarea id={id} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} autoFocus />}
        </Field>
        {Boolean(error) && <ErrorMessage error={error} />}
      </div>
    </Modal>
  );
}
