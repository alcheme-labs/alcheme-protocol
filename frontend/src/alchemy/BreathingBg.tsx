'use client';

import { useEffect, useState } from 'react';
import styles from './BreathingBg.module.css';

type Temperature = 'cool' | 'neutral' | 'warm';

interface BreathingBgProps {
    /** Color temperature — affects the warm tint intensity */
    temperature?: Temperature;
}

/**
 * Breathing Background — pure opacity overlay.
 *
 * Renders as a full-screen, pointer-events:none overlay.
 * Two solid-color layers with slow opacity animations create
 * a barely-perceptible "alive" brightness pulse across the UI.
 *
 * Mobile Design Doc §6:
 * - 呼吸周期：18s (亮度) + 22s (暖调)
 * - 亮度变化幅度：±1.5%
 * - "用户不应立即察觉呼吸存在"
 * - prefers-reduced-motion 时禁用
 *
 * 方案要点:
 * - 纯色 + opacity（无 mix-blend-mode → iOS Safari 兼容）
 * - 均匀覆盖（无 radial-gradient → 不打聚光灯）
 * - 只动画 opacity（GPU 最高效路径）
 */
export default function BreathingBg({ temperature = 'neutral' }: BreathingBgProps) {
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReduceMotion(mq.matches);
        const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const tempClass =
        temperature === 'cool' ? styles.cool :
            temperature === 'warm' ? styles.warm :
                styles.neutral;

    return (
        <div
            className={`${styles.container} ${tempClass}`}
            aria-hidden="true"
        >
            {!reduceMotion && (
                <>
                    <div className={styles.breathLayer} />
                    <div className={styles.warmLayer} />
                </>
            )}
        </div>
    );
}

export { BreathingBg };
