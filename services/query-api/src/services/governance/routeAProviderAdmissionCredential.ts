import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { buildCredentialEnvelope } from '../appTrustRoot/credentialEnvelope';
import {
    buildProductionOfflineVerificationBundle,
    signProductionCredentialEnvelope,
    type ProductionCredentialContext,
    type ProductionSignedCredential,
} from '../appTrustRoot/productionCredential';
import { resolveGovernanceProductionCredentialContext } from '../appTrustRoot/productionCredentialRegistry';
import { digestJson } from '../hostedApps/digest';
import {
    buildGovernanceManualExecutionPlanArtifact,
    computeDecisionOutputArtifactDigest,
} from './decisionOutputArtifact';
import { resolveGovernanceCaseActionDefinitionForDecision } from './governanceCaseActionComposition';
import { isRouteAProviderAdmissionCredentialRequireChainAnchors } from '../../config/services';
import { GovernanceCaseWorkflowError } from './governanceCaseWorkflow';

const PROFILE_ID = 'storage-fabric-provider-admission-route-a-v1';
const CREDENTIAL_TYPE = 'GovernanceDecisionReceipt';
const SCHEMA_REF = 'governance_decision.v1';
const POLICY_REF = 'alcheme-governance-provider-admission.v1';
const ACTION_TYPE = 'storage_fabric.authorize_provider_admission';
const ACTION_VERSION = 'v1';
const TARGET_REF = 'storage-fabric:provider-registry:devnet-demo';
const SCOPE_REF = 'circle:108:provider-admission:v1';
const REPLAY_DOMAIN = 'storage-fabric:provider-admission:devnet';

export interface RouteAProviderAdmissionCredentialSubmission {
    schemaVersion: 'ExternalCredentialSubmission/v1';
    profileId: 'storage-fabric-provider-admission-route-a-v1';
    credentialJws: string;
    offlineVerificationBundle: Record<string, unknown>;
    governanceDecisionReceipt: Record<string, unknown>;
    operationPayload: Record<string, unknown>;
    operationPayloadDigest: string;
    statePrecondition: Record<string, unknown>;
    statePreconditionDigest: string;
}

interface RouteADependencies {
    now: () => Date;
    resolveContext: typeof resolveGovernanceProductionCredentialContext;
    signCredential: typeof signProductionCredentialEnvelope;
    buildOfflineBundle: typeof buildProductionOfflineVerificationBundle;
}

const defaultDependencies: RouteADependencies = {
    now: () => new Date(),
    resolveContext: resolveGovernanceProductionCredentialContext,
    signCredential: signProductionCredentialEnvelope,
    buildOfflineBundle: buildProductionOfflineVerificationBundle,
};

interface CanonicalRouteAFacts {
    caseId: string;
    requestId: string;
    decisionDigest: string;
    artifactDigest: string;
    artifactId: string;
    actionContractVersionId: string;
    actionContractDefinitionDigest: string;
    operationPayload: Record<string, unknown>;
    operationPayloadDigest: string;
    statePrecondition: Record<string, unknown>;
    statePreconditionDigest: string;
    executionNonce: string;
    receiptId: string;
    policyVersionId: string;
    validFrom: string;
    expiresAt: string;
    quorumResult: unknown;
    thresholdResult: unknown;
    vetoStatus: unknown;
}

export async function issueRouteAProviderAdmissionCredential(
    prisma: PrismaClient,
    input: { caseId: string },
    dependencies: RouteADependencies = defaultDependencies,
): Promise<RouteAProviderAdmissionCredentialSubmission> {
    const now = dependencies.now();
    const facts = await loadCanonicalRouteAFacts(prisma, input.caseId, now);
    const requireChainAnchors = isRouteAProviderAdmissionCredentialRequireChainAnchors();
    const context = await dependencies.resolveContext(prisma, {
        credentialType: CREDENTIAL_TYPE,
        schemaRef: SCHEMA_REF,
        verifierPolicyRef: POLICY_REF,
        now,
        requireChainAnchors,
    });
    const credentialId = deterministicId(
        'route-a-provider-admission-credential',
        `${facts.decisionDigest}:${context.issuerKeySetDigest}:${context.revocationSnapshotDigest}`,
    );
    const existing = await readPersistedSubmission(prisma, facts, {
        credentialId,
        now,
        requireFreshBundle: true,
    });
    if (existing) return existing;

    const unsignedReceipt = buildUnsignedReceipt(facts, context);
    const governanceReceiptDigest = digestJson(unsignedReceipt);
    const envelope = buildCredentialEnvelope({
        credentialId,
        credentialType: CREDENTIAL_TYPE,
        issuerRef: context.issuerRef,
        subjectRef: `${ACTION_TYPE}:${facts.executionNonce}`,
        audienceRef: TARGET_REF,
        scopeRef: SCOPE_REF,
        replayDomain: REPLAY_DOMAIN,
        nonce: facts.executionNonce,
        payloadDigest: governanceReceiptDigest,
        schemaRef: SCHEMA_REF,
        verifierPolicyRef: POLICY_REF,
        validFrom: facts.validFrom,
        expiresAt: facts.expiresAt,
        revocationRef: context.revocationRef,
        chainAnchorRef: null,
    });
    const credential = await dependencies.signCredential(context, envelope);
    const bundleId = deterministicId(
        'route-a-provider-admission-bundle',
        `${context.issuerKeySetDigest}:${context.revocationSnapshotDigest}:${SCHEMA_REF}:${POLICY_REF}`,
    );
    const bundle = await dependencies.buildOfflineBundle([context], {
        now,
        bundleId,
        requireChainAnchors,
        redactionPolicyRef: 'route-a-public-safe.v1',
    });

    await persistOfflineBundle(prisma, bundle);
    try {
        await (prisma as any).hostedAppCredential.create({
            data: serializeCredential(credential, context),
        });
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
    }

    const persisted = await readPersistedSubmission(prisma, facts, {
        credentialId,
        now,
        requireFreshBundle: true,
    });
    if (!persisted) {
        throw workflowError(409, 'route_a_provider_admission_credential_persistence_failed');
    }
    return persisted;
}

export async function readRouteAProviderAdmissionCredential(
    prisma: PrismaClient,
    input: { caseId: string; now?: Date },
): Promise<RouteAProviderAdmissionCredentialSubmission> {
    const now = input.now ?? new Date();
    const facts = await loadCanonicalRouteAFacts(prisma, input.caseId, now, {
        requireCurrentWindow: false,
    });
    const persisted = await readPersistedSubmission(prisma, facts, {
        now,
        // Historical readback is an audit surface. Expiry/revocation still makes
        // the bytes unusable for execution, but must not erase a previously
        // issued credential when issuance is rolled back.
        requireFreshBundle: false,
    });
    if (!persisted) {
        throw workflowError(404, 'route_a_provider_admission_credential_not_found');
    }
    return persisted;
}

async function loadCanonicalRouteAFacts(
    prisma: PrismaClient,
    caseId: string,
    now: Date,
    options: { requireCurrentWindow?: boolean } = {},
): Promise<CanonicalRouteAFacts> {
    const governanceCase = await (prisma as any).governanceCase.findUnique({
        where: { id: caseId },
        include: {
            homeIdentityBinding: { select: { homeType: true, homeRef: true } },
            primaryRequest: { include: { decision: true } },
            decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
            responsibilities: true,
            actionContractVersion: true,
        },
    });
    if (!governanceCase) throw workflowError(404, 'governance_case_not_found');
    if (
        String(governanceCase.homeIdentityBinding?.homeType || '') !== 'circle'
        || String(governanceCase.homeIdentityBinding?.homeRef || '') !== '108'
    ) {
        throw workflowError(409, 'route_a_provider_admission_circle_scope_mismatch');
    }
    const request = governanceCase.primaryRequest;
    const decision = request?.decision;
    if (!request || String(request.state || '') !== 'accepted') {
        throw workflowError(409, 'route_a_provider_admission_request_not_accepted');
    }
    if (
        String(request.actionType || '') !== ACTION_TYPE
        || String(request.targetType || '') !== 'external_provider'
    ) {
        throw workflowError(409, 'route_a_provider_admission_request_mismatch');
    }
    if (!decision || String(decision.decision || '') !== 'accepted') {
        throw workflowError(409, 'route_a_provider_admission_decision_not_accepted');
    }
    const decisionDigest = requireDigest(decision.decisionDigest, 'decision_digest');
    const { validFromDate, expiresAtDate } = resolveProviderAdmissionExecutionWindow(
        decision,
        governanceCase,
    );
    if (validFromDate >= expiresAtDate) {
        throw workflowError(409, 'route_a_provider_admission_execution_window_invalid');
    }
    if (
        options.requireCurrentWindow !== false
        && (now < validFromDate || now >= expiresAtDate)
    ) {
        throw workflowError(409, 'route_a_provider_admission_execution_window_closed');
    }
    let artifact = (governanceCase.decisionOutputArtifacts || []).find((candidate: any) =>
        String(candidate.decisionRequestId || '') === String(request.id || '')
        && normalizeDigest(String(candidate.decisionDigest || '')) === decisionDigest
        && String(candidate.kind || '') === 'manual_execution_plan'
        && String(candidate.finality || '') === 'alcheme_native_decision',
    );
    if (!artifact) {
        artifact = await ensureProviderAdmissionManualExecutionArtifact(prisma, {
            governanceCase,
            request,
            decision,
            decisionDigest,
            now,
        });
    }
    if (!artifact) {
        throw workflowError(409, 'route_a_provider_admission_artifact_missing');
    }
    const artifactDigest = requireDigest(artifact.artifactDigest, 'artifact_digest');
    if (normalizeDigest(computeDecisionOutputArtifactDigest(artifact)) !== artifactDigest) {
        throw workflowError(409, 'route_a_provider_admission_artifact_digest_invalid');
    }
    const actionContractVersion = requireRecord(
        governanceCase.actionContractVersion,
        'action_contract',
    );
    const templateSelection = requireRecord(
        governanceCase.templateSelection,
        'template_selection',
    );
    const selectedContract = requireRecord(
        templateSelection.actionContract,
        'selected_action_contract',
    );
    const resolvedAction = resolveGovernanceCaseActionDefinitionForDecision(actionContractVersion);
    const actionContractVersionId = String(governanceCase.actionContractVersionId || '');
    const actionContractDefinitionDigest = requireDigest(
        actionContractVersion.definitionDigest,
        'action_contract_definition_digest',
    );
    if (
        !resolvedAction
        || resolvedAction.actionType !== ACTION_TYPE
        || actionContractVersionId !== String(actionContractVersion.id || '')
        || actionContractVersionId !== String(selectedContract.contractVersionId || '')
        || String(selectedContract.actionType || '') !== ACTION_TYPE
        || String(selectedContract.executionAdapter || '') !== resolvedAction.executionAdapter
        || String(selectedContract.executionDomain || '') !== resolvedAction.executionDomain
        || String(selectedContract.riskFloor || '') !== resolvedAction.impact
        || requireDigest(
            selectedContract.definitionDigest,
            'selected_action_contract_definition_digest',
        ) !== actionContractDefinitionDigest
    ) {
        throw workflowError(409, 'route_a_provider_admission_action_contract_mismatch');
    }
    const payload = requireRecord(request.payload, 'request_payload');
    const operationPayload = requireRecord(payload.operationPayload, 'operation_payload');
    const statePrecondition = requireRecord(payload.statePrecondition, 'state_precondition');
    assertOperationPayload(operationPayload, request.targetRef);
    assertStatePrecondition(statePrecondition, operationPayload.providerId);
    assertArtifactMatches(
        artifact,
        decisionDigest,
        operationPayload,
        statePrecondition,
        request.targetRef,
    );

    const executionNonce = deterministicId(
        'route-a',
        `${decisionDigest}:${artifactDigest}`,
    );
    return {
        caseId: String(governanceCase.id),
        requestId: String(request.id),
        decisionDigest,
        artifactDigest,
        artifactId: String(artifact.id),
        actionContractVersionId,
        actionContractDefinitionDigest,
        operationPayload,
        operationPayloadDigest: digestJson(operationPayload),
        statePrecondition,
        statePreconditionDigest: digestJson(statePrecondition),
        executionNonce,
        receiptId: deterministicId('route-a-provider-admission-decision', decisionDigest),
        policyVersionId: String(request.policyVersionId || ''),
        validFrom: validFromDate.toISOString(),
        expiresAt: expiresAtDate.toISOString(),
        ...resolveRouteATallyFacts(decision.tally),
    };
}

/** Live strategy tallies use `quorum.numerator`; Route A receipt freeze uses `{required,actual}`. */
function resolveRouteATallyFacts(tallyRaw: unknown): {
    quorumResult: { required: number; actual: number };
    thresholdResult: { required: number; actual: number };
    vetoStatus: unknown;
} {
    const tally = requireRecord(tallyRaw, 'decision_tally');
    if (tally.quorumResult != null && tally.thresholdResult != null) {
        const quorumResult = requireRecord(tally.quorumResult, 'quorum_result');
        const thresholdResult = requireRecord(tally.thresholdResult, 'threshold_result');
        const qRequired = Number((quorumResult as any).required);
        const qActual = Number((quorumResult as any).actual);
        const tRequired = Number((thresholdResult as any).required);
        const tActual = Number((thresholdResult as any).actual);
        if (
            ![qRequired, qActual, tRequired, tActual].every((n) => Number.isFinite(n))
        ) {
            throw workflowError(409, 'route_a_provider_admission_quorum_result_invalid');
        }
        return {
            quorumResult: { required: qRequired, actual: qActual },
            thresholdResult: { required: tRequired, actual: tActual },
            vetoStatus: tally.vetoStatus ?? null,
        };
    }
    const quorum = requireRecord(tally.quorum, 'quorum');
    const required = Number(quorum.required);
    const actual = Number(quorum.numerator ?? quorum.participation ?? quorum.actual);
    if (!Number.isFinite(required) || !Number.isFinite(actual) || required <= 0 || actual < 0) {
        throw workflowError(409, 'route_a_provider_admission_quorum_result_invalid');
    }
    return {
        quorumResult: { required, actual },
        thresholdResult: { required, actual },
        vetoStatus: tally.vetoStatus ?? tally.veto ?? null,
    };
}

function buildUnsignedReceipt(
    facts: CanonicalRouteAFacts,
    context: ProductionCredentialContext,
) {
    return {
        receiptId: facts.receiptId,
        receiptType: 'governance_case_decision',
        caseId: facts.caseId,
        requestId: facts.requestId,
        decisionDigest: facts.decisionDigest,
        artifactId: facts.artifactId,
        artifactDigest: facts.artifactDigest,
        actionContractVersionId: facts.actionContractVersionId,
        actionContractDefinitionDigest: facts.actionContractDefinitionDigest,
        verifierPolicyVersion: POLICY_REF,
        receiptIssuer: context.issuerRef,
        issuerProof: context.issuerKeySetDigest,
        operationId: ACTION_TYPE,
        operationVersion: ACTION_VERSION,
        payloadDigest: facts.operationPayloadDigest,
        replayDomain: REPLAY_DOMAIN,
        executionNonce: facts.executionNonce,
        decision: 'approved',
        committeePolicyRef: SCOPE_REF,
        approverPolicyRef: facts.policyVersionId,
        quorumResult: facts.quorumResult,
        thresholdResult: facts.thresholdResult,
        timelockStatus: { satisfied: true },
        executionMode: 'external_receipt_verification',
        executionTargetRef: TARGET_REF,
        validFrom: facts.validFrom,
        expiresAt: facts.expiresAt,
        statePreconditionDigest: facts.statePreconditionDigest,
        vetoStatus: facts.vetoStatus,
        revocationRef: context.revocationRef,
    };
}

async function readPersistedSubmission(
    prisma: PrismaClient,
    facts: CanonicalRouteAFacts,
    options: {
        credentialId?: string;
        now: Date;
        requireFreshBundle: boolean;
    },
): Promise<RouteAProviderAdmissionCredentialSubmission | null> {
    const subjectRef = `${ACTION_TYPE}:${facts.executionNonce}`;
    const row = options.credentialId
        ? await (prisma as any).hostedAppCredential.findUnique({
            where: { id: options.credentialId },
        })
        : (await (prisma as any).hostedAppCredential.findMany({
            where: { subjectRef },
            orderBy: { createdAt: 'desc' },
            take: 1,
        }))[0] ?? null;
    if (!row) return null;
    const signedPayload = decodeJwsPayload(row.signature);
    const envelope = requireRecord(signedPayload.envelope, 'credential_envelope');
    if (
        (options.credentialId && String(envelope.credentialId || '') !== options.credentialId)
        || String(envelope.credentialType || '') !== CREDENTIAL_TYPE
        || String(envelope.subjectRef || '') !== subjectRef
        || String(envelope.audienceRef || '') !== TARGET_REF
        || String(envelope.scopeRef || '') !== SCOPE_REF
        || String(envelope.replayDomain || '') !== REPLAY_DOMAIN
        || String(envelope.nonce || '') !== facts.executionNonce
        || String(envelope.schemaRef || '') !== SCHEMA_REF
        || String(envelope.verifierPolicyRef || '') !== POLICY_REF
    ) {
        throw workflowError(409, 'route_a_provider_admission_credential_binding_mismatch');
    }
    const issuerKeySetDigest = String(signedPayload.issuerKeySetDigest || '');
    const revocationSnapshotDigest = String(signedPayload.revocationSnapshotDigest || '');
    const bundleId = deterministicId(
        'route-a-provider-admission-bundle',
        `${issuerKeySetDigest}:${revocationSnapshotDigest}:${SCHEMA_REF}:${POLICY_REF}`,
    );
    const bundleRow = await (prisma as any).hostedAppOfflineVerificationBundle.findUnique({
        where: { id: bundleId },
    });
    if (!bundleRow) {
        throw workflowError(409, 'route_a_provider_admission_offline_bundle_missing');
    }
    const bundle = deserializeOfflineBundle(bundleRow);
    if (
        options.requireFreshBundle
        && new Date(String(bundle.expiresAt || '')).getTime() <= options.now.getTime()
    ) return null;
    const context = {
        issuerRef: String(envelope.issuerRef || ''),
        issuerKeySetDigest,
        revocationRef: String(envelope.revocationRef || ''),
    } as ProductionCredentialContext;
    // Historical readback must not re-digest against live tally projections; issuance
    // already froze envelope.payloadDigest / row.payloadDigest.
    const governanceReceiptDigest = requireDigest(envelope.payloadDigest, 'payload_digest');
    if (String(row.payloadDigest || '') !== governanceReceiptDigest) {
        throw workflowError(409, 'route_a_provider_admission_receipt_digest_mismatch');
    }
    const credential: ProductionSignedCredential = {
        credentialType: CREDENTIAL_TYPE,
        envelope: envelope as any,
        jws: String(row.signature || ''),
        issuerKeySetDigest,
        schemaDigest: String(signedPayload.schemaDigest || ''),
        verifierPolicyDigest: String(signedPayload.verifierPolicyDigest || ''),
        revocationSnapshotDigest,
        chainAnchorRefs: Array.isArray(signedPayload.chainAnchorRefs)
            ? signedPayload.chainAnchorRefs.map(String)
            : [],
    };
    const unsignedReceipt = buildUnsignedReceipt(facts, context);
    return {
        schemaVersion: 'ExternalCredentialSubmission/v1',
        profileId: PROFILE_ID,
        credentialJws: credential.jws,
        offlineVerificationBundle: bundle,
        governanceDecisionReceipt: {
            ...unsignedReceipt,
            validFrom: String(envelope.validFrom || facts.validFrom),
            expiresAt: String(envelope.expiresAt || facts.expiresAt),
            governanceReceiptDigest,
            credentialEnvelope: envelope,
            receiptSignature: credential.jws,
            credential,
            credentialJws: credential.jws,
        },
        operationPayload: facts.operationPayload,
        operationPayloadDigest: facts.operationPayloadDigest,
        statePrecondition: facts.statePrecondition,
        statePreconditionDigest: facts.statePreconditionDigest,
    };
}

async function persistOfflineBundle(prisma: PrismaClient, bundle: any): Promise<void> {
    const existing = await (prisma as any).hostedAppOfflineVerificationBundle.findUnique({
        where: { id: bundle.bundleId },
    });
    if (existing) return;
    try {
        await (prisma as any).hostedAppOfflineVerificationBundle.create({
            data: {
                id: bundle.bundleId,
                issuerKeySetDigest: bundle.issuerKeySetDigest,
                issuerKeySetRef: bundle.issuerKeySetRef,
                publicJwks: bundle.jwks,
                credentialSchemaDigests: bundle.credentialSchemaDigests,
                schemaDocuments: bundle.schemaDocuments,
                verifierPolicyDigests: bundle.verifierPolicyDigests,
                policyDocuments: bundle.policyDocuments,
                revocationSnapshot: bundle.revocationSnapshot,
                revocationFeedPublicJwk: bundle.revocationFeedPublicJwk,
                revocationSnapshotDigest: bundle.revocationSnapshotDigest,
                revocationSnapshotIssuedAt: new Date(bundle.revocationSnapshotIssuedAt),
                maxRevocationFeedAgeMs: bundle.maxRevocationFeedAgeMs,
                chainAnchorRefs: bundle.chainAnchorRefs,
                validityWindow: bundle.validityWindow,
                redactionPolicyRef: bundle.redactionPolicyRef,
                bundleDigest: bundle.bundleDigest,
                bundleJws: bundle.bundleJws,
                bundleSignature: bundle.bundleSignature,
                expiresAt: new Date(bundle.expiresAt),
            },
        });
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
    }
}

function serializeCredential(
    credential: ProductionSignedCredential,
    context: ProductionCredentialContext,
) {
    const envelope = credential.envelope;
    return {
        id: envelope.credentialId,
        credentialType: envelope.credentialType,
        issuerId: context.issuerId,
        issuerKeyVersion: context.issuerKeyVersion,
        subjectRef: envelope.subjectRef,
        audienceRef: envelope.audienceRef,
        scopeRef: envelope.scopeRef,
        replayDomain: envelope.replayDomain,
        nonce: envelope.nonce,
        payloadDigest: envelope.payloadDigest,
        schemaRef: envelope.schemaRef,
        policyVersion: envelope.verifierPolicyRef,
        validFrom: new Date(envelope.validFrom),
        expiresAt: new Date(envelope.expiresAt),
        revocationRef: envelope.revocationRef,
        chainAnchorRef: envelope.chainAnchorRef,
        signature: credential.jws,
    };
}

function deserializeOfflineBundle(row: any): Record<string, unknown> {
    return {
        bundleId: row.id,
        credentialType: 'OfflineVerificationBundle',
        issuerKeySetDigest: row.issuerKeySetDigest,
        issuerKeySetRef: row.issuerKeySetRef,
        jwks: row.publicJwks,
        credentialSchemaDigests: row.credentialSchemaDigests,
        schemaDocuments: row.schemaDocuments,
        verifierPolicyDigests: row.verifierPolicyDigests,
        policyDocuments: row.policyDocuments,
        revocationSnapshot: row.revocationSnapshot,
        revocationFeedPublicJwk: row.revocationFeedPublicJwk,
        revocationSnapshotDigest: row.revocationSnapshotDigest,
        revocationSnapshotIssuedAt: new Date(row.revocationSnapshotIssuedAt).toISOString(),
        maxRevocationFeedAgeMs: row.maxRevocationFeedAgeMs,
        chainAnchorRefs: row.chainAnchorRefs,
        chainAnchorFreshness: decodeJwsPayload(row.bundleJws).chainAnchorFreshness,
        validityWindow: row.validityWindow,
        redactionPolicyRef: row.redactionPolicyRef,
        expiresAt: new Date(row.expiresAt).toISOString(),
        bundleDigest: row.bundleDigest,
        bundleJws: row.bundleJws,
        bundleSignature: row.bundleSignature,
    };
}

export function assertOperationPayload(payload: Record<string, unknown>, targetRef: unknown): void {
    const required = [
        'providerId',
        'providerPubkey',
        'capacityCommitmentDigest',
        'executionTargetRef',
        'policyDigest',
    ];
    if (Object.keys(payload).sort().join('|') !== required.sort().join('|')) {
        throw workflowError(409, 'route_a_provider_admission_operation_payload_invalid');
    }
    if (
        !required.every((key) => typeof payload[key] === 'string' && String(payload[key]).trim())
        || !isCanonicalDigest(payload.capacityCommitmentDigest)
        || !isCanonicalDigest(payload.policyDigest)
        || String(payload.executionTargetRef) !== TARGET_REF
        || String(payload.providerId) !== String(targetRef || '')
    ) {
        throw workflowError(409, 'route_a_provider_admission_operation_payload_invalid');
    }
}

export function assertStatePrecondition(state: Record<string, unknown>, providerId: unknown): void {
    const required = ['providerId', 'providerStatus', 'settlementState', 'mappingVersion'];
    if (
        Object.keys(state).sort().join('|') !== required.sort().join('|')
        || String(state.providerId || '') !== String(providerId || '')
        || String(state.providerStatus || '') !== 'candidate'
        || String(state.settlementState || '') !== 'not_admitted'
        || String(state.mappingVersion || '') !== 'storage-fabric.provider-admission.v1'
    ) {
        throw workflowError(409, 'route_a_provider_admission_state_precondition_invalid');
    }
}

function assertArtifactMatches(
    artifact: any,
    decisionDigest: string,
    operationPayload: Record<string, unknown>,
    statePrecondition: Record<string, unknown>,
    targetRef: unknown,
): void {
    const executionPlan = artifact.constraints?.executionPlan;
    const actions = executionPlan?.actions;
    if (
        normalizeDigest(String(executionPlan?.governingDecisionDigest || '')) !== decisionDigest
        || !Array.isArray(actions)
        || actions.length !== 1
    ) {
        throw workflowError(409, 'route_a_provider_admission_artifact_mismatch');
    }
    const action = actions[0];
    if (
        String(action?.actionType || '') !== ACTION_TYPE
        || String(action?.target?.type || '') !== 'external_provider'
        || String(action?.target?.ref || '') !== String(targetRef || '')
        || digestJson(action?.payload?.operationPayload) !== digestJson(operationPayload)
        || digestJson(action?.payload?.statePrecondition) !== digestJson(statePrecondition)
    ) {
        throw workflowError(409, 'route_a_provider_admission_artifact_mismatch');
    }
}

function decodeJwsPayload(jws: unknown): Record<string, unknown> {
    try {
        const parts = String(jws || '').split('.');
        if (parts.length !== 3) throw new Error('invalid');
        return requireRecord(
            JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
            'jws_payload',
        );
    } catch {
        throw workflowError(409, 'route_a_provider_admission_jws_invalid');
    }
}

function deterministicId(prefix: string, material: string): string {
    return `${prefix}:${crypto.createHash('sha256').update(material).digest('hex').slice(0, 48)}`;
}

function requireRecord(value: unknown, field: string): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw workflowError(409, `route_a_provider_admission_${field}_invalid`);
    }
    return value as Record<string, any>;
}

function requireDigest(value: unknown, field: string): string {
    const normalized = String(value || '').trim();
    if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(normalized)) {
        throw workflowError(409, `route_a_provider_admission_${field}_invalid`);
    }
    return normalizeDigest(normalized);
}

function normalizeDigest(value: string): string {
    const normalized = value.trim().toLowerCase();
    return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

function isCanonicalDigest(value: unknown): boolean {
    return /^sha256:[a-f0-9]{64}$/.test(String(value || ''));
}

function requireDate(value: unknown, field: string): Date {
    if (value == null || value === '') {
        throw workflowError(409, `route_a_provider_admission_${field}_invalid`);
    }
    const date = new Date(value as any);
    if (!Number.isFinite(date.getTime())) {
        throw workflowError(409, `route_a_provider_admission_${field}_invalid`);
    }
    return date;
}

// null/null was persisted on accept; new Date(null)→Epoch→false invalid (0>=0).
function resolveProviderAdmissionExecutionWindow(
    decision: Record<string, any>,
    governanceCase: Record<string, any>,
): { validFromDate: Date; expiresAtDate: Date } {
    const fromRaw = decision.executableFrom;
    const untilRaw = decision.executableUntil;
    if (fromRaw != null && untilRaw != null) {
        return {
            validFromDate: requireDate(fromRaw, 'executable_from'),
            expiresAtDate: requireDate(untilRaw, 'executable_until'),
        };
    }
    if (fromRaw != null || untilRaw != null) {
        throw workflowError(409, 'route_a_provider_admission_execution_window_invalid');
    }
    const selection = governanceCase.templateSelection;
    const authority = selection && typeof selection === 'object'
        ? (selection as Record<string, any>).actionAuthority
        : null;
    const untilCandidate = authority?.effectiveUntil
        ?? authority?.authorityPolicyBinding?.effectiveUntil
        ?? null;
    return {
        validFromDate: requireDate(decision.decidedAt, 'executable_from'),
        expiresAtDate: requireDate(untilCandidate, 'executable_until'),
    };
}

async function ensureProviderAdmissionManualExecutionArtifact(
    prisma: PrismaClient,
    input: {
        governanceCase: any;
        request: any;
        decision: any;
        decisionDigest: string;
        now: Date;
    },
): Promise<any | null> {
    const execution = (input.governanceCase.responsibilities || []).find(
        (row: any) => String(row.kind || '') === 'execution',
    );
    const outcome = (input.governanceCase.responsibilities || []).find(
        (row: any) => String(row.kind || '') === 'outcome',
    );
    if (
        !execution || String(execution.status || '') !== 'accepted'
        || !outcome || String(outcome.status || '') !== 'accepted'
        || String(execution.assigneePubkey || '') === String(outcome.assigneePubkey || '')
        || !(execution.deadlineAt instanceof Date)
    ) {
        throw workflowError(409, 'route_a_provider_admission_execution_responsibilities_required');
    }
    const createdAt = input.decision.decidedAt instanceof Date
        ? input.decision.decidedAt
        : new Date(input.decision.decidedAt);
    if (!Number.isFinite(createdAt.getTime()) || execution.deadlineAt.getTime() <= createdAt.getTime()) {
        throw workflowError(409, 'route_a_provider_admission_execution_deadline_invalid');
    }
    let artifact: any;
    try {
        artifact = buildGovernanceManualExecutionPlanArtifact({
            caseId: String(input.governanceCase.id),
            subjectType: String(input.governanceCase.subjectType),
            subjectRef: String(input.governanceCase.subjectRef),
            decisionRequestId: String(input.request.id),
            decisionDigest: input.decisionDigest.replace(/^sha256:/, ''),
            actionType: String(input.request.actionType),
            targetType: String(input.request.targetType),
            targetRef: String(input.request.targetRef),
            actionPayload: input.request.payload,
            assignee: {
                pubkey: String(execution.assigneePubkey),
                responsibilityVersion: Number(execution.version),
                deadlineAt: execution.deadlineAt,
            },
            reviewer: {
                pubkey: String(outcome.assigneePubkey),
                responsibilityVersion: Number(outcome.version),
            },
            createdAt,
        });
    } catch {
        throw workflowError(409, 'route_a_provider_admission_artifact_missing');
    }
    const existing = await (prisma as any).decisionOutputArtifact.findUnique({
        where: {
            decisionRequestId_decisionDigest_ordinal: {
                decisionRequestId: artifact.decisionRequestId,
                decisionDigest: artifact.decisionDigest,
                ordinal: artifact.ordinal,
            },
        },
    });
    if (
        existing
        && String(existing.kind || '') === 'manual_execution_plan'
        && String(existing.finality || '') === 'alcheme_native_decision'
    ) {
        return existing;
    }
    if (existing) {
        // PA accept previously persisted policy_document at ordinal 0; replace.
        await (prisma as any).decisionOutputArtifact.delete({
            where: { id: existing.id },
        });
    }
    try {
        await (prisma as any).decisionOutputArtifact.create({ data: artifact });
    } catch (error) {
        if (!isUniqueConflict(error)) throw error;
        const raced = await (prisma as any).decisionOutputArtifact.findUnique({
            where: {
                decisionRequestId_decisionDigest_ordinal: {
                    decisionRequestId: artifact.decisionRequestId,
                    decisionDigest: artifact.decisionDigest,
                    ordinal: artifact.ordinal,
                },
            },
        });
        if (
            raced
            && String(raced.kind || '') === 'manual_execution_plan'
            && String(raced.finality || '') === 'alcheme_native_decision'
        ) {
            return raced;
        }
        throw workflowError(409, 'route_a_provider_admission_artifact_missing');
    }
    return artifact;
}

function workflowError(statusCode: number, code: string): GovernanceCaseWorkflowError {
    return new GovernanceCaseWorkflowError(statusCode, code);
}

function isUniqueConflict(error: unknown): boolean {
    return String((error as { code?: unknown })?.code || '') === 'P2002';
}
