'use client';

import { useMemo } from 'react';

interface UsePatinaOptions {
    /** How many times the content has been referenced */
    referenceCount?: number;
    /** Age in days since creation */
    ageDays?: number;
    /** Discussion frequency (comments per day) */
    discussionFrequency?: number;
}

interface PatinaVars {
    /** CSS variable overrides for time patina effects */
    style: Record<string, string>;
    /** CSS class suffix for patina level */
    level: 'fresh' | 'seasoned' | 'ancient';
}

/**
 * Time Patina hook.
 * 
 * Mobile Design Doc §8:
 * "活物会留下痕迹。"
 * "时间痕迹是累积性的，不是突然出现的。"
 * "变化幅度极小，用户可能需要数周才能感知到差异。"
 * 
 * Visual effects (all extremely subtle):
 * - High reference count → edges sharper, more stable
 * - Long-lived content → deeper, more settled surface
 * - High discussion frequency → slightly warmer
 */
export function usePatina(options: UsePatinaOptions = {}): PatinaVars {
    const { referenceCount = 0, ageDays = 0, discussionFrequency = 0 } = options;

    const level = useMemo(() => {
        if (ageDays > 30 && referenceCount > 20) return 'ancient' as const;
        if (ageDays > 7 || referenceCount > 5) return 'seasoned' as const;
        return 'fresh' as const;
    }, [ageDays, referenceCount]);

    const style = useMemo(() => {
        // Edge clarity: higher reference count → more defined edges
        const edgeClarity = Math.min(1, referenceCount / 50);

        // Surface depth: older content → deeper, more settled
        const surfaceDepth = Math.min(0.04, ageDays / 365 * 0.04);

        // Warmth: high discussion → slightly warmer
        const warmth = Math.min(0.03, discussionFrequency / 10 * 0.03);

        return {
            '--patina-edge-clarity': edgeClarity.toFixed(3),
            '--patina-surface-depth': surfaceDepth.toFixed(4),
            '--patina-warmth': warmth.toFixed(4),
            '--patina-transition': '2000ms', // Ultra-slow transitions
        };
    }, [referenceCount, ageDays, discussionFrequency]);

    return { style, level };
}
