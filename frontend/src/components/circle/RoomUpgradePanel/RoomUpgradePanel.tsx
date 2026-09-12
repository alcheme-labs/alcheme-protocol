'use client';

import { useI18n } from '@/i18n/useI18n';
import styles from './RoomUpgradePanel.module.css';

interface RoomUpgradePanelProps {
    roomKey: string;
    sourceMaterialCount: number;
    canModerate: boolean;
    onStartUpgrade: (roomKey: string) => void;
}

export default function RoomUpgradePanel({
    roomKey,
    sourceMaterialCount,
    canModerate,
    onStartUpgrade,
}: RoomUpgradePanelProps) {
    const t = useI18n('RoomUpgradePanel');

    if (!canModerate || sourceMaterialCount <= 0) return null;

    return (
        <div className={styles.panel}>
            <div className={styles.title}>{t('title')}</div>
            <div className={styles.body}>
                {t('body', { count: sourceMaterialCount })}
            </div>
            <button
                type="button"
                className={styles.action}
                onClick={() => onStartUpgrade(roomKey)}
            >
                {t('action')}
            </button>
        </div>
    );
}
