'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import styles from './UsefulIndicator.module.css';

interface UsefulIndicatorProps {
    /** Current useful mark count */
    count: number;
    /** Threshold to show stronger useful signal styling */
    threshold?: number;
    /** Whether the current user has marked this message useful */
    isMarked?: boolean;
    /** Callback when user marks useful */
    onMarkUseful?: () => void;
    /** Callback when user cancels their useful mark */
    onUnmarkUseful?: () => void;
}

export default function UsefulIndicator({
    count,
    threshold = 3,
    isMarked = false,
    onMarkUseful,
    onUnmarkUseful,
}: UsefulIndicatorProps) {
    const [justMarked, setJustMarked] = useState(false);
    const isAtThreshold = count >= threshold;

    const handleClick = useCallback(() => {
        if (isMarked) {
            onUnmarkUseful?.();
            return;
        }
        if (onMarkUseful) {
            onMarkUseful();
            setJustMarked(true);
            setTimeout(() => setJustMarked(false), 1200);
        }
    }, [isMarked, onMarkUseful, onUnmarkUseful]);

    return (
        <motion.button
            className={`${styles.btn} ${isMarked ? styles.marked : ''} ${isAtThreshold ? styles.threshold : ''}`}
            onClick={handleClick}
            whileTap={onMarkUseful || onUnmarkUseful ? { y: 1 } : {}}
            disabled={!onMarkUseful && !onUnmarkUseful}
            aria-pressed={isMarked}
        >
            <AnimatePresence mode="wait">
                {justMarked ? (
                    <motion.span
                        key="flash"
                        className={styles.icon}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1.2, opacity: 1 }}
                        exit={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <Lightbulb size={12} />
                    </motion.span>
                ) : (
                    <motion.span
                        key="default"
                        className={styles.icon}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <Lightbulb size={12} />
                    </motion.span>
                )}
            </AnimatePresence>
            {count > 0 && <span className={styles.count}>{count}</span>}
        </motion.button>
    );
}
