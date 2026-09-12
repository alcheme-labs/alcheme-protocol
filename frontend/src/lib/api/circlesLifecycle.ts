import { authenticatedApiFetchJson } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import type { CircleGovernanceRequest } from '@/lib/api/governance';

export type CircleLifecycleAction = 'archive' | 'restore' | 'dissolve' | 'merge';

export interface CircleLifecycleCircle {
    id: number;
    lifecycleStatus: 'Active' | 'Archived' | 'ForkPending' | 'MergePending' | 'Merged' | 'DissolutionPending' | string;
    archivedAt: string | null;
    archivedByPubkey: string | null;
    archiveReason: string | null;
}

export interface CircleLifecyclePlanReadback {
    id: string;
    circleId: number;
    action: CircleLifecycleAction;
    fromLifecycleState: 'active' | 'archived';
    targetLifecycleState: 'active' | 'archived' | 'dissolution_pending' | 'merged';
    status: 'awaiting_wallet' | 'reconciliation_pending' | 'converged' | 'dissolution_pending' | 'merge_pending' | 'merged' | 'blocked';
    stateVersion: number;
    governingRequestId: string;
    governanceExecutionReceiptId: string;
    blockerCodes: string[];
    planDigest: string;
    reconciliationDigest: string;
    reconciliation: Record<string, unknown>;
    dispositionSnapshot: CircleLifecycleDispositionSnapshot;
    dissolutionPolicy: Record<string, unknown> | null;
    mergePolicy: Record<string, unknown> | null;
    sourceCircleIds: number[];
    updatedAt: string | null;
}

export interface CircleMergeDispositionInput {
    successorCircleId: number;
    membershipDisposition: 'reconsent' | 'reapply' | 'not_migrated';
    contentDisposition: 'copy_authorized' | 'reference_only' | 'not_migrated';
    crossInstitutionDisclosureImpact: {
        status: 'none' | 'notice_required';
        noticeRef?: string | null;
    };
    exitWindowEndsAt: string;
    exportWindowEndsAt: string;
    conflicts: {
        identity: { status: 'no_conflict' | 'resolved'; evidenceRef?: string | null };
        resource: { status: 'no_resources' | 'resolved_by_p06'; evidenceRef?: string | null };
        mandate: { status: 'no_conflict' | 'resolved'; evidenceRef?: string | null };
        privacy: { status: 'no_conflict' | 'resolved'; evidenceRef?: string | null };
    };
}

export async function submitCircleMergeSourceApproval(input: {
    sourceCircleId: number;
    mergeDisposition?: CircleMergeDispositionInput | null;
    governanceRequestId?: string | null;
}): Promise<any> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${input.sourceCircleId}/lifecycle/merge/source-approval`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mergeDisposition: input.mergeDisposition ?? null,
                    governanceRequestId: input.governanceRequestId ?? null,
                }),
            },
        },
    );
}

export async function submitCircleMergeSuccessorAcceptance(input: {
    successorCircleId: number;
    sourceApprovalRequestIds?: string[];
    governanceRequestId?: string | null;
    reason?: string | null;
}): Promise<any> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${input.successorCircleId}/lifecycle/merge/accept`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceApprovalRequestIds: input.sourceApprovalRequestIds ?? [],
                    governanceRequestId: input.governanceRequestId ?? null,
                    reason: input.reason ?? null,
                }),
            },
        },
    );
}

export async function finalizeCircleMerge(input: {
    successorCircleId: number;
    governanceRequestId: string;
}): Promise<any> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${input.successorCircleId}/lifecycle/merge/finalize`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ governanceRequestId: input.governanceRequestId }),
            },
        },
    );
}

export interface CircleLifecycleDispositionSnapshot {
    inventoryComplete: boolean;
    entries: Array<{
        kind: string;
        ref: string;
        state: string;
        disposition: 'continue' | 'suspend' | 'cancel' | 'manual_resolution';
    }>;
    externalResources: {
        disposition: 'manual_resolution';
        status: string;
        ownerPackage: 'P06';
    };
}

export interface CircleLifecycleTimelineExport {
    kind: 'governance_home_lifecycle_timeline_export';
    circleId: number;
    homeIdentityBindingId: string;
    lifecyclePlanId: string;
    planDigest: string;
    events: Array<{
        sequence: number;
        type: string;
        occurredAt: string;
        facts: Record<string, unknown>;
    }>;
    externalAuthority: {
        status: 'p06_authoritative_readback_required' | 'p06_authoritative_readback_converged';
        authoritative: boolean;
        ownerPackage: 'P06';
    };
    exportedAt: string;
    exportDigest: string;
}

export async function submitCircleLifecycleAction(input: {
    circleId: number;
    action: CircleLifecycleAction;
    reason?: string | null;
    transactionSignature?: string | null;
    governanceRequestId?: string | null;
    exitWindowEndsAt?: string | null;
    retentionSuccessorHomeIdentityBindingId?: string | null;
}): Promise<{
    status: 'requires_governance' | 'requires_wallet_transaction' | 'reconciliation_pending' | 'converged' | 'dissolution_pending' | 'blocked';
    actionType: string;
    chainAction?: 'archive' | 'restore';
    circle?: CircleLifecycleCircle;
    request?: CircleGovernanceRequest;
    plan?: CircleLifecyclePlanReadback;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/circles/${input.circleId}/lifecycle/${input.action}`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                reason: input.reason ?? null,
                transactionSignature: input.transactionSignature ?? null,
                governanceRequestId: input.governanceRequestId ?? null,
                exitWindowEndsAt: input.exitWindowEndsAt ?? null,
                retentionSuccessorHomeIdentityBindingId:
                    input.retentionSuccessorHomeIdentityBindingId ?? null,
            }),
        },
    });
    const status = String(data?.status || '');
    if (!['requires_governance', 'requires_wallet_transaction', 'reconciliation_pending', 'converged', 'dissolution_pending', 'blocked'].includes(status)) {
        throw new Error('invalid_circle_lifecycle_response');
    }
    const plan = data?.plan ? normalizePlan(data.plan) : undefined;
    if (status === 'converged') {
        const reconciliation = plan?.reconciliation && typeof plan.reconciliation === 'object'
            ? plan.reconciliation as Record<string, any>
            : null;
        const chain = reconciliation?.chain && typeof reconciliation.chain === 'object'
            ? reconciliation.chain
            : null;
        const indexer = reconciliation?.indexer && typeof reconciliation.indexer === 'object'
            ? reconciliation.indexer
            : null;
        const finalityPolicy = reconciliation?.finalityPolicy
            && typeof reconciliation.finalityPolicy === 'object'
            ? reconciliation.finalityPolicy
            : null;
        if (
            !plan
            || plan.status !== 'converged'
            || chain?.commitment !== 'finalized'
            || chain?.authoritative !== true
            || indexer?.status !== 'converged'
            || indexer?.authoritative !== true
            || finalityPolicy?.satisfied !== true
        ) {
            throw new Error('invalid_circle_lifecycle_convergence_readback');
        }
    }
    return {
        status: status as 'requires_governance' | 'requires_wallet_transaction' | 'reconciliation_pending' | 'converged' | 'dissolution_pending' | 'blocked',
        actionType: String(data?.actionType || ''),
        chainAction: data?.chainAction === 'restore' ? 'restore' : data?.chainAction === 'archive' ? 'archive' : undefined,
        circle: data?.circle ? normalizeCircle(data.circle) : undefined,
        request: data?.request ?? undefined,
        plan,
    };
}

export async function readCircleLifecycle(circleId: number): Promise<{
    circle: CircleLifecycleCircle;
    plan: CircleLifecyclePlanReadback | null;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${circleId}/lifecycle`,
    );
    if (!data?.circle) throw new Error('invalid_circle_lifecycle_readback');
    return {
        circle: normalizeCircle(data.circle),
        plan: data?.plan ? normalizePlan(data.plan) : null,
    };
}

export async function exportCircleLifecycleTimeline(
    circleId: number,
): Promise<CircleLifecycleTimelineExport> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${circleId}/lifecycle/export`,
    );
    const value = data?.timeline;
    const authoritative = value?.externalAuthority?.authoritative === true;
    const authorityStatus = authoritative
        ? 'p06_authoritative_readback_converged'
        : value?.externalAuthority?.status === 'p06_authoritative_readback_required'
            ? 'p06_authoritative_readback_required'
            : null;
    if (
        value?.kind !== 'governance_home_lifecycle_timeline_export'
        || !Array.isArray(value?.events)
        || value?.externalAuthority?.ownerPackage !== 'P06'
        || !authorityStatus
        || value?.externalAuthority?.authoritative !== authoritative
    ) throw new Error('invalid_circle_lifecycle_timeline_export');
    return {
        kind: value.kind,
        circleId: Number(value.circleId),
        homeIdentityBindingId: String(value.homeIdentityBindingId || ''),
        lifecyclePlanId: String(value.lifecyclePlanId || ''),
        planDigest: String(value.planDigest || ''),
        events: value.events.map((event: any) => ({
            sequence: Number(event.sequence),
            type: String(event.type || ''),
            occurredAt: String(event.occurredAt || ''),
            facts: event.facts && typeof event.facts === 'object' ? event.facts : {},
        })),
        externalAuthority: {
            status: authorityStatus,
            authoritative,
            ownerPackage: 'P06',
        },
        exportedAt: String(value.exportedAt || ''),
        exportDigest: String(value.exportDigest || ''),
    };
}

function normalizeCircle(value: any): CircleLifecycleCircle {
    return {
        id: Number(value?.id || 0),
        lifecycleStatus: String(value?.lifecycleStatus || 'Active'),
        archivedAt: value?.archivedAt ? String(value.archivedAt) : null,
        archivedByPubkey: value?.archivedByPubkey ? String(value.archivedByPubkey) : null,
        archiveReason: value?.archiveReason ? String(value.archiveReason) : null,
    };
}

function normalizePlan(value: any): CircleLifecyclePlanReadback {
    const action = value?.action === 'restore'
        ? 'restore'
        : value?.action === 'archive'
            ? 'archive'
            : value?.action === 'dissolve'
                ? 'dissolve'
                : value?.action === 'merge'
                    ? 'merge'
                : null;
    const status = ['awaiting_wallet', 'reconciliation_pending', 'converged', 'dissolution_pending', 'merge_pending', 'merged', 'blocked'].includes(value?.status)
        ? value.status as CircleLifecyclePlanReadback['status']
        : null;
    const fromLifecycleState = value?.fromLifecycleState === 'archived' ? 'archived' : value?.fromLifecycleState === 'active' ? 'active' : null;
    const targetLifecycleState = value?.targetLifecycleState === 'archived'
        ? 'archived'
        : value?.targetLifecycleState === 'active'
            ? 'active'
            : value?.targetLifecycleState === 'dissolution_pending'
                ? 'dissolution_pending'
                : value?.targetLifecycleState === 'merged'
                    ? 'merged'
                : null;
    if (!action || !status || !fromLifecycleState || !targetLifecycleState) {
        throw new Error('invalid_circle_lifecycle_plan_readback');
    }
    const dispositionSnapshot = normalizeDispositionSnapshot(value?.dispositionSnapshot);
    return {
        id: String(value?.id || ''),
        circleId: Number(value?.circleId || 0),
        action,
        fromLifecycleState,
        targetLifecycleState,
        status,
        stateVersion: Number(value?.stateVersion || 0),
        governingRequestId: String(value?.governingRequestId || ''),
        governanceExecutionReceiptId: String(value?.governanceExecutionReceiptId || ''),
        blockerCodes: Array.isArray(value?.blockerCodes)
            ? value.blockerCodes.map((item: unknown) => String(item))
            : [],
        planDigest: String(value?.planDigest || ''),
        reconciliationDigest: String(value?.reconciliationDigest || ''),
        reconciliation: value?.reconciliation && typeof value.reconciliation === 'object'
            ? value.reconciliation
            : {},
        dispositionSnapshot,
        dissolutionPolicy: value?.dissolutionPolicy && typeof value.dissolutionPolicy === 'object'
            ? value.dissolutionPolicy
            : null,
        mergePolicy: value?.mergePolicy && typeof value.mergePolicy === 'object'
            ? value.mergePolicy
            : null,
        sourceCircleIds: Array.isArray(value?.sourceCircleIds)
            ? value.sourceCircleIds.map((item: unknown) => Number(item)).filter(Number.isInteger)
            : [],
        updatedAt: value?.updatedAt ? String(value.updatedAt) : null,
    };
}

function normalizeDispositionSnapshot(value: any): CircleLifecycleDispositionSnapshot {
    const dispositions = new Set(['continue', 'suspend', 'cancel', 'manual_resolution']);
    const entries = Array.isArray(value?.entries) ? value.entries.map((item: any) => {
        if (!item || typeof item !== 'object' || !dispositions.has(item.disposition)) {
            throw new Error('invalid_circle_lifecycle_disposition_readback');
        }
        return {
            kind: String(item.kind || ''),
            ref: String(item.ref || ''),
            state: String(item.state || ''),
            disposition: item.disposition as CircleLifecycleDispositionSnapshot['entries'][number]['disposition'],
        };
    }) : null;
    const externalResources = value?.externalResources;
    if (
        typeof value?.inventoryComplete !== 'boolean'
        || !entries
        || externalResources?.disposition !== 'manual_resolution'
        || externalResources?.ownerPackage !== 'P06'
    ) throw new Error('invalid_circle_lifecycle_disposition_readback');
    return {
        inventoryComplete: value.inventoryComplete,
        entries,
        externalResources: {
            disposition: 'manual_resolution',
            status: String(externalResources.status || ''),
            ownerPackage: 'P06',
        },
    };
}
