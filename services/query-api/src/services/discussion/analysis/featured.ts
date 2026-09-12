import type { DiscussionFocusLabel } from './types';

export function decideFeatured(input: {
    semanticScore: number;
    qualityScore: number;
    spamScore: number;
    focusLabel: DiscussionFocusLabel;
    actualMode: string;
}): { isFeatured: boolean; featureReason: string | null } {
    if (input.actualMode === 'fallback_rule') {
        return {
            isFeatured: false,
            featureReason: null,
        };
    }

    const passes =
        input.focusLabel === 'focused'
        && input.semanticScore >= 0.78
        && input.qualityScore >= 0.6
        && input.spamScore <= 0.25;

    return {
        isFeatured: passes,
        featureReason: passes ? `canonical_featured:${input.actualMode}:high_confidence_focus` : null,
    };
}
