export const CONTRIBUTION_ASSESSMENT_AI_TASK_TYPE = 'contribution.assessment_suggest.v1';
export const CONTRIBUTION_ASSESSMENT_AI_PROMPT_ID = 'contribution-assessment';
export const CONTRIBUTION_ASSESSMENT_AI_ALGORITHM_VERSION = 'ai:contribution-assessment:v1';

export type ContributionAssessmentAiPrivacyProfile = 'private_sidecar_bounded_v1';
export type ContributionAssessmentAiCapabilityProfile = 'text.structure';
export type ContributionAssessmentAiEvalSuiteVersion = 'contribution-assessment-ai-v1';
export type ContributionAssessmentAiRedactionPolicy = 'bounded_evidence_v1';

export interface ContributionAssessmentAiProviderConfig {
    privacyProfile: ContributionAssessmentAiPrivacyProfile;
    capabilityProfile: ContributionAssessmentAiCapabilityProfile;
    evalSuiteVersion: ContributionAssessmentAiEvalSuiteVersion;
    redactionPolicy: ContributionAssessmentAiRedactionPolicy;
    maxEvidenceRefs: number;
    maxExcerptChars: number;
    maxFinalContentChars: number;
}

export type ContributionAssessmentAiConfigError =
    | 'private_sidecar_required'
    | 'contribution_assessment_ai_provider_not_configured';

const REQUIRED_PRIVACY_PROFILE: ContributionAssessmentAiPrivacyProfile = 'private_sidecar_bounded_v1';
const REQUIRED_CAPABILITY_PROFILE: ContributionAssessmentAiCapabilityProfile = 'text.structure';
const REQUIRED_EVAL_SUITE: ContributionAssessmentAiEvalSuiteVersion = 'contribution-assessment-ai-v1';
const REQUIRED_REDACTION_POLICY: ContributionAssessmentAiRedactionPolicy = 'bounded_evidence_v1';

export function resolveContributionAssessmentAiProviderConfig(
    env: NodeJS.ProcessEnv,
): {
    ok: true;
    config: ContributionAssessmentAiProviderConfig;
} | {
    ok: false;
    error: ContributionAssessmentAiConfigError;
} {
    if (String(env.QUERY_API_RUNTIME_ROLE || '').trim().toUpperCase() !== 'PRIVATE_SIDECAR') {
        return { ok: false, error: 'private_sidecar_required' };
    }
    if (env.CONTRIBUTION_ASSESSMENT_AI_PRIVACY_PROFILE !== REQUIRED_PRIVACY_PROFILE) {
        return { ok: false, error: 'contribution_assessment_ai_provider_not_configured' };
    }
    if (env.CONTRIBUTION_ASSESSMENT_AI_CAPABILITY_PROFILE !== REQUIRED_CAPABILITY_PROFILE) {
        return { ok: false, error: 'contribution_assessment_ai_provider_not_configured' };
    }
    if (env.CONTRIBUTION_ASSESSMENT_AI_EVAL_SUITE !== REQUIRED_EVAL_SUITE) {
        return { ok: false, error: 'contribution_assessment_ai_provider_not_configured' };
    }
    if (env.CONTRIBUTION_ASSESSMENT_AI_REDACTION_POLICY !== REQUIRED_REDACTION_POLICY) {
        return { ok: false, error: 'contribution_assessment_ai_provider_not_configured' };
    }
    const maxEvidenceRefs = parseBoundedInteger(env.CONTRIBUTION_ASSESSMENT_AI_MAX_EVIDENCE_REFS, 1, 40);
    const maxExcerptChars = parseBoundedInteger(env.CONTRIBUTION_ASSESSMENT_AI_MAX_EXCERPT_CHARS, 1, 600);
    const maxFinalContentChars = parseBoundedInteger(env.CONTRIBUTION_ASSESSMENT_AI_MAX_FINAL_CONTENT_CHARS, 1, 1200);
    if (maxEvidenceRefs === null || maxExcerptChars === null || maxFinalContentChars === null) {
        return { ok: false, error: 'contribution_assessment_ai_provider_not_configured' };
    }
    return {
        ok: true,
        config: {
            privacyProfile: REQUIRED_PRIVACY_PROFILE,
            capabilityProfile: REQUIRED_CAPABILITY_PROFILE,
            evalSuiteVersion: REQUIRED_EVAL_SUITE,
            redactionPolicy: REQUIRED_REDACTION_POLICY,
            maxEvidenceRefs,
            maxExcerptChars,
            maxFinalContentChars,
        },
    };
}

function parseBoundedInteger(value: unknown, min: number, max: number): number | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    if (!/^\d+$/.test(value.trim())) return null;
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
    return parsed;
}
