'use client';

import { X, Users, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { useI18n } from '@/i18n/useI18n';
import type { NearbyCircleLocationDto } from '@/lib/api/circleLocations';
import { formatRadius } from './locationFormatting';
import styles from './CircleLocationPreviewSheet.module.css';

interface CircleLocationPreviewSheetProps {
    item: NearbyCircleLocationDto | null;
    onClose: () => void;
}

export default function CircleLocationPreviewSheet({
    item,
    onClose,
}: CircleLocationPreviewSheetProps) {
    const t = useI18n('HomeMap');
    if (!item) return null;

    return (
        <div className={styles.sheet} role="dialog" aria-label={t('preview.aria')}>
            <button
                type="button"
                className={styles.closeButton}
                onClick={onClose}
                aria-label={t('preview.close')}
            >
                <X size={16} />
            </button>
            <div className={styles.content}>
                <div className={styles.kicker}>{item.label}</div>
                <h2>{item.circleName}</h2>
                <p>{item.circleDescription || t('preview.noDescription')}</p>
                <div className={styles.metaRow}>
                    <span>{t('preview.distance', { distance: formatRadius(item.distanceMeters) })}</span>
                    <span>{t('preview.range', { radius: formatRadius(item.radiusMeters) })}</span>
                    <span>
                        <Users size={13} />
                        {t('preview.members', { count: item.membersCount })}
                    </span>
                </div>
                <Link href={`/circles/${item.circleId}`} className={styles.enterButton}>
                    <span>{t('preview.enter')}</span>
                    <ArrowRight size={15} />
                </Link>
            </div>
        </div>
    );
}
