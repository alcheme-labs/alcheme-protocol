import {
    getPromptSchema,
    getSystemPrompt,
} from '../../ai/prompts/registry';
import { callAiCapability } from '../aiOperatingLayer/capabilities/adapter';
import {
    DEFAULT_CONTRIBUTION_POLICY_VERSION,
} from './policy';
import type { ContributionAssessmentProvider } from './provider';
import {
    hashContributionEvidencePackage,
} from './evidencePackage';
import type {
    ContributionEvidencePackage,
    ContributionEvidenceRef,
    ContributionType,
} from './types';
import {
    CONTRIBUTION_ASSESSMENT_AI_ALGORITHM_VERSION,
    CONTRIBUTION_ASSESSMENT_AI_PROMPT_ID,
    CONTRIBUTION_ASSESSMENT_AI_TASK_TYPE,
    type ContributionAssessmentAiProviderConfig,
} from './privacyProfile';
import {
    parseContributionAssessmentAiSuggestion,
} from './aiProviderSchema';

export interface ContributionAssessmentAiPromptContext {
    kind: 'contribution_assessment_ai_context.v1';
    draftPostId: number;
    circleId: number;
    draftOrigin: ContributionEvidencePackage['draftOrigin'];
    inputHash: string;
    sourceAnchor: ContributionEvidencePackage['sourceAnchor'];
    stableSnapshot: ContributionEvidencePackage['stableSnapshot'];
    finalContent: {
        digest: string;
        excerpt: string;
    };
    contributors: Array<{
        pubkey: string;
        evidenceRoles: string[];
    }>;
    evidenceRefs: Array<{
        refId: string;
        refType: ContributionEvidenceRef['refType'];
        contributorPubkey: string | null;
        hash: string | null;
        stage: ContributionEvidenceRef['stage'];
        retention: ContributionEvidenceRef['retention'];
        excerpt: string | null;
        metadata: Record<string, unknown>;
    }>;
    outputRules: {
        totalWeightBps: 10000;
        useOnlyProvidedPubkeys: true;
        useOnlyProvidedEvidenceRefs: true;
        highPenetrationRequiresReview: true;
    };
}

export function buildContributionAssessmentAiPromptContext(input: {
    evidence: ContributionEvidencePackage;
    config: ContributionAssessmentAiProviderConfig;
}): ContributionAssessmentAiPromptContext {
    const evidence = input.evidence;
    const evidenceRefs = selectBoundedEvidenceRefs(evidence.evidenceRefs, input.config.maxEvidenceRefs);
    const backedContributorPubkeys = new Set(
        evidenceRefs
            .filter((ref) => ref.retention === 'retained' && ref.stage !== null)
            .map((ref) => ref.contributorPubkey)
            .filter((pubkey): pubkey is string => pubkey !== null),
    );
    return {
        kind: 'contribution_assessment_ai_context.v1',
        draftPostId: evidence.draftPostId,
        circleId: evidence.circleId,
        draftOrigin: evidence.draftOrigin,
        inputHash: hashContributionEvidencePackage(evidence),
        sourceAnchor: evidence.sourceAnchor,
        stableSnapshot: evidence.stableSnapshot,
        finalContent: {
            digest: evidence.finalContentDigest,
            excerpt: truncate(evidence.boundedFinalContentExcerpt, input.config.maxFinalContentChars),
        },
        contributors: evidence.contributors
            .filter((contributor) => backedContributorPubkeys.has(contributor.pubkey))
            .map((contributor) => ({
                pubkey: contributor.pubkey,
                evidenceRoles: [...contributor.evidenceRoles].sort(),
            })),
        evidenceRefs: evidenceRefs.map((ref) => ({
                refId: ref.refId,
                refType: ref.refType,
                contributorPubkey: ref.contributorPubkey,
                hash: ref.hash,
                stage: ref.stage,
                retention: ref.retention,
                excerpt: ref.excerpt === null ? null : truncate(ref.excerpt, input.config.maxExcerptChars),
                metadata: sanitizeMetadata(ref.metadata, input.config.maxExcerptChars),
            })),
        outputRules: {
            totalWeightBps: 10000,
            useOnlyProvidedPubkeys: true,
            useOnlyProvidedEvidenceRefs: true,
            highPenetrationRequiresReview: true,
        },
    };
}

export function createAiContributionAssessmentProvider(
    config: ContributionAssessmentAiProviderConfig,
): ContributionAssessmentProvider {
    return {
        mode: 'ai',
        async assessDraftContribution(evidence) {
            const context = buildContributionAssessmentAiPromptContext({ evidence, config });
            const allowedContributionTypesForThisEvidence = resolveAllowedContributionTypesForEvidenceRefs({
                draftOrigin: evidence.draftOrigin,
                evidenceRefs: context.evidenceRefs,
            });
            const result = await callAiCapability({
                taskType: CONTRIBUTION_ASSESSMENT_AI_TASK_TYPE,
                capability: 'text.structure',
                privacyProfile: 'private_plaintext',
                runtimeRole: 'PRIVATE_SIDECAR',
                input: {
                    systemPrompt: getSystemPrompt(CONTRIBUTION_ASSESSMENT_AI_PROMPT_ID),
                    prompt: JSON.stringify({
                        task: CONTRIBUTION_ASSESSMENT_AI_TASK_TYPE,
                        privacy: {
                            profile: config.privacyProfile,
                            redactionPolicy: config.redactionPolicy,
                            boundedEvidenceOnly: true,
                            noPromptOrProviderRawPersistence: true,
                        },
                        output: {
                            format: 'json_object_only',
                            schema: getPromptSchema(CONTRIBUTION_ASSESSMENT_AI_PROMPT_ID) ?? null,
                            maxFrames: 4,
                            maxAllocationsPerFrame: 4,
                            conciseReasons: true,
                            contributionTypeByEvidenceStage: {
                                source_discussion: 'source_discussion',
                                direct_author: 'direct_authoring',
                                source_selection: 'curation',
                                draft_modification: ['semantic_edit', 'style_edit'],
                                review_correction: ['review_issue', 'review_solution'],
                            },
                            allocationEvidenceRule:
                                'Every allocation contributionType must match every referenced evidenceRef stage.',
                            allowedContributionTypesForThisEvidence,
                            directAuthoringAllowed: evidence.draftOrigin === 'direct_human',
                            strictContributionTypeRule:
                                'Use only allowedContributionTypesForThisEvidence for this request.',
                        },
                        context,
                    }),
                    responseFormat: {
                        type: 'json',
                        name: 'contribution_assessment',
                        schema: getPromptSchema(CONTRIBUTION_ASSESSMENT_AI_PROMPT_ID) ?? undefined,
                    },
                    providerOptions: {
                        openai: {
                            reasoning: {
                                effort: 'none',
                                exclude: true,
                            },
                        },
                    },
                    temperature: 0.1,
                    maxOutputTokens: 4000,
                },
            });
            return parseContributionAssessmentAiSuggestion({
                rawText: result.output.text,
                evidence,
                algorithmVersion: CONTRIBUTION_ASSESSMENT_AI_ALGORITHM_VERSION,
                framePolicyVersion: DEFAULT_CONTRIBUTION_POLICY_VERSION,
                allowedEvidenceRefIds: context.evidenceRefs.map((ref) => ref.refId),
            });
        },
    };
}

function resolveAllowedContributionTypesForEvidenceRefs(input: {
    draftOrigin: ContributionEvidencePackage['draftOrigin'];
    evidenceRefs: ContributionAssessmentAiPromptContext['evidenceRefs'];
},
): ContributionType[] {
    const allowed = new Set<ContributionType>();
    for (const ref of input.evidenceRefs) {
        if (ref.retention !== 'retained' || ref.contributorPubkey === null) continue;
        if (ref.stage === 'source_discussion') allowed.add('source_discussion');
        if (ref.stage === 'direct_author') allowed.add('direct_authoring');
        if (ref.stage === 'source_selection') allowed.add('curation');
        if (ref.stage === 'draft_modification') {
            allowed.add('semantic_edit');
            allowed.add('style_edit');
        }
        if (ref.stage === 'review_correction') {
            allowed.add('review_issue');
            allowed.add('review_solution');
        }
    }
    if (input.draftOrigin !== 'direct_human') {
        allowed.delete('direct_authoring');
    }
    return Array.from(allowed).sort();
}

function selectBoundedEvidenceRefs(
    refs: ContributionEvidenceRef[],
    maxEvidenceRefs: number,
): ContributionEvidenceRef[] {
    return refs
        .map((ref, index) => ({ ref, index, priority: evidenceRefPriority(ref) }))
        .sort((left, right) => left.priority - right.priority || left.index - right.index)
        .slice(0, maxEvidenceRefs)
        .map(({ ref }) => ref);
}

function evidenceRefPriority(ref: ContributionEvidenceRef): number {
    if (ref.retention === 'retained' && ref.stage !== null && ref.contributorPubkey !== null) return 0;
    if (ref.retention === 'retained') return 1;
    if (ref.retention === 'trace_only') return 2;
    return 3;
}

function truncate(value: unknown, maxChars: number): string {
    return String(value ?? '').trim().slice(0, maxChars);
}

function sanitizeMetadata(value: Record<string, unknown>, maxStringChars: number): Record<string, unknown> {
    const allowed: Record<string, unknown> = {};
    for (const key of [
        'semanticScore',
        'impactScore',
        'retainedSourceSelectionImpact',
        'reviewDecision',
        'reviewApplied',
    ]) {
        const next = value[key];
        if (typeof next === 'string') {
            allowed[key] = truncate(next, maxStringChars);
        } else if (typeof next === 'number' || typeof next === 'boolean' || next === null) {
            allowed[key] = next;
        }
    }
    return allowed;
}
