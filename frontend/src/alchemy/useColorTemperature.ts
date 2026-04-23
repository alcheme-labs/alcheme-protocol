'use client';

import { useMemo } from 'react';
import type { HeatState } from './useHeatDecay';

type ColorTemperature = 'cool' | 'neutral' | 'warm';

interface UseColorTemperatureOptions {
    /** Active tab context */
    activeTab?: string;
    /** Heat level from useHeatDecay (0-1) */
    heatLevel?: number;
    /** Whether consensus has been reached */
    hasConsensus?: boolean;
}

interface ColorTemperatureVars {
    /** CSS variable overrides for dynamic color temperature */
    style: Record<string, string>;
    /** Current temperature zone */
    zone: ColorTemperature;
    /** Transition duration in ms (always >800ms per design doc) */
    transitionMs: number;
}

/**
 * Dynamic color temperature hook.
 * 
 * Mobile Design Doc §4: "色温切换必须缓慢渐变（>800ms），绝不能瞬间变化。"
 * 
 * Three zones:
 * - cool: quiet / no active discussion → lower contrast, cooler tones
 * - neutral: discussion in progress → balanced
 * - warm: consensus forming / crystallization → +2% warmth, gold edges
 */
export function useColorTemperature(options: UseColorTemperatureOptions = {}): ColorTemperatureVars {
    const { activeTab, heatLevel = 0.5, hasConsensus = false } = options;

    const zone: ColorTemperature = useMemo(() => {
        if (hasConsensus || activeTab === 'sanctuary') return 'warm';
        if (heatLevel > 0.5 || activeTab === 'crucible') return 'neutral';
        if (heatLevel < 0.1) return 'cool';
        return 'neutral';
    }, [activeTab, heatLevel, hasConsensus]);

    const style = useMemo(() => {
        switch (zone) {
            case 'cool':
                return {
                    '--dynamic-bg-tint': 'rgba(180, 195, 210, 0.03)',
                    '--dynamic-contrast': '0.97',
                    '--dynamic-warmth': '0',
                    '--dynamic-gold-opacity': '0.3',
                    '--dynamic-transition': '1200ms',
                };
            case 'warm':
                return {
                    '--dynamic-bg-tint': 'rgba(199, 168, 107, 0.04)',
                    '--dynamic-contrast': '1.02',
                    '--dynamic-warmth': '0.02',
                    '--dynamic-gold-opacity': '0.9',
                    '--dynamic-transition': '1000ms',
                };
            case 'neutral':
            default:
                return {
                    '--dynamic-bg-tint': 'rgba(231, 228, 221, 0.02)',
                    '--dynamic-contrast': '1.0',
                    '--dynamic-warmth': '0.01',
                    '--dynamic-gold-opacity': '0.6',
                    '--dynamic-transition': '900ms',
                };
        }
    }, [zone]);

    return { style, zone, transitionMs: zone === 'cool' ? 1200 : zone === 'warm' ? 1000 : 900 };
}
