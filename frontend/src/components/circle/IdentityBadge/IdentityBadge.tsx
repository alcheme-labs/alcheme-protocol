'use client';

import { useI18n } from '@/i18n/useI18n';
import styles from './IdentityBadge.module.css';

/* ═══ Types ═══ */

/**
 * User identity states in the circle hierarchy.
 */
export type IdentityState = 'visitor' | 'initiate' | 'member' | 'curator' | 'owner';

interface IdentityBadgeProps {
    state: IdentityState;
    /** Compact mode — icon only */
    compact?: boolean;
}

/* ═══ Config ═══ */

const IDENTITY_META: Record<IdentityState, {
    icon: string;
    className: string;
}> = {
    visitor: { icon: '👁', className: 'visitor' },
    initiate: { icon: '🌱', className: 'initiate' },
    member: { icon: '⚡', className: 'member' },
    curator: { icon: '💎', className: 'curator' },
    owner: { icon: '👑', className: 'owner' },
};

/* ═══ Component ═══ */

export default function IdentityBadge({ state, compact = false }: IdentityBadgeProps) {
    const t = useI18n('IdentityBadge');
    const meta = IDENTITY_META[state];
    const label = t(`labels.${state}`);

    if (compact) {
        return (
            <span
                className={`${styles.badge} ${styles[meta.className]} ${styles.compact}`}
                title={label}
            >
                {meta.icon}
            </span>
        );
    }

    return (
        <span className={`${styles.badge} ${styles[meta.className]}`}>
            <span className={styles.icon}>{meta.icon}</span>
            <span className={styles.label}>{label}</span>
        </span>
    );
}

export { IdentityBadge };
