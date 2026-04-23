'use client';

import { useEffect, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import type {
    CircleAgentPolicy,
    CircleAgentReviewMode,
    CircleAgentRecord,
    CircleAgentTriggerScope,
} from '@/lib/circles/agents';
import styles from './AgentAdminPanel.module.css';

interface AgentAdminPanelProps {
    agents: CircleAgentRecord[];
    agentPolicy: CircleAgentPolicy | null;
    loading?: boolean;
    saving?: boolean;
    error?: string | null;
    currentUserRole: 'owner' | 'curator' | 'member';
    onSavePolicy?: (patch: {
        triggerScope: CircleAgentTriggerScope;
        costDiscountBps: number;
        reviewMode: CircleAgentReviewMode;
    }) => Promise<void> | void;
}

export default function AgentAdminPanel({
    agents,
    agentPolicy,
    loading = false,
    saving = false,
    error = null,
    currentUserRole,
    onSavePolicy,
}: AgentAdminPanelProps) {
    const t = useI18n('AgentAdminPanel');
    const [triggerScope, setTriggerScope] = useState<CircleAgentTriggerScope>('draft_only');
    const [costDiscountBps, setCostDiscountBps] = useState(0);
    const [reviewMode, setReviewMode] = useState<CircleAgentReviewMode>('owner_review');
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        setTriggerScope(agentPolicy?.triggerScope ?? 'draft_only');
        setCostDiscountBps(agentPolicy?.costDiscountBps ?? 0);
        setReviewMode(agentPolicy?.reviewMode ?? 'owner_review');
        setDirty(false);
    }, [agentPolicy]);

    const ownerOnly = currentUserRole !== 'owner';

    const handleSave = async () => {
        if (!onSavePolicy || saving || ownerOnly) return;
        await onSavePolicy({
            triggerScope,
            costDiscountBps,
            reviewMode,
        });
        setDirty(false);
    };

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>{t('title')}</h3>
                    <p className={styles.subtitle}>{t('subtitle')}</p>
                </div>
                {ownerOnly && (
                    <span className={styles.ownerOnlyBadge}>{t('ownerOnly')}</span>
                )}
            </div>

            <div className={styles.section}>
                <div className={styles.sectionLabel}>{t('sections.registeredAgents')}</div>
                {loading ? (
                    <p className={styles.helper}>{t('states.loading')}</p>
                ) : agents.length === 0 ? (
                    <p className={styles.helper}>{t('states.empty')}</p>
                ) : (
                    <div className={styles.agentList}>
                        {agents.map((agent) => (
                            <div key={agent.id} className={styles.agentCard}>
                                <div className={styles.agentHead}>
                                    <span className={styles.agentHandle}>@{agent.handle}</span>
                                    <span className={styles.agentStatus}>{agent.status}</span>
                                </div>
                                {agent.displayName && (
                                    <div className={styles.agentDisplay}>{agent.displayName}</div>
                                )}
                                {agent.description && (
                                    <p className={styles.agentDescription}>{agent.description}</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className={styles.section}>
                <div className={styles.sectionLabel}>{t('sections.policy')}</div>
                <div className={styles.formGrid}>
                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('fields.triggerScope.label')}</span>
                        <select
                            aria-label={t('fields.triggerScope.label')}
                            className={styles.select}
                            value={triggerScope}
                            onChange={(event) => {
                                setTriggerScope(event.target.value as CircleAgentTriggerScope);
                                setDirty(true);
                            }}
                            disabled={saving || ownerOnly}
                        >
                            <option value="disabled">{t('fields.triggerScope.options.disabled')}</option>
                            <option value="draft_only">{t('fields.triggerScope.options.draftOnly')}</option>
                            <option value="circle_wide">{t('fields.triggerScope.options.circleWide')}</option>
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('fields.costDiscount.label')}</span>
                        <input
                            aria-label={t('fields.costDiscount.aria')}
                            className={styles.input}
                            type="number"
                            min={0}
                            max={10000}
                            value={costDiscountBps}
                            onChange={(event) => {
                                setCostDiscountBps(Math.max(0, Math.min(10000, Number(event.target.value || 0))));
                                setDirty(true);
                            }}
                            disabled={saving || ownerOnly}
                        />
                    </label>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>{t('fields.reviewMode.label')}</span>
                        <select
                            aria-label={t('fields.reviewMode.aria')}
                            className={styles.select}
                            value={reviewMode}
                            onChange={(event) => {
                                setReviewMode(event.target.value as CircleAgentReviewMode);
                                setDirty(true);
                            }}
                            disabled={saving || ownerOnly}
                        >
                            <option value="owner_review">{t('fields.reviewMode.options.ownerReview')}</option>
                            <option value="admin_review">{t('fields.reviewMode.options.adminReview')}</option>
                            <option value="self_serve">{t('fields.reviewMode.options.selfServe')}</option>
                        </select>
                    </label>
                </div>

                <div className={styles.auditNote}>
                    {t('auditNote')}
                </div>

                {error && <div className={styles.error}>{error}</div>}

                <button
                    type="button"
                    className={styles.saveButton}
                    onClick={() => { void handleSave(); }}
                    disabled={!dirty || saving || ownerOnly}
                >
                    {saving ? t('actions.saving') : t('actions.save')}
                </button>
            </div>
        </div>
    );
}
