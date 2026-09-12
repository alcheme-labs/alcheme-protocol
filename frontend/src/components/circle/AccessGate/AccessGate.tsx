'use client';

import { motion } from 'framer-motion';
import { Lock, Gem } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { SubCircle } from '@/lib/circle/types';
import styles from '@/app/(main)/circles/[id]/page.module.css';

/* ══════════════════════════════════════════
   Access Gate Overlay
   ══════════════════════════════════════════ */

export interface AccessGateProps {
    subCircle: SubCircle;
    userCrystals: number;
    onDismiss: () => void;
}

export default function AccessGate({
    subCircle,
    userCrystals,
    onDismiss,
}: AccessGateProps) {
    const t = useI18n('AccessGate');
    const required =
        subCircle.accessRequirement.type === 'crystal'
            ? subCircle.accessRequirement.minCrystals
            : 0;
    const progress = required > 0 ? Math.min(100, (userCrystals / required) * 100) : 100;

    return (
        <motion.div
            className={styles.accessGateOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onDismiss();
            }}
        >
            <motion.div
                className={styles.accessGateCard}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.2 }}
            >
                <div className={styles.accessGateIcon}>
                    <Lock size={20} />
                </div>
                <h3 className={styles.accessGateTitle}>{subCircle.name}</h3>
                <p className={styles.accessGateDesc}>
                    {t.rich('description', {
                        required,
                        strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                </p>
                <div className={styles.accessGateProgress}>
                    <div className={styles.accessGateProgressTrack}>
                        <div
                            className={styles.accessGateProgressFill}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className={styles.accessGateProgressLabel}>
                        <Gem size={12} />
                        <span>
                            {userCrystals} / {required}
                        </span>
                    </div>
                </div>
                <button className={styles.accessGateDismiss} onClick={onDismiss}>
                    {t('actions.dismiss')}
                </button>
            </motion.div>
        </motion.div>
    );
}
