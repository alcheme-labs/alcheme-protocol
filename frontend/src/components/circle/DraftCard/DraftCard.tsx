'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, Clock3, Flame, Gem, Snowflake, Users, MessageSquare } from 'lucide-react';
import { HeatGauge, useColorTemperature } from '@/alchemy';
import { Card } from '@/components/ui/Card';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import {
    clampHeatScore,
    resolveHeatState,
    resolveHeatTemperature,
} from '@/lib/heat/semantics';
import {
    buildWorkspaceDraftPresentation,
    type WorkspaceDraftLifecycleStatus,
} from '@/lib/circle/workspaceDraftOrder';
import { timeAgo } from '@/lib/circle/utils';
import styles from './DraftCard.module.css';

/* ═══ Types ═══ */

export interface DraftData {
    id: number;
    title: string;
    heat: number;
    editors: number;
    comments: number;
    lifecycleStatus?: WorkspaceDraftLifecycleStatus;
    publicBlockerCode?: string | null;
    lastActivityAt?: string | null;
}

interface DraftCardProps {
    draft: DraftData;
    index: number;
    onClick?: () => void;
}

/* ═══ Component ═══ */

export default function DraftCard({ draft, index, onClick }: DraftCardProps) {
    const t = useI18n('DraftCard');
    const locale = useCurrentLocale();
    const heat = clampHeatScore(Number(draft.heat ?? 0));
    const heatState = resolveHeatState(heat);
    const isCrystallized = draft.lifecycleStatus === 'crystallized';
    const presentation = buildWorkspaceDraftPresentation({
        documentStatus: draft.lifecycleStatus,
        publicBlockerCode: draft.publicBlockerCode,
    });
    const statusClass = presentation.state === 'blocked'
        ? styles.statusBlocked
        : presentation.state === 'complete'
            ? styles.statusComplete
            : styles.statusActive;
    const visualHeatState = isCrystallized ? 'frozen' : heatState;
    const temperature = resolveHeatTemperature(heat);

    const { style: tempStyle } = useColorTemperature({
        heatLevel: temperature,
        activeTab: 'crucible',
    });

    const heatIcon = isCrystallized
        ? <Gem size={12} className={styles.frozenIcon} />
        : heatState === 'frozen'
        ? <Snowflake size={12} className={styles.frozenIcon} />
        : <Flame size={12} className={styles.flameIcon} />;

    const heatLabel = isCrystallized
        ? t('lifecycle.crystallized')
        : t(`heat.${heatState}`);

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.06 }}
            onClick={onClick}
            style={{ cursor: 'pointer' }}
            className={styles.wrapper}
        >
            <Card
                state="alloy"
                heatState={visualHeatState}
                footer={
                    <div className={styles.footer} style={tempStyle as React.CSSProperties}>
                        {/* Heat gauge */}
                        <div className={styles.gaugeWrap}>
                            <HeatGauge score={heat} />
                        </div>

                        {/* Heat label */}
                        <div className={styles.heatInfo}>
                            {heatIcon}
                            <span className={`${styles.heatLabel} ${styles[visualHeatState]}`}>
                                {heatLabel}
                            </span>
                            <span className={`${styles.heatTemp} ${styles[visualHeatState]}`}>
                                {Math.round(heat)}°
                            </span>
                        </div>
                    </div>
                }
            >
                <h3 className={styles.title}>{draft.title}</h3>
                <div className={styles.statusRow}>
                    <span className={`${styles.statusBadge} ${statusClass}`}>
                        {t(`lifecycle.${presentation.lifecycleKey}`)}
                    </span>
                    {draft.lastActivityAt && !presentation.blockerKey && (
                        <span className={styles.activityLabel}>
                            <Clock3 size={12} aria-hidden="true" />
                            {t('activity.updated', {time: timeAgo(draft.lastActivityAt, locale)})}
                        </span>
                    )}
                </div>
                {presentation.blockerKey && (
                    <p className={styles.blocker} role="status">
                        <AlertTriangle size={14} aria-hidden="true" />
                        <span>{t(`blocker.${presentation.blockerKey}`)}</span>
                    </p>
                )}
                <div className={styles.meta}>
                    <span className={styles.metaItem}>
                        <Users size={11} />
                        {t('meta.editors', {count: draft.editors})}
                    </span>
                    <span className={styles.metaDot}>·</span>
                    <span className={styles.metaItem}>
                        <MessageSquare size={11} />
                        {t('meta.comments', {count: draft.comments})}
                    </span>
                </div>

                {/* Frost overlay for frozen state */}
                {visualHeatState === 'frozen' && (
                    <div className={styles.frostOverlay} />
                )}
            </Card>
        </motion.div>
    );
}
