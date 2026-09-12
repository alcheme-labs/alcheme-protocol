'use client';

import styles from './HeatGauge.module.css';
import { useI18n } from '@/i18n/useI18n';
import {
    clampHeatScore,
    resolveHeatState,
} from '@/lib/heat/semantics';

interface HeatGaugeProps {
    /** Heat score (0-100+) */
    score?: number;
    /** Whether to show the numeric temperature */
    showTemp?: boolean;
}

/**
 * Heat gauge indicator.
 * Shows current heat state with a subtle bar and optional numeric display.
 */
export default function HeatGauge({ score = 0, showTemp = false }: HeatGaugeProps) {
    const t = useI18n('HeatGauge');
    const state = resolveHeatState(score);
    const pct = clampHeatScore(score);
    const stateLabel = t(`states.${state}`);
    const meterLabel = t('meterLabel', {
        state: stateLabel,
        value: Math.round(pct)
    });

    return (
        <div
            className={styles.gauge}
            role="meter"
            aria-label={meterLabel}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div className={styles.track}>
                <div
                    className={`${styles.fill} ${styles[state]}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            {showTemp && (
                <span className={styles.label}>
                    {t('displayLabel', {
                        state: stateLabel,
                        value: Math.round(pct)
                    })}
                </span>
            )}
        </div>
    );
}

export { HeatGauge };
