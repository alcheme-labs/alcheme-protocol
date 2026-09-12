import { authenticatedApiFetchJson } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export interface OperatorCapabilitySuspensionReadback {
    effectId: string;
    state: 'ratification_required' | 'active' | 'expired' | 'revoked' | 'superseded';
    receiptId: string;
    appealRef: string | null;
    contractVersion: 'operator-capability-suspension-current';
    targetCircleId: number;
    targetOperatorPubkey: string;
    targetActionType: string;
    targetSubjectType: string;
    targetSubjectRef: string;
    durationSeconds: number;
    expiresAt: string;
    automaticExpiry: 'scheduler_and_read_reconciliation';
    automaticExecution: false;
    permanentRevoke: false;
    roleChange: false;
    ratificationRequired: true;
    sourceReportId: string | null;
    ratificationCaseId: string | null;
    ratificationAuthority: {
        status: 'available' | 'blocked_no_independent_authority';
        reason: 'independent_committee_unavailable' | 'subject_conflict' | null;
        authorityBindingId: string | null;
        committeeCircleId: number | null;
    };
    events: Array<{
        sequence: number;
        fromState: string | null;
        toState: string;
        reasonCode: string;
        occurredAt: string;
    }>;
}

export async function fetchOperatorCapabilitySuspensions(
    circleId: number,
    targetOperatorPubkey: string,
) {
    const route = await resolveNodeRoute('governance');
    const query = new URLSearchParams({ targetOperatorPubkey });
    return authenticatedApiFetchJson<{
        schemaVersion: 1;
        circleId: number;
        targetOperatorPubkey: string;
        readScope: 'target_subject' | 'circle_manager' | 'issuing_operator_receipts_only';
        suspensions: OperatorCapabilitySuspensionReadback[];
    }>(`${route.urlBase}/api/v1/circles/${circleId}/operator-capability-suspensions?${query.toString()}`);
}

export async function suspendOperatorCapability(circleId: number, input: {
    targetOperatorPubkey: string;
    targetActionType: string;
    targetSubjectType: string;
    targetSubjectRef: string;
    durationSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
    sourceReportId?: string | null;
    ratificationCaseId?: string | null;
}) {
    return postOperatorCapabilitySuspension<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        suspension: OperatorCapabilitySuspensionReadback;
    }>(circleId, 'operator-capability-suspensions', input);
}

export async function openOperatorCapabilityRatificationCase(
    circleId: number,
    effectId: string,
    idempotencyKey: string,
) {
    return postOperatorCapabilitySuspension<{
        ok: true;
        replayed: boolean;
        governanceCase: { id: string };
    }>(
        circleId,
        `operator-capability-suspensions/${encodeURIComponent(effectId)}/ratification-cases`,
        { idempotencyKey },
    );
}

async function postOperatorCapabilitySuspension<T>(
    circleId: number,
    path: string,
    input: object,
): Promise<T> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson<T>(`${route.urlBase}/api/v1/circles/${circleId}/${path}`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}
