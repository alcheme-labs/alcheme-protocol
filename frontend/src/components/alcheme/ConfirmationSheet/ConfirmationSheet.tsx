'use client';

import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { BottomSheet } from '../BottomSheet';
import styles from './ConfirmationSheet.module.css';

export type ConfirmationSheetTone = 'default' | 'danger';

export interface ConfirmationSheetProps {
    open: boolean;
    title: string;
    description: ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    closeLabel: string;
    tone?: ConfirmationSheetTone;
    confirmDisabled?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
}

export default function ConfirmationSheet({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    closeLabel,
    tone = 'default',
    confirmDisabled = false,
    onConfirm,
    onCancel,
}: ConfirmationSheetProps) {
    return (
        <BottomSheet open={open} title={title} closeLabel={closeLabel} onClose={onCancel}>
            <div className={styles.content}>
                <span className={joinClassNames(styles.icon, tone === 'danger' && styles.iconDanger)} aria-hidden="true">
                    <AlertTriangle size={18} />
                </span>
                <p className={styles.description}>{description}</p>
            </div>
            <div className={styles.actions}>
                <button type="button" className={styles.cancelButton} onClick={onCancel}>
                    {cancelLabel}
                </button>
                <button
                    type="button"
                    className={joinClassNames(styles.confirmButton, tone === 'danger' && styles.confirmButtonDanger)}
                    disabled={confirmDisabled}
                    onClick={onConfirm}
                >
                    {confirmLabel}
                </button>
            </div>
        </BottomSheet>
    );
}
