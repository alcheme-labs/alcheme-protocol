'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './HighlightButton.module.css';

interface HighlightButtonProps {
    /** Current highlight count */
    count: number;
    /** Threshold to trigger ghost draft reveal */
    threshold?: number;
    /** Whether the current user has highlighted */
    isHighlighted?: boolean;
    /** Callback when user highlights */
    onHighlight?: () => void;
}

/**
 * Highlight button — a stronger signal than a normal reaction.
 */
export default function HighlightButton({
    count,
    threshold = 3,
    isHighlighted = false,
    onHighlight,
}: HighlightButtonProps) {
    const [justHighlighted, setJustHighlighted] = useState(false);
    const isAtThreshold = count >= threshold;

    const handleClick = useCallback(() => {
        if (isHighlighted) return;
        onHighlight?.();
        setJustHighlighted(true);
        setTimeout(() => setJustHighlighted(false), 1200);
    }, [isHighlighted, onHighlight]);

    return (
        <motion.button
            className={`${styles.btn} ${isHighlighted ? styles.highlighted : ''} ${isAtThreshold ? styles.threshold : ''}`}
            onClick={handleClick}
            whileTap={isHighlighted ? {} : { y: 1 }}
            disabled={isHighlighted}
        >
            <AnimatePresence mode="wait">
                {justHighlighted ? (
                    <motion.span
                        key="flash"
                        className={styles.icon}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1.2, opacity: 1 }}
                        exit={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        ✨
                    </motion.span>
                ) : (
                    <motion.span
                        key="default"
                        className={styles.icon}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        {isHighlighted ? '💡' : '🔆'}
                    </motion.span>
                )}
            </AnimatePresence>
            {count > 0 && <span className={styles.count}>{count}</span>}
        </motion.button>
    );
}
