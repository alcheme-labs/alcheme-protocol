'use client';

import { ShieldCheck } from 'lucide-react';

import { BottomSheet } from '@/components/alcheme/BottomSheet';

export interface UserConsentSheetProps {
    open: boolean;
    appName: string;
    releaseLabel: string;
    circleLabel: string;
    capabilityLabel: string;
    dataCategories: string[];
    expiresAt?: string | null;
    receiptDigest?: string | null;
    allowLabel?: string;
    denyLabel?: string;
    revokeLabel?: string;
    closeLabel?: string;
    onAllow: () => void;
    onDeny: () => void;
    onRevoke: () => void;
    onClose: () => void;
}

export function UserConsentSheet({
    open,
    appName,
    releaseLabel,
    circleLabel,
    capabilityLabel,
    dataCategories,
    expiresAt,
    receiptDigest,
    allowLabel = 'Allow',
    denyLabel = 'Deny',
    revokeLabel = 'Revoke',
    closeLabel = 'Close',
    onAllow,
    onDeny,
    onRevoke,
    onClose,
}: UserConsentSheetProps) {
    return (
        <BottomSheet open={open} title="Hosted App Access" closeLabel={closeLabel} onClose={onClose}>
            <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ lineHeight: 0, paddingTop: 2 }}>
                        <ShieldCheck size={18} />
                    </span>
                    <div style={{ display: 'grid', gap: 6 }}>
                        <p style={{ margin: 0, fontWeight: 600 }}>{appName}</p>
                        <p style={{ margin: 0 }}>{capabilityLabel}</p>
                        <p style={{ margin: 0, color: 'var(--color-text-muted, #64748b)' }}>
                            {circleLabel} · {releaseLabel}
                        </p>
                    </div>
                </div>
                <section aria-label="Data requested" style={{ display: 'grid', gap: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 14 }}>Data requested</h3>
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        {dataCategories.map((category) => (
                            <li key={category}>{category}</li>
                        ))}
                    </ul>
                </section>
                <p style={{ margin: 0 }}>
                    {expiresAt ? `Access expires ${expiresAt}.` : 'Access remains active until revoked.'}
                </p>
                {receiptDigest ? (
                    <p style={{ margin: 0, wordBreak: 'break-word' }}>Receipt {receiptDigest}</p>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" onClick={onDeny}>
                        {denyLabel}
                    </button>
                    <button type="button" onClick={onRevoke}>
                        {revokeLabel}
                    </button>
                    <button type="button" onClick={onAllow}>
                        {allowLabel}
                    </button>
                </div>
            </div>
        </BottomSheet>
    );
}
