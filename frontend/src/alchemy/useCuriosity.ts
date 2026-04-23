'use client';

import { useMemo } from 'react';

type CuriosityEvent = 'conflict' | 'refinement' | 'new_reference';

interface UseCuriosityOptions {
    /** Active events in the current context */
    events?: CuriosityEvent[];
}

interface CuriosityVars {
    /** CSS variable overrides for ambient curiosity effects */
    style: Record<string, string>;
    /** Whether any curiosity trigger is active */
    isActive: boolean;
}

/**
 * Curiosity Engine hook.
 * 
 * Mobile Design Doc §7:
 * "好奇不是推送，不是提醒，而是环境微调。"
 * "AI 只能像光一样存在，不能像声音一样存在。"
 * 
 * All changes are ≤5% visual budget, >800ms transition.
 * - conflict: space contrast slightly increases (tension)
 * - refinement: font sharpness subtly increases (clarity)
 * - new_reference: referenced content edge glows very faintly
 */
export function useCuriosity(options: UseCuriosityOptions = {}): CuriosityVars {
    const { events = [] } = options;

    const isActive = events.length > 0;

    const style = useMemo(() => {
        const vars: Record<string, string> = {
            '--curiosity-contrast': '1.0',
            '--curiosity-sharpness': '0',
            '--curiosity-edge-glow': '0',
            '--curiosity-transition': '1200ms',
        };

        for (const event of events) {
            switch (event) {
                case 'conflict':
                    // Subtle contrast boost — tension
                    vars['--curiosity-contrast'] = '1.02';
                    break;
                case 'refinement':
                    // Micro text sharpness increase
                    vars['--curiosity-sharpness'] = '0.3px';
                    break;
                case 'new_reference':
                    // Very faint edge glow on referenced content
                    vars['--curiosity-edge-glow'] = '1';
                    break;
            }
        }

        return vars;
    }, [events]);

    return { style, isActive };
}
