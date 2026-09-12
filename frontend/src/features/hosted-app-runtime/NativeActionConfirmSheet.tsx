'use client';

import { ShieldCheck } from 'lucide-react';

import { BottomSheet } from '@/components/alcheme/BottomSheet';
import {
    SignatureIntentReview,
    type SignatureIntentReviewProps,
} from './SignatureIntentReview';

export interface NativeActionConfirmSheetProps {
    open: boolean;
    actionId?: string;
    title: string;
    appName: string;
    actionLabel: string;
    description?: string;
    previewDigest?: string | null;
    payloadDigest?: string | null;
    signatureIntent?: SignatureIntentReviewProps | null;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function NativeActionConfirmSheet({
    open,
    actionId,
    title,
    appName,
    actionLabel,
    description,
    previewDigest,
    payloadDigest,
    signatureIntent,
    confirmLabel = 'Continue',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
}: NativeActionConfirmSheetProps) {
    return (
        <BottomSheet open={open} title={title} closeLabel={cancelLabel} onClose={onCancel}>
            <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ lineHeight: 0, paddingTop: 2 }}>
                        <ShieldCheck size={18} />
                    </span>
                    <div style={{ display: 'grid', gap: 6 }}>
                        <p style={{ margin: 0, fontWeight: 600 }}>{appName}</p>
                        <p style={{ margin: 0 }}>{actionLabel}</p>
                        {description ? (
                            <p style={{ margin: 0, color: 'var(--color-text-muted, #64748b)' }}>
                                {description}
                            </p>
                        ) : null}
                        {previewDigest ? (
                            <p style={{ margin: 0, wordBreak: 'break-word' }}>Preview {previewDigest}</p>
                        ) : null}
                        {payloadDigest ? (
                            <p style={{ margin: 0, wordBreak: 'break-word' }}>Payload {payloadDigest}</p>
                        ) : null}
                        {actionId === 'request_signature_intent' && signatureIntent ? (
                            <SignatureIntentReview {...signatureIntent} />
                        ) : null}
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={onCancel}>
                        {cancelLabel}
                    </button>
                    <button type="button" onClick={onConfirm}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </BottomSheet>
    );
}
