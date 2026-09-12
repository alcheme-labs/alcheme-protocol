import type { GovernanceCase } from '@/lib/api/governance';

export const GOVERNANCE_BRIEF_SECTION_HEADINGS = [
    ['identity', 'Identity'],
    ['requested_decision', 'Requested decision'],
    ['background', 'Background'],
    ['options', 'Options'],
    ['arguments', 'Arguments'],
    ['supporting_evidence', 'Supporting evidence'],
    ['arguments_for', 'Arguments for'],
    ['arguments_against', 'Arguments against'],
    ['risks', 'Risks'],
    ['open_questions', 'Open questions'],
    ['execution_plan', 'Execution plan'],
    ['provider_readiness', 'Provider readiness'],
    ['outcome', 'Outcome'],
] as const;

export function buildGovernanceBriefTemplateText(
    governanceCase: GovernanceCase,
    currentContent: string,
): string {
    const current = String(currentContent || '').trim();
    const present = new Set(
        GOVERNANCE_BRIEF_SECTION_HEADINGS
            .filter(([, heading]) => new RegExp(`^\\s*#{1,6}\\s+${heading.replace(/ /g, '\\s+')}\\s*[:：]?\\s*$`, 'im').test(current))
            .map(([key]) => key),
    );
    if (present.size > 0) {
        const missing = GOVERNANCE_BRIEF_SECTION_HEADINGS
            .filter(([key]) => !present.has(key))
            .map(([, heading]) => `## ${heading}`);
        return [current, ...missing].filter(Boolean).join('\n\n');
    }

    const bodies: Partial<Record<typeof GOVERNANCE_BRIEF_SECTION_HEADINGS[number][0], string>> = {
        identity: `${governanceCase.title}\nCase: ${governanceCase.id}`.trim(),
        requested_decision: governanceCase.requestedDecision.trim(),
        background: current,
    };
    return GOVERNANCE_BRIEF_SECTION_HEADINGS
        .flatMap(([key, heading]) => [`## ${heading}`, bodies[key] || '[TBD]'])
        .join('\n\n')
        .trim();
}
