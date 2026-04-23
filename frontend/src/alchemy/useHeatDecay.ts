'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { resolveHeatState, resolveHeatTemperature, type HeatState } from '@/lib/heat/semantics';

export type { HeatState };

export type HeatEvent = 'edit' | 'comment' | 'reference' | 'view';

/** Heat increase per event type (from Product Manual §2.3) */
const HEAT_DELTA: Record<HeatEvent, number> = {
    edit: 15,
    comment: 5,
    reference: 10,
    view: 0.5,
};

/** Daily decay rate (10% per day, simulated as per-tick decay) */
const DECAY_RATE = 0.90;

/** Demo decay interval in ms (30s = 1 "day" for demo purposes) */
const DEMO_DECAY_INTERVAL = 30_000;

interface UseHeatDecayOptions {
    /** Initial heat score (default 100) */
    initialHeat?: number;
    /** Enable auto-decay simulation (default true) */
    autoDecay?: boolean;
    /** Decay interval in ms (default 30000 for demo) */
    decayInterval?: number;
}

interface UseHeatDecayReturn {
    /** Current heat score (0-100+) */
    heat: number;
    /** Current heat state */
    heatState: HeatState;
    /** Normalized temperature (0-1) for visual mapping */
    temperature: number;
    /** Record a heat event */
    recordEvent: (event: HeatEvent) => void;
    /** Manually set heat */
    setHeat: (value: number) => void;
    /** Reset to initial heat */
    reset: () => void;
}

/**
 * Heat Decay Engine hook.
 * 
 * Product Manual §2.3:
 * "合金拥有一个温度值。每次有人编辑、评论、引用，温度上升。
 *  无人理睬，温度自然衰减。当温度降至冰点，合金被冻结归档。"
 */
export function useHeatDecay(options: UseHeatDecayOptions = {}): UseHeatDecayReturn {
    const {
        initialHeat = 100,
        autoDecay = true,
        decayInterval = DEMO_DECAY_INTERVAL,
    } = options;

    const [heat, setHeatRaw] = useState(initialHeat);
    const heatRef = useRef(heat);

    // Keep ref in sync for interval callback
    useEffect(() => {
        heatRef.current = heat;
    }, [heat]);

    const heatState = resolveHeatState(heat);
    const temperature = resolveHeatTemperature(heat);

    const recordEvent = useCallback((event: HeatEvent) => {
        setHeatRaw((prev) => Math.min(120, prev + HEAT_DELTA[event]));
    }, []);

    const setHeat = useCallback((value: number) => {
        setHeatRaw(Math.max(0, value));
    }, []);

    const reset = useCallback(() => {
        setHeatRaw(initialHeat);
    }, [initialHeat]);

    // Auto-decay simulation
    useEffect(() => {
        if (!autoDecay) return;

        const interval = setInterval(() => {
            setHeatRaw((prev) => {
                const next = prev * DECAY_RATE;
                return next < 0.5 ? 0 : next; // Round to 0 when negligible
            });
        }, decayInterval);

        return () => clearInterval(interval);
    }, [autoDecay, decayInterval]);

    return { heat, heatState, temperature, recordEvent, setHeat, reset };
}
