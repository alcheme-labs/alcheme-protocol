'use client';

import { AlertTriangle } from 'lucide-react';

export interface RiskSignalBannerProps {
    title: string;
    riskLevel: 'info' | 'warning' | 'severe';
    sourceCategory: string;
    affectedCapabilities: string[];
    affectedRelease: string;
    appealStatus: string;
    signals: string[];
    actionLabel?: string;
    onAction?: () => void;
}

export function RiskSignalBanner({
    title,
    riskLevel,
    sourceCategory,
    affectedCapabilities,
    affectedRelease,
    appealStatus,
    signals,
    actionLabel,
    onAction,
}: RiskSignalBannerProps) {
    if (signals.length === 0) return null;
    return (
        <section
            role="status"
            style={{
                display: 'grid',
                gap: 8,
                padding: 12,
                border: '1px solid var(--color-border-warning, #f59e0b)',
                background: 'var(--color-warning-surface, #fffbeb)',
            }}
        >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <AlertTriangle size={16} aria-hidden="true" />
                <strong>{title}</strong>
                <span>{riskLevel}</span>
            </div>
            <p style={{ margin: 0 }}>
                {sourceCategory} · {affectedRelease} · {appealStatus}
            </p>
            <p style={{ margin: 0 }}>
                Affected capabilities: {affectedCapabilities.length ? affectedCapabilities.join(', ') : 'none'}
            </p>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {signals.map((signal) => (
                    <li key={signal}>{signal}</li>
                ))}
            </ul>
            <p style={{ margin: 0 }}>
                Data already shared with a third-party app cannot be technically recalled.
            </p>
            {actionLabel && onAction ? (
                <button type="button" onClick={onAction}>
                    {actionLabel}
                </button>
            ) : null}
        </section>
    );
}
