'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronDown, Clock3, ExternalLink, Radio } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { AccessPanelViewModel } from '@/lib/circle/accessPanelViewModel';
import { buildCircleExternalAppHref } from '@/lib/external-program/navigation';
import styles from './CircleRoomsPanel.module.css';

interface CircleRoomsPanelProps {
    viewModel: AccessPanelViewModel;
    bindingCircleId: number;
    returnCircleId: number;
    loading?: boolean;
    error?: string | null;
    actionPendingMaterialId?: number | null;
    onAcceptMaterial?: (materialId: number) => void;
    selectedDraftSourceMaterialIds?: Set<number>;
    draftCreationBusy?: boolean;
    onToggleDraftSourceMaterial?: (materialId: number) => void;
    onCreateDraftFromMaterials?: () => void;
    presentation?: 'accordion' | 'content';
}

export default function CircleRoomsPanel({
    viewModel,
    bindingCircleId,
    returnCircleId,
    loading = false,
    error = null,
    actionPendingMaterialId = null,
    onAcceptMaterial,
    selectedDraftSourceMaterialIds = new Set<number>(),
    draftCreationBusy = false,
    onToggleDraftSourceMaterial,
    onCreateDraftFromMaterials,
    presentation = 'accordion',
}: CircleRoomsPanelProps) {
    const t = useI18n('CircleRoomsPanel');
    const [open, setOpen] = useState(true);
    const contentOnly = presentation === 'content';

    return (
        <section className={`${styles.panel} ${contentOnly ? styles.panelContentOnly : ''}`} aria-label={t('aria.panel')}>
            {!contentOnly && (
                <button
                    type="button"
                    className={styles.header}
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                >
                    <span className={styles.titleRow}>
                        <Radio size={15} />
                        <span className={styles.title}>{t('title')}</span>
                        <span className={styles.meta}>{t('meta.externalPrograms', { count: viewModel.externalAppCount })}</span>
                    </span>
                    <ChevronDown size={16} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
                </button>
            )}
            {(contentOnly || open) && (
                <div className={styles.body}>
                    {error && <div className={styles.error}>{error}</div>}
                    <div className={styles.grid}>
                        <div className={styles.group}>
                            <div className={styles.groupHeader}>
                                <span className={styles.groupTitle}>
                                    <ExternalLink size={14} />
                                    {t('connected.title')}
                                </span>
                                <span className={styles.badge}>{loading ? t('badges.syncing') : viewModel.connectedApps.length}</span>
                            </div>
                            {viewModel.connectedApps.length > 0 ? (
                                <div className={styles.list}>
                                    {viewModel.connectedApps.map((app) => (
                                        <div className={styles.item} key={app.id}>
                                            <Link
                                                className={styles.itemTitle}
                                                href={buildCircleExternalAppHref({
                                                    appId: app.appId,
                                                    bindingCircleId,
                                                    returnCircleId,
                                                })}
                                            >
                                                {app.title}
                                            </Link>
                                            <span className={styles.itemMeta}>{app.meta}</span>
                                            <span className={styles.itemBadge}>{app.statusLabel}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.empty}>{loading ? t('loading') : t('connected.empty')}</div>
                            )}
                        </div>

                        {viewModel.pendingApps.length > 0 ? (
                            <div className={styles.group}>
                                <div className={styles.groupHeader}>
                                    <span className={styles.groupTitle}>
                                        <Clock3 size={14} />
                                        {t('pendingConnections.title')}
                                    </span>
                                    <span className={styles.badge}>{viewModel.pendingApps.length}</span>
                                </div>
                                <div className={styles.list}>
                                    {viewModel.pendingApps.map((app) => (
                                        <div className={styles.item} key={app.id}>
                                            <Link
                                                className={styles.itemTitle}
                                                href={buildCircleExternalAppHref({
                                                    appId: app.appId,
                                                    bindingCircleId,
                                                    returnCircleId,
                                                })}
                                            >
                                                {app.title}
                                            </Link>
                                            <span className={styles.itemMeta}>{app.meta}</span>
                                            <span className={styles.itemBadge}>{app.statusLabel}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        <div className={styles.group}>
                            <div className={styles.groupHeader}>
                                <span className={styles.groupTitle}>
                                    <Clock3 size={14} />
                                    {t('pending.title')}
                                </span>
                                <span className={styles.badge}>{viewModel.pendingMaterials.length}</span>
                            </div>
                            {viewModel.pendingMaterials.length > 0 ? (
                                <div className={styles.list}>
                                    {viewModel.pendingMaterials.map((material) => {
                                        const actionPending = actionPendingMaterialId === material.id;
                                        return (
                                            <div className={styles.item} key={material.id}>
                                                <span className={styles.itemTitle}>{material.title}</span>
                                                <span className={styles.itemMeta}>{material.meta}</span>
                                                <span className={styles.itemMeta}>{material.authorityLabel}</span>
                                                <button
                                                    type="button"
                                                    className={styles.linkButton}
                                                    disabled={material.actionDisabled || actionPending || !onAcceptMaterial}
                                                    onClick={() => onAcceptMaterial?.(material.id)}
                                                >
                                                    {actionPending ? t('pending.actions.saving') : material.actionLabel}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className={styles.empty}>{loading ? t('loading') : t('pending.empty')}</div>
                            )}
                        </div>

                        <div className={styles.group}>
                            <div className={styles.groupHeader}>
                                <span className={styles.groupTitle}>
                                    <BookOpen size={14} />
                                    {t('accepted.title')}
                                </span>
                                <span className={styles.badge}>{viewModel.acceptedMaterials.length}</span>
                            </div>
                            {viewModel.acceptedMaterials.length > 0 ? (
                                <div className={styles.list}>
                                    {viewModel.acceptedMaterials.map((material) => (
                                        <div className={styles.item} key={material.id}>
                                            <div className={styles.acceptedTitleRow}>
                                                {material.selectableForDraft ? (
                                                    <input
                                                        type="checkbox"
                                                        aria-label={t('accepted.actions.selectForDraft', { title: material.title })}
                                                        checked={selectedDraftSourceMaterialIds.has(material.id)}
                                                        disabled={draftCreationBusy || !onToggleDraftSourceMaterial}
                                                        onChange={() => onToggleDraftSourceMaterial?.(material.id)}
                                                    />
                                                ) : null}
                                                <span className={styles.itemTitle}>{material.title}</span>
                                            </div>
                                            <span className={styles.itemMeta}>{material.meta}</span>
                                            {material.contributorLabel ? (
                                                <span className={styles.contributor}>{material.contributorLabel}</span>
                                            ) : null}
                                            {material.summary ? (
                                                <span className={styles.summary}>{material.summary}</span>
                                            ) : null}
                                            <span className={styles.acceptedStatus} role="status">
                                                {material.statusLabel}
                                            </span>
                                        </div>
                                    ))}
                                    {viewModel.acceptedMaterials.some((material) => material.selectableForDraft) ? (
                                        <button
                                            type="button"
                                            className={styles.linkButton}
                                            disabled={draftCreationBusy || selectedDraftSourceMaterialIds.size === 0 || !onCreateDraftFromMaterials}
                                            onClick={() => onCreateDraftFromMaterials?.()}
                                        >
                                            {draftCreationBusy
                                                ? t('accepted.actions.creatingDraft')
                                                : t('accepted.actions.createDraft', { count: selectedDraftSourceMaterialIds.size })}
                                        </button>
                                    ) : null}
                                </div>
                            ) : (
                                <div className={styles.empty}>{loading ? t('loading') : t('accepted.empty')}</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
