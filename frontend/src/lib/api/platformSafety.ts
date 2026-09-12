import { apiFetchJson, authenticatedApiFetchJson } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export type PlatformSafetyRole =
    | 'platform_safety_policy_admin'
    | 'platform_safety_case_responder'
    | 'platform_safety_emergency_responder'
    | 'platform_safety_appeal_reviewer'
    | 'platform_safety_audit_reviewer'
    | 'platform_safety_legal_operator'
    | 'platform_safety_legal_appeal_reviewer';

export interface PlatformSafetyPolicy {
    schemaVersion: 1;
    configured: boolean;
    environment: 'sandbox';
    jurisdiction: 'US';
    minimumAge: 18;
    assetMode: 'devnet_test_assets_only';
    policy: null | {
        id: string;
        versionId: string;
        version: number;
        digest: string;
        rules: {
            taxonomy: { categories: Array<{ code: string; minimumSeverity: 'sev2' | 'sev1' }> };
            quarantine: {
                minimumDurationSeconds: number;
                maximumDurationSeconds: number;
                publicProjection: string;
                expiry: string;
            };
            automation: {
                ruleVersion: string;
                modelVersion: string;
                signalMode: 'advisory_only';
                automatedEnforcement: false;
                batchMaximumSubjects: number;
                samplingRequired: true;
                sampling: { required: true; minimumRate: number; reviewerRole: PlatformSafetyRole };
                rollback: string;
                appeal: string;
                killSwitch: { state: 'active'; effect: string; ownerRole: PlatformSafetyRole };
                permanentDispositionByModelSignal: false;
                thresholds: {
                    quarantineCandidate: string;
                    legalEscalationCandidate: string;
                    permanentDisposition: 'forbidden';
                };
            };
        };
    };
    incidentPolicy: null | {
        id: string;
        versionId: string;
        version: number;
        digest: string;
        rules: {
            declaration: {
                activationWindowSeconds: number;
                minimumDurationSeconds: number;
                maximumDurationSeconds: number;
            };
            authority: { createsNewAuthority: false; allowedEmergencyActions: string[] };
            breakGlass: {
                targetTypes: string[];
                predefinedEvents: string[];
                requestRole: PlatformSafetyRole;
                approvalRole: PlatformSafetyRole;
                distinctActorsRequired: true;
                minimumDurationSeconds: number;
                maximumDurationSeconds: number;
                alertRequired: true;
                afterActionReviewRequired: true;
                automaticExpiry: true;
                dailyOperatorPermission: false;
                originalMaterialExport: false;
            };
            review: { requiredAfterActivation: true; dueSecondsAfterEnd: number };
        };
    };
    roles: Array<{ roleKey: PlatformSafetyRole; status: 'bound' | 'unavailable' }>;
}

export interface PlatformSafetySafetyIncident {
    id: string;
    policyVersionId: string;
    policyDigest: string;
    targetCircleId: number;
    category: string;
    severity: 'sev2' | 'sev1';
    commanderPubkey: string;
    scope: {
        targetType: 'single_circle';
        targetCircleId: number;
        category?: string;
        categories?: string[];
        severity: 'sev2' | 'sev1';
        mergedIncidentIds?: string[];
    };
    maxDurationSeconds: number;
    state: 'pending_approval' | 'active' | 'rejected' | 'review_required' | 'closed' | 'expired';
    evidenceDigest: string;
    declarationReceiptId: string;
    declarationEffectId: string;
    activationDeadline: string;
    activatedAt: string | null;
    expiresAt: string | null;
    endedAt: string | null;
    reviewDueAt: string | null;
    reviewedAt: string | null;
    reviewOverdue: boolean;
    createsNewAuthority: false;
    activationAppeal: null | {
        id: string;
        state: string;
        appellantPubkey: string;
        openedAt: string;
        resolution: null | {
            outcome: string;
            reviewerPubkey: string;
            resolvedAt: string;
        };
    };
    events: Array<{
        id: string;
        sequence: number;
        kind: string;
        actorPubkey: string | null;
        fromState: string | null;
        toState: string;
        receiptId: string | null;
        effectId: string | null;
        reasonCode: string;
        evidenceDigest: string;
        occurredAt: string;
        eventDigest: string;
    }>;
}

export interface PlatformSafetyIncident {
    incidentRef: string;
    contentId: string;
    circleId: number;
    category: string;
    severity: 'sev2' | 'sev1';
    state: string;
    activatedAt: string;
    expiresAt: string;
    receiptId: string;
    effectId: string;
    appealRef: string | null;
    appeal: null | {
        id: string;
        state: string;
        appellantPubkey: string;
        resolutionPath: 'independent_review' | 'governance_case';
        openedAt: string;
        resolution: null | {
            outcome: string;
            reviewerPubkey: string;
            resolvedAt: string;
        };
    };
}

export interface PlatformSafetyLegalStatus {
    contentId: string;
    circleId: number;
    status: 'legal_hold' | 'legal_takedown' | 'legal_redaction' | 'retention_authorized' | 'destruction_authorized';
    state: string;
    jurisdiction: 'US';
    receiptId: string;
    receiptDigest: string;
    effectId: string;
    effectDigest: string;
    legalStatusDigest: string;
    previousLegalStatusDigest: string | null;
    authorityDigest: string;
    publicTombstoneDigest: string;
    redactedSummaryDigest: string;
    lifecyclePlanDigest: string;
    legalSafeProjection: {
        ordinaryRead: 'legal_status_notice' | 'legal_tombstone';
        listRead: 'legal_status_notice' | 'excluded';
        originalMaterialExport: false;
        circleGovernanceMayRestoreOriginal: false;
    };
    noticeRequired: boolean;
    appealWindowSeconds: number;
    appealWindowEndsAt: string | null;
    appendedAt: string;
    publicExport: false;
    aiExport: false;
    knowledgeExport: false;
}

export interface PlatformSafetyBreakGlassAccess {
    id: string;
    state: string;
    receiptId: string;
    receiptDigest: string;
    evidenceReceiptId: string;
    evidenceEffectId: string;
    evidenceSubjectType: string;
    evidenceSubjectRef: string;
    evidenceSourceDigest: string;
    safetyIncidentId: string;
    requesterPubkey: string;
    approverPubkey: string;
    purposeCode: string;
    accessJustificationDigest: string;
    requestedAt: string;
    approvedAt: string;
    actualAccessRecordedAt: string;
    expiresAt: string;
    durationSeconds: number;
    ordinaryOperatorPermission: false;
    originalMaterialExport: false;
    rawEvidenceIncludedInReceipt: false;
    searchableAuditOnly: true;
    alertRequired: true;
    alertRecipients: string[];
    afterActionReviewRequired: true;
    incidentReviewRequired: true;
    events: Array<{
        sequence: number;
        fromState: string | null;
        toState: string;
        reasonCode: string;
        occurredAt: string;
    }>;
}

export interface PlatformSafetyWorkspace {
    schemaVersion: 1;
    viewer: { pubkey: string; roles: PlatformSafetyRole[] };
    policy: PlatformSafetyPolicy;
    incidents: PlatformSafetyIncident[];
    legalStatuses: PlatformSafetyLegalStatus[];
    breakGlassAccesses: PlatformSafetyBreakGlassAccess[];
}

async function platformSafetyBase(): Promise<string> {
    const route = await resolveNodeRoute('platform_safety');
    return `${route.urlBase}/api/v1/platform-safety`;
}

export async function fetchPlatformSafetyPolicy(): Promise<PlatformSafetyPolicy> {
    return apiFetchJson<PlatformSafetyPolicy>(`${await platformSafetyBase()}/policy`);
}

export async function fetchPlatformSafetyWorkspace(): Promise<PlatformSafetyWorkspace> {
    return authenticatedApiFetchJson<PlatformSafetyWorkspace>(`${await platformSafetyBase()}/workspace`);
}

export async function bootstrapPlatformSafety(input: {
    policyAdminCircleId: number;
    caseResponderCircleId: number;
    emergencyResponderCircleId: number;
    appealReviewCircleId: number;
    auditReviewCircleId: number;
    legalOperatorCircleId: number;
    legalAppealCircleId: number;
}) {
    return authenticatedApiFetchJson(`${await platformSafetyBase()}/bootstrap`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function proposePlatformSafetyAuthorityChange(input: {
    targetRoleKey: PlatformSafetyRole;
    targetCircleId: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    excludedActorPubkeys?: string[];
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        proposal: {
            targetRoleKey: PlatformSafetyRole;
            targetCircleId: number;
            proposalReceiptId: string;
            proposalEffectId: string;
            state: string;
            effectiveAt: string;
        };
    }>(`${await platformSafetyBase()}/authority-change-proposals`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function approvePlatformSafetyAuthorityChange(proposalReceiptId: string, input: {
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        binding: {
            id: string;
            roleKey: PlatformSafetyRole;
            circleId: number;
            policyVersionId: string;
            status: string;
        };
        approval: {
            proposalReceiptId: string;
            targetRoleKey: PlatformSafetyRole;
            previousBindingId: string;
            bindingId: string;
            effectiveAt: string;
        };
    }>(`${await platformSafetyBase()}/authority-change-proposals/${encodeURIComponent(proposalReceiptId)}/approval`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function capturePlatformSafetyEvidence(input: {
    subjectType: 'report_url' | 'screenshot' | 'attachment' | 'feed_post_snapshot';
    subjectRef: string;
    sourceDigest: string;
    malwareScanStatus: 'clean' | 'blocked' | 'not_applicable';
    piiRedactionStatus: 'none' | 'redacted' | 'blocked';
    retentionSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        capture: {
            subjectType: string;
            subjectRef: string;
            state: string;
            effectId: string;
            sourceDigest: string;
            retentionExpiresAt: string;
            publicExport: false;
            aiExport: false;
            knowledgeExport: false;
        };
    }>(`${await platformSafetyBase()}/evidence-captures`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function recordPlatformSafetyBreakGlassAccess(evidenceReceiptId: string, input: {
    requesterPubkey: string;
    safetyIncidentId: string;
    purposeCode: string;
    accessJustificationDigest: string;
    durationSeconds: number;
    idempotencyKey: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        access: PlatformSafetyBreakGlassAccess;
    }>(`${await platformSafetyBase()}/evidence-captures/${encodeURIComponent(evidenceReceiptId)}/break-glass-accesses`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function appendPlatformSafetyLegalStatus(input: {
    contentId: string;
    status: PlatformSafetyLegalStatus['status'];
    jurisdiction: 'US';
    authorityDigest: string;
    publicTombstoneDigest: string;
    redactedSummaryDigest: string;
    lifecyclePlanDigest: string;
    noticeRequired: boolean;
    appealWindowSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        legalStatus: PlatformSafetyLegalStatus;
    }>(`${await platformSafetyBase()}/legal-statuses`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function openPlatformSafetyLegalStatusAppeal(contentId: string, input: {
    reasonCode: string;
    evidenceDigest: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        appeal: {
            id: string;
            originalReceiptId: string;
            state: 'open';
            resolutionPath: 'independent_review';
        };
    }>(`${await platformSafetyBase()}/legal-statuses/${encodeURIComponent(contentId)}/appeals`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function quarantinePlatformSafetyPost(input: {
    circleId: number;
    contentId: string;
    category: string;
    severity: 'sev2' | 'sev1';
    durationSeconds: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    safetyIncidentId?: string | null;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        incident: PlatformSafetyIncident;
    }>(`${await platformSafetyBase()}/quarantines`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function releasePlatformSafetyPost(contentId: string, input: {
    circleId: number;
    reasonCode: string;
    idempotencyKey: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        receipt: { id: string };
        release: {
            contentId: string;
            originalEffectId: string;
            releaseEffectId: string;
            state: 'released';
            releasedAt: string;
        };
    }>(`${await platformSafetyBase()}/quarantines/${encodeURIComponent(contentId)}/release`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function openPlatformSafetyAppeal(contentId: string, input: {
    reasonCode: string;
    evidenceDigest: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        appeal: {
            id: string;
            originalReceiptId: string;
            state: 'open';
            resolutionPath: 'independent_review';
        };
    }>(`${await platformSafetyBase()}/quarantines/${encodeURIComponent(contentId)}/appeals`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function resolvePlatformSafetyAppeal(appealId: string, input: {
    outcome: 'uphold' | 'revoke';
    reasonCode: string;
    evidenceDigest: string;
}) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        resolutionReceipt: { id: string };
        appeal: {
            id: string;
            contentId: string;
            outcome: 'uphold' | 'revoke';
            state: 'resolved';
            postRestored: boolean;
        };
    }>(`${await platformSafetyBase()}/appeals/${encodeURIComponent(appealId)}/resolution`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function fetchPlatformSafetyIncidents(): Promise<PlatformSafetySafetyIncident[]> {
    const result = await authenticatedApiFetchJson<{
        schemaVersion: 1;
        incidents: PlatformSafetySafetyIncident[];
    }>(`${await platformSafetyBase()}/incidents`);
    return result.incidents;
}

export async function declarePlatformSafetyIncident(input: {
    targetCircleId: number;
    category: string;
    severity: 'sev2' | 'sev1';
    maxDurationSeconds: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
}) {
    return incidentAction(`${await platformSafetyBase()}/incidents`, input);
}

export async function resolvePlatformSafetyIncidentActivation(
    incidentId: string,
    input: {
        outcome: 'approve' | 'reject';
        reasonCode: string;
        evidenceDigest: string;
        idempotencyKey: string;
    },
) {
    return incidentAction(
        `${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/activation`,
        input,
    );
}

export async function openPlatformSafetyIncidentActivationAppeal(
    incidentId: string,
    input: {
        reasonCode: string;
        evidenceDigest: string;
    },
) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        appeal: { id: string; state: string; resolutionPath: string };
        incident: PlatformSafetySafetyIncident;
    }>(`${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/activation-appeals`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function resolvePlatformSafetyIncidentActivationAppeal(
    appealId: string,
    input: {
        outcome: 'uphold' | 'revoke';
        reasonCode: string;
        evidenceDigest: string;
    },
) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        resolutionReceipt: { id: string };
        incident: PlatformSafetySafetyIncident;
    }>(`${await platformSafetyBase()}/incident-activation-appeals/${encodeURIComponent(appealId)}/resolution`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function closePlatformSafetyIncident(
    incidentId: string,
    input: {
        reasonCode: string;
        evidenceDigest: string;
        idempotencyKey: string;
    },
) {
    return incidentAction(
        `${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/close`,
        input,
    );
}

export async function upgradePlatformSafetyIncident(
    incidentId: string,
    input: {
        severity: 'sev1';
        reasonCode: string;
        evidenceDigest: string;
        idempotencyKey: string;
    },
) {
    return incidentAction(
        `${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/upgrade`,
        input,
    );
}

export async function extendPlatformSafetyIncident(
    incidentId: string,
    input: {
        additionalDurationSeconds: number;
        reasonCode: string;
        evidenceDigest: string;
        idempotencyKey: string;
    },
) {
    return incidentAction(
        `${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/extend`,
        input,
    );
}

export async function mergePlatformSafetyIncidents(
    incidentId: string,
    input: {
        sourceIncidentId: string;
        reasonCode: string;
        evidenceDigest: string;
        idempotencyKey: string;
    },
) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        incident: PlatformSafetySafetyIncident;
        mergedIncident: PlatformSafetySafetyIncident;
    }>(`${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/merge`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    });
}

export async function reviewPlatformSafetyIncident(
    incidentId: string,
    input: {
        reasonCode: string;
        evidenceDigest: string;
        idempotencyKey: string;
    },
) {
    return incidentAction(
        `${await platformSafetyBase()}/incidents/${encodeURIComponent(incidentId)}/review`,
        input,
    );
}

async function incidentAction(url: string, body: Record<string, unknown>) {
    return authenticatedApiFetchJson<{
        ok: true;
        replayed: boolean;
        incident: PlatformSafetySafetyIncident;
    }>(url, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
    });
}
