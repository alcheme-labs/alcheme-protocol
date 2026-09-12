import { authenticatedApiFetchJson } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export interface FeedGovernanceCapability {
    canOperate: boolean;
    actions: {
        updatePolicy: boolean;
        startExperiment: boolean;
        stopExperiment: boolean;
        downrankContent: boolean;
    };
    reason: string | null;
    committeeCircleIds: {
        updatePolicy: number | null;
        startExperiment: number | null;
        stopExperiment: number | null;
        downrankContent: number | null;
    };
}

export interface FeedRankingPolicyReadback {
    id: string;
    circleId: number;
    version: number;
    status: 'active' | 'superseded';
    signalKeys: string[];
    defaultFactorBps: number;
    maxDurationSeconds: number;
    maxActiveRatioBps: number;
    policyApplication: 'prospective_only';
    aiActivation: false;
    rollback: 'superseding_version_and_effect_expiry';
    configDigest: string;
    sourceReceiptId: string;
    activatedAt: string;
}

export interface FeedRecommendationExperimentReadback {
    experimentId: string;
    circleId: number;
    state: 'active' | 'stopped' | 'expired';
    policyId: string;
    policyVersion: number;
    policyConfigDigest: string;
    targetRatioBps: number;
    durationSeconds: number;
    startedAt: string;
    expiresAt: string;
    aiActivation: false;
    effectId: string;
    receiptId: string;
}

export interface FeedPolicyReEvaluationReadback {
    contentId: string;
    receiptId: string;
    effectId: string;
    authority: {
        bindingId: string;
        sourceType: string;
        sourceRef: string;
        sourceVersion: string | null;
        decisionPath: string;
        policyVersionRef: string;
    };
    appeal: {
        ref: string | null;
        deadline: string | null;
        submission: { method: 'POST'; path: string };
    };
    state: 'adjusted';
    factorBps: number;
    expiresAt: string;
    replayed: boolean;
}

export interface ContentDownrankAppealAccessReadback {
    contentId: string;
    state: { state: 'normal' | 'adjusted'; factorBps: number | null; expiresAt: string | null };
    receipt: { id: string; receiptDigest: string; completedAt: string };
    effect: {
        id: string;
        state: string;
        events: Array<{ sequence: number; toState: string; reasonCode: string; occurredAt: string }>;
    };
    authority: {
        bindingId: string;
        sourceType: string;
        sourceRef: string;
        sourceVersion: string | null;
        policyVersionRef: string;
        decisionPath: string;
    };
    appealAccess: {
        access: 'canonical_post_author_session';
        membershipRequired: false;
        grantsOtherCirclePermissions: false;
        evidenceVisibility: 'appellant_and_independent_resolver_only';
        deadline: string;
        status: string;
        canSubmit: boolean;
        appeal: null | {
            id: string;
            state: string;
            governanceCaseRef: string | null;
            governanceCaseUrl: string | null;
            appealResolutionArtifactRef: string | null;
        };
    };
}

export async function fetchContentDownrankAppealAccess(circleId: number, contentId: string) {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson<{
        ok: true;
        adjustment: ContentDownrankAppealAccessReadback | null;
    }>(`${route.urlBase}/api/v1/circles/${circleId}/posts/${encodeURIComponent(contentId)}/downrank-appeal-access`);
}

export async function submitContentDownrankAppeal(circleId: number, contentId: string, input: {
    originalReceiptId: string;
    reasonCode: string;
    evidence: Record<string, unknown>;
}) {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        appeal: {
            id: string;
            state: string;
            governanceCaseRef: string | null;
        };
    }>(`${route.urlBase}/api/v1/circles/${circleId}/posts/${encodeURIComponent(contentId)}/downrank-appeals`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function fetchFeedGovernance(circleId: number) {
    const route = await resolveNodeRoute('governance');
    const [policy, experiments] = await Promise.all([
        authenticatedApiFetchJson<{
            ok: true;
            policy: FeedRankingPolicyReadback | null;
            capability: FeedGovernanceCapability;
        }>(`${route.urlBase}/api/v1/circles/${circleId}/feed-ranking-policy`),
        authenticatedApiFetchJson<{
            ok: true;
            experiments: FeedRecommendationExperimentReadback[];
        }>(`${route.urlBase}/api/v1/circles/${circleId}/feed-recommendation-experiments`),
    ]);
    return {
        policy: policy.policy,
        capability: policy.capability,
        experiments: experiments.experiments,
    };
}

export async function updateFeedRankingPolicy(circleId: number, input: {
    signalKeys: string[];
    defaultFactorBps: number;
    maxDurationSeconds: number;
    maxActiveRatioBps: number;
    applicationMode?: 'prospective_only' | 're_evaluate_existing_content';
    reEvaluateContentIds?: string[];
    reEvaluateDurationSeconds?: number | null;
    reasonCode: string;
    idempotencyKey: string;
}) {
    return postFeedGovernance<{
        ok: true;
        replayed: boolean;
        policy: FeedRankingPolicyReadback;
        receipt: { id: string };
        application: {
            mode: 'prospective_only' | 're_evaluate_existing_content';
            contentIds: string[];
            durationSeconds: number | null;
        };
        reEvaluation: FeedPolicyReEvaluationReadback[];
        reEvaluationFailures: Array<{ contentId: string; error: string }>;
        reEvaluationStatus: 'not_requested' | 'succeeded' | 'partial' | 'failed';
    }>(circleId, 'feed-ranking-policy', input);
}

export async function startFeedExperiment(circleId: number, input: {
    targetRatioBps: number;
    durationSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
}) {
    return postFeedGovernance<{
        ok: true;
        replayed: boolean;
        experiment: FeedRecommendationExperimentReadback;
        receipt: { id: string };
    }>(circleId, 'feed-recommendation-experiments/start', input);
}

export async function stopFeedExperiment(circleId: number, receiptId: string, input: {
    reasonCode: string;
    idempotencyKey: string;
}) {
    return postFeedGovernance<{
        ok: true;
        replayed: boolean;
        experiment: FeedRecommendationExperimentReadback;
        receipt: { id: string };
    }>(circleId, `feed-recommendation-experiments/${encodeURIComponent(receiptId)}/stop`, input);
}

async function postFeedGovernance<T>(circleId: number, path: string, input: object): Promise<T> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson<T>(`${route.urlBase}/api/v1/circles/${circleId}/${path}`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}
