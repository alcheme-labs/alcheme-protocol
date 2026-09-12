import { getQueryApiBaseUrl } from '../config/queryApiBase';
import { apiFetch } from './fetch';
import type { ExternalAppCircleBinding } from './externalApps';

export interface ExternalProgramCircleBindingRequest {
    appId: string;
    circleId: number;
    bindingKind: 'primary' | 'attached';
    createdByPubkey?: string | null;
    governanceRequestId?: string | null;
    governanceDecisionDigest?: string | null;
    executionReceiptId?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface ExternalProgramKnowledgeContextItem {
    kind: 'source_material';
    id: string;
    title: string;
    summary: string | null;
    sourceId: number;
    updatedAt: string;
    permissions: {
        canDisplay: boolean;
        canQuote: boolean;
        canContinueDiscussion: boolean;
    };
}

export async function requestExternalProgramCircleBinding(
    input: ExternalProgramCircleBindingRequest,
): Promise<{
    ok: boolean;
    requiresGovernance: boolean;
    binding: ExternalAppCircleBinding;
}> {
    const response = await apiFetch(`${getQueryApiBaseUrl()}/api/v1/external-apps/${encodeURIComponent(input.appId)}/circle-bindings`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                circleId: input.circleId,
                bindingKind: input.bindingKind,
                createdByPubkey: input.createdByPubkey ?? null,
                governanceRequestId: input.governanceRequestId ?? null,
                governanceDecisionDigest: input.governanceDecisionDigest ?? null,
                executionReceiptId: input.executionReceiptId ?? null,
                metadata: input.metadata ?? null,
            }),
        },
    });
    if (!response.ok) {
        throw new Error(`external_program_circle_binding_failed:${response.status}`);
    }
    return await response.json();
}

export async function fetchExternalProgramKnowledgeContext(input: {
    appId: string;
    roomKey: string;
    walletPubkey?: string | null;
    primaryCircleId?: number | null;
    parentCircleId?: number | null;
    purpose: string;
    knowledgeContextClaim?: {
        payload: string;
        signature: string;
    } | null;
}): Promise<{
    ok: boolean;
    items: ExternalProgramKnowledgeContextItem[];
    disclaimer: {
        notEndorsement: boolean;
        operatorResponsible: boolean;
    };
}> {
    const response = await apiFetch(`${getQueryApiBaseUrl()}/api/v1/external-apps/${encodeURIComponent(input.appId)}/knowledge-context`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                roomKey: input.roomKey,
                walletPubkey: input.walletPubkey ?? null,
                primaryCircleId: input.primaryCircleId ?? null,
                parentCircleId: input.parentCircleId ?? null,
                requestedCapability: 'knowledge_context',
                purpose: input.purpose,
                knowledgeContextClaim: input.knowledgeContextClaim ?? null,
            }),
        },
    });
    if (!response.ok) {
        throw new Error(`external_program_knowledge_context_failed:${response.status}`);
    }
    return await response.json();
}
