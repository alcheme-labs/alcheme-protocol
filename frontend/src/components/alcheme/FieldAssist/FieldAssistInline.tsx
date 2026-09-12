'use client';

import { Check, Sparkles, X } from 'lucide-react';

import styles from './FieldAssistInline.module.css';

export interface FieldAssistInlineProps {
  status: 'idle' | 'loading' | 'ready' | 'disabled' | 'error';
  requestLabel: string;
  loadingLabel: string;
  acceptLabel: string;
  ignoreLabel: string;
  suggestion?: string | null;
  reason?: string | null;
  errorMessage?: string | null;
  disabledReason?: string | null;
  disabled?: boolean;
  onRequest: () => void;
  onAccept: () => void;
  onIgnore: () => void;
}

export default function FieldAssistInline({
  status,
  requestLabel,
  loadingLabel,
  acceptLabel,
  ignoreLabel,
  suggestion = null,
  reason = null,
  errorMessage = null,
  disabledReason = null,
  disabled = false,
  onRequest,
  onAccept,
  onIgnore,
}: FieldAssistInlineProps) {
  const hasSuggestion = status === 'ready' && Boolean(suggestion);
  return (
    <div className={styles.assist} role="status" aria-live="polite">
      <button
        type="button"
        className={styles.requestButton}
        onClick={onRequest}
        disabled={disabled || status === 'loading' || status === 'disabled'}
      >
        <Sparkles size={13} />
        <span>{status === 'loading' ? loadingLabel : requestLabel}</span>
      </button>

      {status === 'disabled' ? (
        <span className={styles.message}>{disabledReason}</span>
      ) : null}
      {status === 'error' ? (
        <span className={styles.error}>{errorMessage}</span>
      ) : null}

      {hasSuggestion ? (
        <div className={styles.suggestion}>
          <div className={styles.suggestionText}>{suggestion}</div>
          {reason ? <div className={styles.reason}>{reason}</div> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.acceptButton} onClick={onAccept}>
              <Check size={13} />
              <span>{acceptLabel}</span>
            </button>
            <button type="button" className={styles.ignoreButton} onClick={onIgnore}>
              <X size={13} />
              <span>{ignoreLabel}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
