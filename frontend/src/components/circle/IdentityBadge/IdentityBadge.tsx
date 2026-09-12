'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { useI18n } from '@/i18n/useI18n';
import type { CircleIdentityDisplayState, CircleMembershipSourceValue } from '@/lib/circle/identityTypes';
import styles from './IdentityBadge.module.css';

interface IdentityBadgeProps {
    state: CircleIdentityDisplayState;
    compact?: boolean;
    label?: string | null;
    roleLabel?: string | null;
    membershipSource?: CircleMembershipSourceValue | null;
    onOpen?: () => void;
}

const IDENTITY_META: Record<CircleIdentityDisplayState, {
    icon: string;
    className: string;
}> = {
    observer: { icon: '👁', className: 'observer' },
    participant: { icon: '🌱', className: 'participant' },
    contributor: { icon: '⚡', className: 'contributor' },
    senior_contributor: { icon: '◆', className: 'seniorContributor' },
    not_joined: { icon: '○', className: 'notJoined' },
    unknown: { icon: '?', className: 'unknown' },
};

function normalizeLabel(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
}

export default function IdentityBadge({
    state,
    compact = false,
    label,
    roleLabel,
    membershipSource,
    onOpen,
}: IdentityBadgeProps) {
    const t = useI18n('IdentityBadge');
    const meta = IDENTITY_META[state];
    const displayLabel = normalizeLabel(label) ?? t(`labels.${state}`);
    const sourceLabel = membershipSource === 'inherited_parent'
        ? t('sources.inherited_parent')
        : membershipSource === 'current_circle'
            ? t('sources.current_circle')
            : null;
    const accessibleLabel = [
        displayLabel,
        normalizeLabel(roleLabel),
        sourceLabel,
    ].filter(Boolean).join(' · ');
    const interactiveProps = onOpen
        ? {
            role: 'button',
            tabIndex: 0,
            onClick: (event: MouseEvent<HTMLSpanElement>) => {
                event.stopPropagation();
                onOpen();
            },
            onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                onOpen();
            },
        }
        : {};

    if (compact) {
        return (
            <span
                className={`${styles.badge} ${styles[meta.className]} ${styles.compact}`}
                data-testid="identity-badge"
                title={accessibleLabel}
                aria-label={accessibleLabel}
                {...interactiveProps}
            >
                {meta.icon}
            </span>
        );
    }

    return (
        <span
            className={`${styles.badge} ${styles[meta.className]}`}
            data-testid="identity-badge"
            title={accessibleLabel}
            aria-label={accessibleLabel}
            {...interactiveProps}
        >
            <span className={styles.icon}>{meta.icon}</span>
            <span className={styles.label}>{displayLabel}</span>
        </span>
    );
}

export { IdentityBadge };
