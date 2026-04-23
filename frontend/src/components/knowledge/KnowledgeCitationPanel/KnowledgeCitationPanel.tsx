'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import { GET_MY_KNOWLEDGE } from '@/lib/apollo/queries';
import type { MyKnowledgeItem, MyKnowledgeResponse } from '@/lib/apollo/types';
import { useAlchemeSDK } from '@/hooks/useAlchemeSDK';
import { clampHeatScore, resolveHeatState } from '@/lib/heat/semantics';
import { submitKnowledgeCitation } from '@/lib/contribution-engine/referenceClient';
import { useI18n } from '@/i18n/useI18n';
import styles from './KnowledgeCitationPanel.module.css';

interface KnowledgeCitationPanelProps {
    targetKnowledgeId: string;
    targetOnChainAddress: string;
    targetTitle: string;
    actionRequested?: boolean;
}

function sortCitationSources(items: MyKnowledgeItem[]): MyKnowledgeItem[] {
    return [...items].sort((left, right) => {
        const heatGap = right.stats.heatScore - left.stats.heatScore;
        if (heatGap !== 0) return heatGap;
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
}

function filterCitationSources(items: MyKnowledgeItem[], target: { knowledgeId: string; onChainAddress: string }): MyKnowledgeItem[] {
    return items.filter((item) => (
        item.knowledgeId !== target.knowledgeId
        && item.onChainAddress !== target.onChainAddress
    ));
}

export default function KnowledgeCitationPanel({
    targetKnowledgeId,
    targetOnChainAddress,
    targetTitle,
    actionRequested = false,
}: KnowledgeCitationPanelProps) {
    const t = useI18n('KnowledgeCitationPanel');
    const sdk = useAlchemeSDK();
    const { connected } = useWallet();
    const { setVisible: setWalletModalVisible } = useWalletModal();
    const panelRef = useRef<HTMLElement | null>(null);
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');

    const { data, loading, error } = useQuery<MyKnowledgeResponse>(GET_MY_KNOWLEDGE, {
        variables: { limit: 50, offset: 0 },
        fetchPolicy: 'cache-and-network',
    });

    const availableSources = useMemo(
        () => sortCitationSources(filterCitationSources(data?.myKnowledge ?? [], {
            knowledgeId: targetKnowledgeId,
            onChainAddress: targetOnChainAddress,
        })),
        [data?.myKnowledge, targetKnowledgeId, targetOnChainAddress],
    );

    useEffect(() => {
        if (!selectedSourceId && availableSources.length > 0) {
            setSelectedSourceId(availableSources[0].knowledgeId);
        }
    }, [availableSources, selectedSourceId]);

    useEffect(() => {
        if (!actionRequested) return;
        panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [actionRequested]);

    const handleSubmit = useCallback(async () => {
        if (!selectedSourceId || submitting) return;

        const selectedSource = availableSources.find((item) => item.knowledgeId === selectedSourceId);
        if (!selectedSource) {
            setStatusTone('error');
            setStatusMessage(t('errors.sourceNotFound'));
            return;
        }

        if (!connected) {
            setWalletModalVisible(true);
            return;
        }

        if (!sdk?.contributionEngine) {
            setStatusTone('error');
            setStatusMessage(t('errors.engineUnavailable'));
            return;
        }

        setSubmitting(true);
        setStatusTone('neutral');
        setStatusMessage(null);

        try {
            const signature = await submitKnowledgeCitation({
                sdk,
                sourceOnChainAddress: selectedSource.onChainAddress,
                targetOnChainAddress,
            });
            setStatusTone('success');
            setStatusMessage(t('status.submitted', {signature: signature.slice(0, 8)}));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '');
            if (message.toLowerCase().includes('wallet not connected') || message.toLowerCase().includes('not connected')) {
                setWalletModalVisible(true);
                return;
            }
            setStatusTone('error');
            setStatusMessage(t('errors.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    }, [availableSources, connected, sdk, selectedSourceId, setWalletModalVisible, submitting, t, targetOnChainAddress]);

    return (
        <section ref={panelRef} className={styles.panel} aria-labelledby="knowledge-citation-title">
            <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Crystal Citation</span>
                <h2 id="knowledge-citation-title" className={styles.title}>{t('title')}</h2>
                <p className={styles.lead}>{t('lead')}</p>
            </div>

            <div className={styles.targetCard}>
                <div className={styles.targetLabel}>{t('target.label')}</div>
                <div className={styles.targetTitle}>{targetTitle}</div>
                <div className={styles.targetMeta}>target: {targetKnowledgeId}</div>
            </div>

            {loading && (
                <div className={styles.statusCard}>
                    <strong>{t('states.loading.title')}</strong>
                    <span>{t('states.loading.description')}</span>
                </div>
            )}

            {!loading && error && (
                <div className={`${styles.statusCard} ${styles.statusError}`}>
                    <strong>{t('states.error.title')}</strong>
                    <span>{t('states.error.description')}</span>
                </div>
            )}

            {!loading && !error && availableSources.length === 0 && (
                <div className={styles.statusCard}>
                    <strong>{t('states.empty.title')}</strong>
                    <span>{t('states.empty.description')}</span>
                </div>
            )}

            {!loading && availableSources.length > 0 && (
                <div className={styles.sourceList} role="list" aria-label={t('sourceList.ariaLabel')}>
                    {availableSources.map((item) => {
                        const selected = item.knowledgeId === selectedSourceId;
                        const heatScore = clampHeatScore(Number(item.stats.heatScore ?? 0));
                        const heatLabel = t(`heat.${resolveHeatState(heatScore)}`);
                        return (
                            <button
                                key={item.knowledgeId}
                                type="button"
                                className={`${styles.sourceCard} ${selected ? styles.sourceCardSelected : ''}`}
                                onClick={() => setSelectedSourceId(item.knowledgeId)}
                            >
                                <div className={styles.sourceTitle}>{item.title}</div>
                                <div className={styles.sourceMeta}>
                                    <span>{item.circle?.name ?? t('sourceList.unassignedCircle')}</span>
                                    <span>·</span>
                                    <span>{t('sourceList.heat', {label: heatLabel, score: Math.round(heatScore)})}</span>
                                    <span>·</span>
                                    <span>{t('sourceList.citations', {count: item.stats.citationCount})}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <div className={styles.footer}>
                <div className={`${styles.statusLine} ${styles[`status-${statusTone}`]}`}>
                    {statusMessage || (!connected ? t('footer.connectHint') : t('footer.defaultHint'))}
                </div>
                <div className={styles.actions}>
                    {!connected && (
                        <button
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() => setWalletModalVisible(true)}
                        >
                            {t('actions.connectWallet')}
                        </button>
                    )}
                    <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={handleSubmit}
                        disabled={!selectedSourceId || availableSources.length === 0 || submitting}
                    >
                        {submitting ? t('actions.submitting') : t('actions.submit')}
                    </button>
                </div>
            </div>
        </section>
    );
}
