'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import type { CircleAccessRequirement } from '@/lib/circle/accessPolicy';
import styles from './CirclePicker.module.css';

export interface PickerCircle {
    /** Circle group id (e.g. 1, 2, 3) */
    groupId: number;
    /** Group name (e.g. "Rust study circle") */
    groupName: string;
    /** Sub-circle id */
    subCircleId: string;
    /** Sub-circle name */
    subCircleName: string;
    /** Level in hierarchy (higher = deeper) */
    level: number;
    /** Access requirement */
    accessRequirement: CircleAccessRequirement;
}

interface CirclePickerProps {
    open: boolean;
    circles: PickerCircle[];
    selectedCount: number;
    onSelect: (circle: PickerCircle) => void;
    onClose: () => void;
}

export default function CirclePicker({
    open,
    circles,
    selectedCount,
    onSelect,
    onClose,
}: CirclePickerProps) {
    const t = useI18n('CirclePicker');
    const grouped = circles.reduce<Record<string, PickerCircle[]>>((acc, c) => {
        if (!acc[c.groupName]) acc[c.groupName] = [];
        acc[c.groupName].push(c);
        return acc;
    }, {});

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.circlePickerOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={styles.circlePickerSheet}
                        initial={{ y: 300, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 300, opacity: 0 }}
                        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={styles.circlePickerHandle} />

                        <div className={styles.circlePickerHeader}>
                            <ArrowUp size={16} style={{ opacity: 0.5 }} />
                            <span className={styles.circlePickerTitle}>
                                {t('title')}
                            </span>
                            <span className={styles.circlePickerHint}>
                                {t('hint', { count: selectedCount })}
                            </span>
                        </div>

                        <div className={styles.circlePickerList}>
                            {Object.entries(grouped).map(([groupName, items]) => (
                                <div key={groupName} className={styles.circlePickerGroup}>
                                    <div className={styles.circlePickerGroupName}>{groupName}</div>
                                    {items.map((c) => {
                                        return (
                                            <button
                                                key={c.subCircleId}
                                                data-testid={`circle-picker-item-${c.subCircleId}`}
                                                className={styles.circlePickerItem}
                                                onClick={() => onSelect(c)}
                                            >
                                                <div className={`${styles.circlePickerItemDot} ${styles.circlePickerItemDotFree}`} />
                                                <span className={styles.circlePickerItemName}>
                                                    {c.subCircleName}
                                                </span>
                                                <span className={styles.circlePickerItemMeta}>
                                                    {t('meta.level', { level: c.level })}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>

                        <button className={styles.circlePickerCancel} onClick={onClose}>
                            {t('actions.cancel')}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
