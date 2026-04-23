'use client';

import { ExternalLink, RefreshCw, Sparkles } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import type { ExtensionCardModel } from '@/lib/extensions/types';
import ExtensionCapabilityNotice from './ExtensionCapabilityNotice';
import styles from './ExtensionCapabilitySection.module.css';

export default function ExtensionCapabilityCard({
    model,
    onRetry,
}: {
    model: ExtensionCardModel;
    onRetry: () => void;
}) {
    return (
        <Card state="ore" className={styles.card} data-testid={`extension-card-${model.extensionId}`}>
            <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                    <Sparkles size={16} className={styles.cardIcon} />
                    <h3 className={styles.cardTitle}>{model.title}</h3>
                </div>
                <span className={styles.badge} data-state={model.state}>{model.badge}</span>
            </div>
            <p className={styles.cardDescription}>{model.description}</p>
            <ExtensionCapabilityNotice message={model.message} />
            <p className={styles.cardMeta}>{model.meta}</p>
            <div className={styles.cardActions}>
                {model.cta.enabled && model.cta.href ? (
                    <a
                        className={styles.primaryAction}
                        href={model.cta.href}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {model.cta.label}
                        <ExternalLink size={14} />
                    </a>
                ) : (
                    <button className={styles.secondaryAction} type="button" disabled>
                        {model.cta.label}
                    </button>
                )}
                {model.showRetry && (
                    <button className={styles.retryAction} type="button" onClick={onRetry}>
                        <RefreshCw size={14} />
                        重新获取
                    </button>
                )}
            </div>
        </Card>
    );
}
