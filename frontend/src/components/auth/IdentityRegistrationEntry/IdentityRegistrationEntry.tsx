'use client';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useI18n } from '@/i18n/useI18n';
import styles from './IdentityRegistrationEntry.module.css';

interface IdentityRegistrationEntryProps {
    variant?: 'banner' | 'card';
    title: string;
    description: string;
    primaryLabel?: string;
    secondaryLabel?: string;
    onPrimary: () => void;
    onSecondary?: () => void;
    className?: string;
}

export default function IdentityRegistrationEntry({
    variant = 'card',
    title,
    description,
    primaryLabel,
    secondaryLabel,
    onPrimary,
    onSecondary,
    className = '',
}: IdentityRegistrationEntryProps) {
    const t = useI18n('IdentityRegistrationEntry');
    const classes = [
        styles.entry,
        styles[variant],
        className,
    ].filter(Boolean).join(' ');
    const resolvedPrimaryLabel = primaryLabel ?? t('primaryLabel');

    return (
        <Card state={variant === 'banner' ? 'alloy' : 'ore'} className={classes}>
            <div className={styles.eyebrow}>{t('eyebrow')}</div>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.description}>{description}</p>
            <div className={styles.actions}>
                <Button variant="primary" size="sm" onClick={onPrimary}>
                    {resolvedPrimaryLabel}
                </Button>
                {secondaryLabel && onSecondary && (
                    <Button variant="ghost" size="sm" onClick={onSecondary}>
                        {secondaryLabel}
                    </Button>
                )}
            </div>
        </Card>
    );
}
