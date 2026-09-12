import type {
    StyleLifeFeelInputs,
    StyleProposalView,
    StyleTokenSelections,
} from '@/lib/api/styleAdvisor';

const SURFACE_COLORS: Record<string, string> = {
    base: '#fffaf0',
    elevated: '#ffffff',
    muted: '#f1eee7',
    accent_gold: '#d9a227',
};

const TEXT_COLORS: Record<string, string> = {
    primary: '#171717',
    secondary: '#8a6f38',
    inverse: '#fffaf0',
};

const ACCENT_COLORS: Record<string, string> = {
    gold: '#c28b1a',
    amber: '#d97706',
    teal: '#0f766e',
    violet: '#7c3aed',
    slate: '#475569',
};

const MOTION_TRANSITIONS: Record<string, string> = {
    calm: '1400ms',
    standard: '900ms',
    lively: '700ms',
};

export function buildScopedStylePreviewVariables(input: {
    tokenSelections?: Partial<StyleTokenSelections> | null;
    lifeFeelInputs?: StyleLifeFeelInputs | null;
}): Record<string, string> {
    const tokens = input.tokenSelections ?? {};
    const lifeFeel = input.lifeFeelInputs ?? {};
    const zone = lifeFeel.colorTemperature?.zone ?? 'neutral';
    const emphasis = Math.max(0, Math.min(4, Number(lifeFeel.emphasisLevel ?? 1)));
    const motion = String(tokens.motion || 'calm');
    return {
        '--style-preview-surface': SURFACE_COLORS[String(tokens.surface || 'base')] ?? SURFACE_COLORS.base,
        '--style-preview-text': TEXT_COLORS[String(tokens.text || 'primary')] ?? TEXT_COLORS.primary,
        '--style-preview-accent': ACCENT_COLORS[String(tokens.accent || 'gold')] ?? ACCENT_COLORS.gold,
        '--style-preview-transition': MOTION_TRANSITIONS[motion] ?? MOTION_TRANSITIONS.calm,
        '--dynamic-bg-tint': zone === 'warm'
            ? 'rgba(199, 168, 107, 0.08)'
            : zone === 'cool'
                ? 'rgba(107, 143, 199, 0.08)'
                : 'rgba(231, 228, 221, 0.04)',
        '--dynamic-contrast': String(1 + Math.min(0.04, emphasis * 0.01)),
        '--dynamic-warmth': zone === 'warm' ? '0.02' : zone === 'cool' ? '0' : '0.01',
        '--dynamic-gold-opacity': zone === 'warm' ? '0.9' : '0.55',
        '--curiosity-edge-glow': Array.isArray(lifeFeel.curiosityEvents) && lifeFeel.curiosityEvents.length > 0 ? '1' : '0',
        '--curiosity-contrast': String(1 + Math.min(0.03, emphasis * 0.0075)),
    };
}

export function buildStyleProposalPreviewVariables(
    proposal: StyleProposalView | null | undefined,
): Record<string, string> {
    return buildScopedStylePreviewVariables({
        tokenSelections: proposal?.proposedDiff.previewState?.tokenSelections
            ?? proposal?.proposedDiff.tokenSelections
            ?? null,
        lifeFeelInputs: proposal?.proposedDiff.previewState?.lifeFeelInputs
            ?? proposal?.proposedDiff.lifeFeelInputs
            ?? null,
    });
}
