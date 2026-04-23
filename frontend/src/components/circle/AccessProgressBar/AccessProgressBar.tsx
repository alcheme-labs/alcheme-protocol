'use client';

import { useI18n } from '@/i18n/useI18n';
import styles from './AccessProgressBar.module.css';

/* ═══ Types ═══ */

interface AccessProgressBarProps {
    /** Current user's crystal count in this circle */
    currentCrystals: number;
    /** Next tier requirement (0 = already at highest) */
    nextTierCrystals: number;
    /** Next tier name */
    nextTierName: string;
}

/* ═══ Component ═══ */

/**
 * Shows progress toward the next circle tier and keeps the remaining gap obvious.
 */
export default function AccessProgressBar({
    currentCrystals,
    nextTierCrystals,
    nextTierName,
}: AccessProgressBarProps) {
    const t = useI18n('AccessProgressBar');
    if (nextTierCrystals <= 0) {
        return (
            <div className={styles.bar}>
                <div className={styles.info}>
                    <span className={styles.label}>👑 {t('states.topTier')}</span>
                </div>
                <div className={styles.track}>
                    <div className={`${styles.fill} ${styles.complete}`} style={{ width: '100%' }} />
                </div>
            </div>
        );
    }

    const pct = Math.min(100, Math.round((currentCrystals / nextTierCrystals) * 100));
    const remaining = nextTierCrystals - currentCrystals;

    return (
        <div className={styles.bar}>
            <div className={styles.info}>
                <span className={styles.label}>
                    💎 {t('progress.crystals', {currentCrystals, nextTierCrystals})}
                </span>
                <span className={styles.hint}>
                    {t('progress.remaining', {remaining, nextTierName})}
                </span>
            </div>
            <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}
