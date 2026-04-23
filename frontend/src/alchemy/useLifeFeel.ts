'use client';

import { useMemo } from 'react';
import { useHeatDecay, type HeatState, type HeatEvent } from './useHeatDecay';
import { useColorTemperature } from './useColorTemperature';
import { usePatina } from './usePatina';
import { useCuriosity } from './useCuriosity';

// ───── Types ─────

type CuriosityEvent = 'conflict' | 'refinement' | 'new_reference';

export interface UseLifeFeelOptions {
    // Heat decay
    /** Initial heat score (default 100) */
    initialHeat?: number;
    /** Enable auto-decay simulation (default true) */
    autoDecay?: boolean;

    // Color temperature
    /** Active tab context */
    activeTab?: string;
    /** Whether consensus has been reached */
    hasConsensus?: boolean;

    // Patina
    /** How many times the content has been referenced */
    referenceCount?: number;
    /** Age in days since creation */
    ageDays?: number;
    /** Discussion frequency (comments per day) */
    discussionFrequency?: number;

    // Curiosity
    /** Active curiosity events */
    curiosityEvents?: CuriosityEvent[];
}

export interface LifeFeelReturn {
    /** Merged CSS variables — spread onto a container's style prop */
    style: Record<string, string>;

    /** Current heat score (0-100+) */
    heat: number;
    /** Current heat state */
    heatState: HeatState;
    /** Normalized temperature (0-1) */
    temperature: number;
    /** Record a heat event */
    recordEvent: (event: HeatEvent) => void;

    /** Color temperature zone */
    colorZone: 'cool' | 'neutral' | 'warm';

    /** Patina level */
    patinaLevel: 'fresh' | 'seasoned' | 'ancient';

    /** Whether curiosity engine is active */
    curiosityActive: boolean;

    /** BreathingBg temperature prop value */
    breathTemp: 'cool' | 'neutral' | 'warm';
}

/**
 * Master Life-Feel hook.
 * 
 * Combines all sub-hooks into a single API surface.
 * Returns merged CSS variables and all state/actions.
 *
 * Usage:
 * ```tsx
 * const lf = useLifeFeel({ activeTab, initialHeat: 80 });
 * return (
 *   <div data-life-feel style={lf.style}>
 *     <BreathingBg temperature={lf.breathTemp} />
 *     {children}
 *   </div>
 * );
 * ```
 */
export function useLifeFeel(options: UseLifeFeelOptions = {}): LifeFeelReturn {
    const {
        initialHeat,
        autoDecay,
        activeTab,
        hasConsensus,
        referenceCount,
        ageDays,
        discussionFrequency,
        curiosityEvents,
    } = options;

    // ── Sub-hooks ──
    const {
        heat, heatState, temperature, recordEvent,
    } = useHeatDecay({ initialHeat, autoDecay });

    const {
        style: colorStyle, zone: colorZone,
    } = useColorTemperature({ activeTab, heatLevel: temperature, hasConsensus });

    const {
        style: patinaStyle, level: patinaLevel,
    } = usePatina({ referenceCount, ageDays, discussionFrequency });

    const {
        style: curiosityStyle, isActive: curiosityActive,
    } = useCuriosity({ events: curiosityEvents });

    // ── Merge all CSS variables ──
    const style = useMemo(() => ({
        ...colorStyle,
        ...patinaStyle,
        ...curiosityStyle,
    }), [colorStyle, patinaStyle, curiosityStyle]);

    return {
        style,
        heat,
        heatState,
        temperature,
        recordEvent,
        colorZone,
        patinaLevel,
        curiosityActive,
        breathTemp: colorZone,
    };
}
