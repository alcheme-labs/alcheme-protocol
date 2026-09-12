import type { ContributionAssessmentAiProviderConfig } from './privacyProfile';

export function evaluateContributionAssessmentAiProviderReadiness(
    config: ContributionAssessmentAiProviderConfig | null,
): {
    ready: boolean;
    checks: Array<{ name: string; passed: boolean }>;
} {
    const checks = [
        {
            name: 'private sidecar bounded privacy profile',
            passed: config?.privacyProfile === 'private_sidecar_bounded_v1',
        },
        {
            name: 'structured text capability',
            passed: config?.capabilityProfile === 'text.structure',
        },
        {
            name: 'declared eval suite',
            passed: config?.evalSuiteVersion === 'contribution-assessment-ai-v1',
        },
        {
            name: 'bounded evidence redaction policy',
            passed: config?.redactionPolicy === 'bounded_evidence_v1',
        },
        {
            name: 'bounded evidence limits',
            passed: Boolean(
                config
                && config.maxEvidenceRefs >= 1
                && config.maxEvidenceRefs <= 40
                && config.maxExcerptChars >= 1
                && config.maxExcerptChars <= 600
                && config.maxFinalContentChars >= 1
                && config.maxFinalContentChars <= 1200,
            ),
        },
    ];
    return {
        ready: checks.every((check) => check.passed),
        checks,
    };
}
