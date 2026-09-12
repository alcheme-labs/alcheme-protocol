'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, ChevronDown, RefreshCw, UserRoundCheck, XCircle } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';

import { useI18n } from '@/i18n/useI18n';
import {
    activateGovernanceGrantAgreement,
    applyAcceptedGovernanceGrantAgreementTermination,
    canExportProviderAdmissionDecisionPackage,
    changeGovernanceCaseResponsibility,
    cancelGovernanceCaseApprovalStage,
    discloseGovernanceCaseApprovalConflict,
    discloseGovernanceGrantReviewerConflict,
    fetchPendingGovernanceRequestSignal,
    issueProviderAdmissionExternalCredential,
    openGovernanceGrantAgreementAmendmentCase,
    openGovernanceGrantAgreementTerminationCase,
    openGovernanceGrantMilestoneAppeal,
    openGovernanceProviderExecutionCompensationPlanCase,
    openGovernanceProviderExecutionTerminalAbandonmentCase,
    openGovernanceCaseApprovalStage,
    prepareGovernanceRequestSignal,
    readProviderAdmissionExternalCredential,
    recordGovernanceCaseReview,
    recordGovernanceCaseReviewRelationship,
    recordGovernanceGrantMilestoneAppealVote,
    recordGovernanceGrantMilestoneReview,
    recordGovernanceGrantOutcome,
    refreshGovernanceGrantSettlementReadiness,
    reviewGovernanceManualExecutionCompletion,
    submitGovernanceManualExecutionCompletion,
    submitGovernanceRequestSignal,
    transitionGovernanceCase,
    type GovernanceCase,
    type GovernanceCaseConflictReason,
    type GovernanceCaseResponsibilityAction,
    type GovernanceCaseResponsibilityKind,
    type GovernanceCaseResponsibilityStatus,
    type GovernanceCaseReviewConclusion,
    type GovernanceCaseReviewRelationship,
    type GovernanceCaseReviewRelationshipActorRole,
    type ProviderAdmissionExternalCredentialSubmission,
} from '@/lib/api/governance';
import { bytesToBase64 } from '@/lib/circles/settingsEnvelope';
import { onNativeWalletCallback } from '@/lib/mobile/nativeWalletBridge';
import { resumeNativePhantomSignMessageCallback } from '@/lib/solana/nativePhantomWalletAdapter';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';
import { Select } from '@/components/ui/Select';
import { useUIStore } from '@/stores/ui';
import { ComposePortal } from '@/features/compose/composePortal';
import GovernanceProviderIncidentStatus from './GovernanceProviderIncidentStatus';
import GovernanceExecutionRecoveryStatus from './GovernanceExecutionRecoveryStatus';
import styles from './GovernanceCaseWorkflowPanel.module.css';

const RESPONSIBILITY_KINDS: GovernanceCaseResponsibilityKind[] = [
    'coordinator',
    'review',
    'execution',
    'outcome',
];

const CONFLICT_REASONS: GovernanceCaseConflictReason[] = [
    'material_relationship',
    'financial_interest',
    'subject_or_recipient',
    'provider_or_operator_role',
    'other_public_conflict',
];

const REVIEW_RELATIONSHIPS: GovernanceCaseReviewRelationship[] = [
    'none',
    'personal',
    'professional',
    'financial',
    'organizational',
    'other',
];

const REVIEW_CONCLUSIONS: GovernanceCaseReviewConclusion[] = [
    'changes_required',
    'signoff_granted',
    'signoff_denied',
    'abstained',
    'conflict_declared',
];

export default function GovernanceCaseWorkflowPanel({
    governanceCase,
    viewerPubkey,
    onRefresh,
    composeReviewActive = false,
    composeDockElement = null,
}: {
    governanceCase: GovernanceCase;
    viewerPubkey: string | null;
    onRefresh: () => Promise<void>;
    /** P0: portal review cluster into Action Dock when true and dock element exists. */
    composeReviewActive?: boolean;
    composeDockElement?: Element | null;
}) {
    const t = useI18n('GovernanceCases');
    const showToast = useUIStore((state) => state.showToast);
    const grantLifecycleT = useI18n('GovernanceGrantLifecycle');
    const recoveryRetryT = useI18n('GovernanceExecutionRetry');
    const { signMessage } = useWallet();
    const { signMessageForAction } = useWalletActionRunner();
    const [selectedKind, setSelectedKind] = useState<GovernanceCaseResponsibilityKind>(() => (
        responsibilityKindForTaskRole(governanceCase.nextRequiredAction?.role)
        ?? responsibilityKindsForPhase(governanceCase.phase)[0]
        ?? 'coordinator'
    ));
    const [targetPubkey, setTargetPubkey] = useState('');
    const [reviewReason, setReviewReason] = useState('');
    const [responsibilityReasons, setResponsibilityReasons] = useState<Partial<Record<GovernanceCaseResponsibilityKind, string>>>({});
    const [responsibilityDeadline, setResponsibilityDeadline] = useState('');
    const [manualEvidenceKind, setManualEvidenceKind] = useState<'external_receipt' | 'verification_record' | 'artifact'>('verification_record');
    const [manualEvidenceRef, setManualEvidenceRef] = useState('');
    const [manualEvidenceDigest, setManualEvidenceDigest] = useState('');
    const [manualReviewDecision, setManualReviewDecision] = useState<'approve' | 'reject'>('approve');
    const [manualReviewReason, setManualReviewReason] = useState('');
    const [reviewConclusion, setReviewConclusion] = useState<GovernanceCaseReviewConclusion>('changes_required');
    const [reviewPublicBasis, setReviewPublicBasis] = useState('');
    const [reviewRelationship, setReviewRelationship] = useState<GovernanceCaseReviewRelationship | null>(null);
    const [proposerReviewRelationship, setProposerReviewRelationship] = useState<GovernanceCaseReviewRelationship | null>(null);
    const [reviewEditOpen, setReviewEditOpen] = useState(false);
    const [conflictReason, setConflictReason] = useState<GovernanceCaseConflictReason>('material_relationship');
    const [outcomeSummary, setOutcomeSummary] = useState('');
    const [quantitativeImpact, setQuantitativeImpact] = useState('');
    const [outcomeDeviations, setOutcomeDeviations] = useState('');
    const [outcomeFailures, setOutcomeFailures] = useState('');
    const [outstandingObligations, setOutstandingObligations] = useState('');
    const [observationStartedAt, setObservationStartedAt] = useState('');
    const [observationEndedAt, setObservationEndedAt] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [quadraticVotes, setQuadraticVotes] = useState<Record<string, string>>({});
    const [quadraticCommitments, setQuadraticCommitments] = useState<Record<string, string>>({});
    const [grantTargetKey, setGrantTargetKey] = useState('');
    const [grantMilestoneTitle, setGrantMilestoneTitle] = useState('');
    const [grantDeliverable, setGrantDeliverable] = useState('');
    const [grantEvidenceRequirements, setGrantEvidenceRequirements] = useState('');
    const [grantDeadline, setGrantDeadline] = useState('');
    const [grantPrimaryReviewers, setGrantPrimaryReviewers] = useState('');
    const [grantAlternateReviewers, setGrantAlternateReviewers] = useState('');
    const [grantReviewerQuorum, setGrantReviewerQuorum] = useState('1');
    const [grantAcceptCriteria, setGrantAcceptCriteria] = useState('');
    const [grantReworkCriteria, setGrantReworkCriteria] = useState('');
    const [grantRejectCriteria, setGrantRejectCriteria] = useState('');
    const [grantMaxRevisions, setGrantMaxRevisions] = useState('1');
    const [grantReviewOutcome, setGrantReviewOutcome] = useState<'accept' | 'rework' | 'reject'>('accept');
    const [grantReviewEvidence, setGrantReviewEvidence] = useState('');
    const [grantReviewSummary, setGrantReviewSummary] = useState('');
    const [grantAppealReason, setGrantAppealReason] = useState('');
    const [grantAppealEvidence, setGrantAppealEvidence] = useState('');
    const [grantAppealVote, setGrantAppealVote] = useState<'uphold' | 'overturn_accept'>('uphold');
    const [grantAppealVoteReason, setGrantAppealVoteReason] = useState('');
    const [grantAmendmentDeadline, setGrantAmendmentDeadline] = useState('');
    const [grantAmendmentReason, setGrantAmendmentReason] = useState('');
    const [grantTerminationGround, setGrantTerminationGround] = useState<'milestone_rejected' | 'schedule_expired' | 'governing_decision_revoked'>('milestone_rejected');
    const [grantTerminationReason, setGrantTerminationReason] = useState('');
    const [grantRetainedObligations, setGrantRetainedObligations] = useState('retain evidence and complete independent outcome review');
    const [grantOutstandingObligations, setGrantOutstandingObligations] = useState('');
    const [grantOutcomeStatus, setGrantOutcomeStatus] = useState<'fulfilled' | 'partially_fulfilled' | 'not_fulfilled' | 'terminated'>('fulfilled');
    const [grantOutcomeSummary, setGrantOutcomeSummary] = useState('');
    const [grantActualImpact, setGrantActualImpact] = useState('');
    const [grantOutcomeOutstanding, setGrantOutcomeOutstanding] = useState('');
    const [grantOutcomeEvidence, setGrantOutcomeEvidence] = useState('');
    const [grantObservationStartedAt, setGrantObservationStartedAt] = useState('');
    const [grantObservationEndedAt, setGrantObservationEndedAt] = useState('');
    const [terminalAbandonmentReason, setTerminalAbandonmentReason] = useState('');
    const [terminalAbandonmentCaseId, setTerminalAbandonmentCaseId] = useState<string | null>(null);
    const [compensationPlanReason, setCompensationPlanReason] = useState('');
    const [compensationPlanCaseId, setCompensationPlanCaseId] = useState<string | null>(null);
    const [providerAdmissionBusy, setProviderAdmissionBusy] = useState(false);
    const [providerAdmissionError, setProviderAdmissionError] = useState<string | null>(null);
    const [providerAdmissionAvailable, setProviderAdmissionAvailable] = useState<boolean | null>(null);
    const [providerAdmissionStatus, setProviderAdmissionStatus] = useState<string | null>(null);
    const [providerAdmissionCooldownUntil, setProviderAdmissionCooldownUntil] = useState(0);
    const [providerAdmissionSaveLink, setProviderAdmissionSaveLink] = useState<{
        filename: string;
        objectUrl: string;
    } | null>(null);
    const [providerAdmissionJws, setProviderAdmissionJws] = useState<string | null>(null);
    const providerAdmissionInFlightRef = useRef(false);
    const providerAdmissionSaveLinkRef = useRef<{ filename: string; objectUrl: string } | null>(null);
    const resumedNativeCallbackRef = useRef<string | null>(null);
    const nextResponsibilitySelectionRef = useRef<string | null>(null);
    const workflow = governanceCase.workflow;

    useEffect(() => {
        if (error) showToast(error, 'error');
    }, [error, showToast]);
    useEffect(() => {
        if (providerAdmissionError) showToast(providerAdmissionError, 'error');
    }, [providerAdmissionError, showToast]);
    useEffect(() => {
        if (providerAdmissionStatus) showToast(providerAdmissionStatus, 'success');
    }, [providerAdmissionStatus, showToast]);

    useEffect(() => {
        const task = governanceCase.nextRequiredAction;
        if (task?.primaryAction !== 'accept_responsibility') {
            nextResponsibilitySelectionRef.current = null;
            return;
        }
        const responsibilityKind = responsibilityKindForTaskRole(task.role);
        if (!responsibilityKind) return;
        const marker = `${task.primaryAction}:${task.role}:${task.status}`;
        if (nextResponsibilitySelectionRef.current === marker) return;
        nextResponsibilitySelectionRef.current = marker;
        setSelectedKind(responsibilityKind);
    }, [
        governanceCase.nextRequiredAction?.primaryAction,
        governanceCase.nextRequiredAction?.role,
        governanceCase.nextRequiredAction?.status,
    ]);

    useEffect(() => {
        const requestId = governanceCase.primaryRequest?.id;
        if (!requestId || !viewerPubkey) return;
        let disposed = false;
        const unsubscribe = onNativeWalletCallback((callbackUrl) => {
            if (resumedNativeCallbackRef.current === callbackUrl) return;
            void (async () => {
                try {
                    const pending = await fetchPendingGovernanceRequestSignal({
                        requestId,
                        actorPubkey: viewerPubkey,
                    });
                    if (!pending || disposed) return;
                    const signature = await resumeNativePhantomSignMessageCallback({
                        callbackUrl,
                        signedMessage: pending.challenge.signedMessage,
                        expectedWalletPublicKey: viewerPubkey,
                    });
                    if (!signature || disposed) return;
                    resumedNativeCallbackRef.current = callbackUrl;
                    setBusy(true);
                    setError(null);
                    await submitGovernanceRequestSignal({
                        requestId,
                        actorPubkey: viewerPubkey,
                        value: pending.submission.value,
                        evidence: pending.submission.evidence,
                        signature: bytesToBase64(signature),
                        signedMessage: pending.challenge.signedMessage,
                        nonce: pending.challenge.envelope.nonce,
                        expiresAt: pending.challenge.envelope.expiresAt,
                    });
                    await onRefresh();
                } catch {
                    if (!disposed) {
                        setError(t('workflow.signalError'));
                        await onRefresh().catch(() => undefined);
                    }
                } finally {
                    if (!disposed) setBusy(false);
                }
            })();
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [governanceCase.primaryRequest?.id, onRefresh, t, viewerPubkey]);

    const responsibilities = useMemo(
        () => new Map(workflow.responsibilities.map((item) => [item.kind, item])),
        [workflow.responsibilities],
    );
    const caseTerminal = governanceCase.phase === 'closed' || governanceCase.phase === 'archived';
    const currentResponsibilityKinds = useMemo(() => {
        const kinds = responsibilityKindsForPhase(governanceCase.phase);
        const taskKind = governanceCase.nextRequiredAction?.primaryAction === 'accept_responsibility'
            ? responsibilityKindForTaskRole(governanceCase.nextRequiredAction.role)
            : null;
        return taskKind && !kinds.includes(taskKind) ? [...kinds, taskKind] : kinds;
    }, [
        governanceCase.nextRequiredAction?.primaryAction,
        governanceCase.nextRequiredAction?.role,
        governanceCase.phase,
    ]);
    const otherResponsibilityKinds = useMemo(
        () => RESPONSIBILITY_KINDS.filter((kind) => !currentResponsibilityKinds.includes(kind)),
        [currentResponsibilityKinds],
    );
    const responsibilityManagementKinds = useMemo(() => (
        !caseTerminal && workflow.canManage
            ? RESPONSIBILITY_KINDS
            : !caseTerminal ? RESPONSIBILITY_KINDS.filter((kind) => (
                responsibilities.get(kind)?.assigneePubkey === viewerPubkey
            )) : []
    ), [caseTerminal, responsibilities, viewerPubkey, workflow.canManage]);
    const managementKind = responsibilityManagementKinds.includes(selectedKind)
        ? selectedKind
        : responsibilityManagementKinds[0] ?? selectedKind;
    const selected = responsibilities.get(managementKind) ?? null;
    const responsibilityDeadlineReady = Boolean(
        selected?.deadlineAt
        || (
            responsibilityDeadline
            && new Date(responsibilityDeadline).getTime() > Date.now()
        ),
    );
    const coordinator = responsibilities.get('coordinator') ?? null;
    const canStartDrafting = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.phase === 'intake'
        && coordinator?.status === 'accepted'
        && coordinator.assigneePubkey === viewerPubkey,
    );
    const reviewResponsibility = responsibilities.get('review') ?? null;
    const canRecordReview = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.phase === 'evidence_review'
        && reviewResponsibility?.status === 'accepted'
        && reviewResponsibility.assigneePubkey === viewerPubkey,
    );
    const reviewRelationshipActorRoles: GovernanceCaseReviewRelationshipActorRole[] = [
        ...(viewerPubkey
            && reviewResponsibility?.status === 'accepted'
            && reviewResponsibility.assigneePubkey === viewerPubkey
            ? ['reviewer' as const]
            : []),
        ...(viewerPubkey && governanceCase.proposerPubkey === viewerPubkey
            ? ['proposer' as const]
            : []),
    ];
    const canDeclareReviewRelationship = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.phase === 'evidence_review'
        && reviewRelationshipActorRoles.length > 0,
    );
    const canDeclareReviewerRelationship = canDeclareReviewRelationship
        && reviewRelationshipActorRoles.includes('reviewer');
    const canDeclareProposerRelationship = canDeclareReviewRelationship
        && reviewRelationshipActorRoles.includes('proposer');
    const currentReviewerRelationship = [...workflow.timeline].reverse().find((event) => (
        event.eventType === 'review_relationship_declared'
        && event.actorPubkey === viewerPubkey
        && event.fromState === 'reviewer'
        && event.responsibilityVersion === reviewResponsibility?.version
        && event.briefDraftPostId === governanceCase.brief?.draftPostId
        && event.briefDraftVersion === governanceCase.brief?.draftVersion
        && event.briefSnapshotDigest === governanceCase.brief?.snapshotDigest
    )) ?? null;
    const currentProposerRelationship = [...workflow.timeline].reverse().find((event) => (
        event.eventType === 'review_relationship_declared'
        && event.actorPubkey === viewerPubkey
        && event.fromState === 'proposer'
        && event.briefDraftPostId === governanceCase.brief?.draftPostId
        && event.briefDraftVersion === governanceCase.brief?.draftVersion
        && event.briefSnapshotDigest === governanceCase.brief?.snapshotDigest
    )) ?? null;
    const savedReviewRelationship = currentReviewerRelationship?.toState
        && REVIEW_RELATIONSHIPS.includes(currentReviewerRelationship.toState as GovernanceCaseReviewRelationship)
        ? currentReviewerRelationship.toState as GovernanceCaseReviewRelationship
        : null;
    const selectedReviewRelationship = reviewRelationship ?? savedReviewRelationship ?? 'none';
    const reviewRelationshipRecorded = Boolean(
        savedReviewRelationship
        && savedReviewRelationship === selectedReviewRelationship,
    );
    const savedProposerRelationship = currentProposerRelationship?.toState
        && REVIEW_RELATIONSHIPS.includes(currentProposerRelationship.toState as GovernanceCaseReviewRelationship)
        ? currentProposerRelationship.toState as GovernanceCaseReviewRelationship
        : null;
    const selectedProposerRelationship = proposerReviewRelationship ?? savedProposerRelationship ?? 'none';
    const proposerRelationshipRecorded = Boolean(
        savedProposerRelationship
        && savedProposerRelationship === selectedProposerRelationship,
    );
    const currentViewerReview = [...workflow.timeline].reverse().find((event) => (
        event.eventType === 'review_conclusion_recorded'
        && event.actorPubkey === viewerPubkey
        && event.responsibilityVersion === reviewResponsibility?.version
        && event.briefSnapshotStatus === 'current'
    )) ?? null;
    const reviewStepUnlocked = reviewRelationshipRecorded;
    const currentReviewConclusion = [...workflow.timeline].reverse().find((event) => (
        event.eventType === 'review_conclusion_recorded'
        && event.actorPubkey === reviewResponsibility?.assigneePubkey
        && event.responsibilityVersion === reviewResponsibility?.version
        && event.briefSnapshotStatus === 'current'
    )) ?? null;
    const currentSignoff = currentReviewConclusion?.toState === 'signoff_granted'
        ? currentReviewConclusion
        : null;
    const canAttemptOpenApproval = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.caseType === 'policy'
        && governanceCase.phase === 'evidence_review'
        && !governanceCase.decisionStages
        && coordinator?.status === 'accepted'
        && coordinator.assigneePubkey === viewerPubkey
        && reviewResponsibility?.status === 'accepted'
        && currentSignoff
        && (
            governanceCase.nextRequiredAction == null
            || (
                governanceCase.nextRequiredAction.primaryAction === 'open_approval_stage'
                && governanceCase.nextRequiredAction.status === 'available'
            )
        ),
    );
    const canOpenApproval = Boolean(
        canAttemptOpenApproval
        && governanceCase.policySimulation?.status === 'ready'
        && governanceCase.policySimulation.provider.status === 'ready'
        && governanceCase.policySimulation.electorate.quorumReachable
        && governanceCase.policySimulation.electorate.eligibleActorCount > 0
        && (
            governanceCase.template?.decisionMechanism?.kind === 'quadratic_voice_credits'
            || governanceCase.template?.decisionMechanism?.kind === 'quadratic_funding'
            || governanceCase.policySimulation.electorate.approvalThreshold
        ),
    );
    const normalizedPolicySimulationReason = governanceCase.policySimulation?.reason === 'decision_mechanism_unavailable'
        ? 'approval_policy_rule_unavailable'
        : governanceCase.policySimulation?.reason;
    const approvalStageBlocker = canAttemptOpenApproval && !canOpenApproval
        ? t(`workflow.policySimulation.reason.${normalizedPolicySimulationReason ?? 'approval_authority_unavailable'}`)
        : null;
    const canDiscloseConflict = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.phase === 'evidence_review'
        && governanceCase.policySimulation?.conflictOfInterest.canSelfDisclose,
    );
    const approvalStage = governanceCase.decisionStages?.stages.find((stage) => stage.purpose === 'approval') ?? null;
    const voteSummary = governanceCase.voteSummary;
    const quadraticVoice = voteSummary?.ballot.quadraticVoice ?? null;
    const quadraticFunding = voteSummary?.ballot.quadraticFunding ?? null;
    const quadraticVoiceReadiness = governanceCase.policySimulation?.quadraticVoice
        ?? quadraticVoice?.activationReadiness
        ?? null;
    const quadraticFundingReadiness = governanceCase.policySimulation?.quadraticFunding
        ?? quadraticFunding?.activationReadiness
        ?? null;
    const grantTargets = useMemo(() => governanceCase.decisionOutputArtifacts.flatMap((artifact) => {
        if (artifact.kind !== 'allocation_plan' || !('allocationPlan' in artifact.constraints)) return [];
        const allocationPlan = artifact.constraints.allocationPlan;
        const projects = Array.isArray(allocationPlan.projects)
            ? allocationPlan.projects
            : [];
        return projects.flatMap((project: any) => {
            const projectRef = String(project?.projectRef ?? '').trim();
            const recipientRef = String(project?.recipientRef ?? '').trim();
            const totalPlannedUnits = Number(project?.totalPlannedUnits);
            if (!projectRef || !recipientRef || !Number.isSafeInteger(totalPlannedUnits) || totalPlannedUnits <= 0) return [];
            const existing = governanceCase.grantAgreements.find((agreement) => (
                agreement.allocationArtifactId === artifact.id && agreement.projectRef === projectRef
            ));
            return [{
                key: `${artifact.id}::${projectRef}`,
                artifactId: artifact.id,
                projectRef,
                recipientRef,
                totalPlannedUnits,
                budgetUnit: String(allocationPlan.budgetUnit ?? ''),
                existing: existing ?? null,
            }];
        });
    }), [governanceCase.decisionOutputArtifacts, governanceCase.grantAgreements]);
    const selectedGrantTarget = grantTargets.find((target) => target.key === grantTargetKey)
        ?? grantTargets[0]
        ?? null;
    const quadraticCost = quadraticVoice
        ? quadraticVoice.choices.reduce((sum, choice) => {
            const votes = Number(quadraticVotes[choice.id] ?? 0);
            return sum + (Number.isSafeInteger(votes) && votes >= 0
                ? votes * votes
                : Number.POSITIVE_INFINITY);
        }, 0)
        : 0;
    const quadraticVectorReady = Boolean(
        quadraticVoice
        && quadraticCost > 0
        && quadraticCost <= quadraticVoice.creditBudgetPerActor
        && quadraticVoice.choices.every((choice) => {
            const votes = Number(quadraticVotes[choice.id] ?? 0);
            return Number.isSafeInteger(votes) && votes >= 0;
        }),
    );
    const quadraticCommitmentTotal = quadraticFunding
        ? quadraticFunding.projects.reduce((sum, project) => {
            const amount = Number(quadraticCommitments[project.id] ?? 0);
            return sum + (Number.isSafeInteger(amount) && amount >= 0
                ? amount
                : Number.POSITIVE_INFINITY);
        }, 0)
        : 0;
    const quadraticCommitmentReady = Boolean(
        quadraticFunding
        && quadraticCommitmentTotal > 0
        && quadraticFunding.projects.every((project) => {
            const amount = Number(quadraticCommitments[project.id] ?? 0);
            return Number.isSafeInteger(amount)
                && amount >= 0
                && amount <= quadraticFunding.commitmentCapPerActorPerProject;
        }),
    );
    const thresholdMode = String(voteSummary?.rule?.threshold?.mode || '');
    const thresholdValue = Number(voteSummary?.rule?.threshold?.value);
    const ballotThreshold = thresholdMode === 'fixed_count' && Number.isSafeInteger(thresholdValue) && thresholdValue > 0
        ? t('workflow.ballot.thresholdFixed', { count: thresholdValue })
        : thresholdMode === 'unanimity'
            ? t('workflow.ballot.thresholdUnanimity')
            : thresholdMode === 'default_majority'
                ? t('workflow.ballot.thresholdMajority')
                : t('workflow.ballot.notProvided');
    const correctionCircleId = governanceCase.governanceHome?.type === 'circle'
        && /^[1-9]\d*$/.test(governanceCase.governanceHome.ref)
        ? governanceCase.governanceHome.ref
        : null;
    const eligibilityScope = governanceCase.template?.actionContract?.actionType
        || governanceCase.requestedDecision;
    const isStorageFabricProviderAdmission = eligibilityScope
        === 'storage_fabric.authorize_provider_admission';
    const canExportProviderAdmission = canExportProviderAdmissionDecisionPackage({
        canManage: Boolean(workflow.canManage),
        actionType: eligibilityScope,
        decision: governanceCase.primaryRequest?.decision?.decision ?? null,
    });
    const providerAdmissionCoolingDown = providerAdmissionCooldownUntil > Date.now();
    useEffect(() => {
        if (isStorageFabricProviderAdmission) {
            setManualEvidenceKind('external_receipt');
        }
    }, [governanceCase.id, isStorageFabricProviderAdmission]);
    useEffect(() => {
        if (!canExportProviderAdmission) {
            setProviderAdmissionAvailable(null);
            setProviderAdmissionStatus(null);
            setProviderAdmissionError(null);
            return;
        }
        let active = true;
        setProviderAdmissionAvailable(null);
        void readProviderAdmissionExternalCredential(governanceCase.id)
            .then(() => {
                if (active) setProviderAdmissionAvailable(true);
            })
            .catch(() => {
                if (active) setProviderAdmissionAvailable(false);
            });
        return () => { active = false; };
    }, [canExportProviderAdmission, governanceCase.id]);
    useEffect(() => {
        if (!providerAdmissionCoolingDown) return;
        const waitMs = Math.max(0, providerAdmissionCooldownUntil - Date.now());
        const timer = window.setTimeout(() => {
            setProviderAdmissionCooldownUntil(0);
        }, waitMs + 20);
        return () => window.clearTimeout(timer);
    }, [providerAdmissionCoolingDown, providerAdmissionCooldownUntil]);

    useEffect(() => () => {
        if (providerAdmissionSaveLinkRef.current?.objectUrl) {
            URL.revokeObjectURL(providerAdmissionSaveLinkRef.current.objectUrl);
        }
    }, []);
    const canSignal = Boolean(
        viewerPubkey
        && signMessage
        && governanceCase.decisionStages?.integrity === 'verified'
        && governanceCase.primaryRequest?.state === 'active'
        && voteSummary?.eligibility.status === 'eligible'
        && voteSummary.ballot.state === 'pending'
        && voteSummary.submission.status !== 'recorded'
        && approvalStage?.state === 'active'
        && approvalStage?.mechanism
        && !('status' in approvalStage.mechanism)
    );
    const canCancelApproval = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.primaryRequest?.state === 'active'
        && approvalStage?.state === 'active'
        && (
            workflow.canManage
            || (
                coordinator?.status === 'accepted'
                && coordinator.assigneePubkey === viewerPubkey
            )
        ),
    );
    const outcomeResponsibility = responsibilities.get('outcome') ?? null;
    const executionResponsibility = responsibilities.get('execution') ?? null;
    const manualExecutionControl = governanceCase.manualExecutionControl;
    const manualSubmission = manualExecutionControl?.manualSubmission ?? null;
    const canSubmitManualExecution = Boolean(
        viewerPubkey
        && workflow.version
        && manualExecutionControl?.completionSource === 'controlled_manual_submission_and_review'
        && ['submission_required', 'rejected_resubmission_required'].includes(
            manualExecutionControl.state,
        )
        && manualExecutionControl.stageAssignee?.responsibilityStatus === 'accepted'
        && manualExecutionControl.stageAssignee.pubkey === viewerPubkey
    );
    const canReviewManualExecution = Boolean(
        viewerPubkey
        && workflow.version
        && manualExecutionControl?.state === 'submitted_awaiting_review'
        && manualExecutionControl.reviewer?.responsibilityStatus === 'accepted'
        && manualExecutionControl.reviewer.pubkey === viewerPubkey
        && manualSubmission
    );
    const riskFloor = governanceCase.template?.actionContract?.riskFloor ?? null;
    const highImpact = riskFloor === 'high' || riskFloor === 'critical';
    const outcomePolicyReady = Boolean(governanceCase.template?.outcomePolicy);
    const executorSeparationReady = !highImpact
        || !executionResponsibility
        || executionResponsibility.status !== 'accepted'
        || executionResponsibility?.assigneePubkey !== outcomeResponsibility?.assigneePubkey;
    const controlledManualExecutionReady = manualExecutionControl?.completionSource
        !== 'controlled_manual_submission_and_review'
        || manualExecutionControl.state === 'approved_receipt_recorded';
    const outcomeActionReady = governanceCase.nextRequiredAction?.primaryAction === 'record_outcome'
        && governanceCase.nextRequiredAction.status === 'available';
    const canCloseCase = Boolean(
        viewerPubkey
        && workflow.version
        && governanceCase.phase === 'outcome_review'
        && governanceCase.primaryRequest?.decision
        && outcomeResponsibility?.status === 'accepted'
        && outcomeResponsibility.assigneePubkey === viewerPubkey
        && outcomePolicyReady
        && executorSeparationReady
        && controlledManualExecutionReady
        && outcomeActionReady,
    );
    const closeBlockers: Array<'summary' | 'observation' | 'periodOrder' | 'periodFuture'> = [];
    if (canCloseCase) {
        if (outcomeSummary.trim().length < 3) closeBlockers.push('summary');
        if (!observationStartedAt || !observationEndedAt) {
            closeBlockers.push('observation');
        } else {
            const startedAtMs = new Date(observationStartedAt).getTime();
            const endedAtMs = new Date(observationEndedAt).getTime();
            if (endedAtMs < startedAtMs) closeBlockers.push('periodOrder');
            else if (endedAtMs > Date.now()) closeBlockers.push('periodFuture');
        }
    }
    const canSubmitClose = Boolean(canCloseCase && closeBlockers.length === 0);

    function requestCloseCase() {
        if (busy) return;
        if (!canSubmitClose) {
            const hint = closeBlockers[0]
                ? t(`workflow.actualOutcome.submitHint.${closeBlockers[0]}`)
                : t('workflow.closeError');
            showToast(hint, 'error');
            return;
        }
        void closeCase();
    }

    async function runResponsibilityAction(
        kind: GovernanceCaseResponsibilityKind,
        action: GovernanceCaseResponsibilityAction,
    ) {
        if (!workflow.version) return;
        if (
            kind === 'review'
            && action === 'reassign'
            && currentSignoff
            && !window.confirm(t('workflow.management.replaceCompletedReviewConfirm'))
        ) return;
        const current = responsibilities.get(kind) ?? null;
        const responsibilityReason = responsibilityReasons[kind]?.trim() ?? '';
        setBusy(true);
        setError(null);
        try {
            await changeGovernanceCaseResponsibility({
                caseId: governanceCase.id,
                kind,
                action,
                targetPubkey: action === 'reassign' ? targetPubkey : null,
                reason: responsibilityReason || null,
                deadlineAt: action === 'reassign'
                    ? current?.deadlineAt
                        ?? (responsibilityDeadline ? new Date(responsibilityDeadline).toISOString() : null)
                    : action === 'extend_deadline' && responsibilityDeadline
                        ? new Date(responsibilityDeadline).toISOString()
                        : null,
                idempotencyKey: `case-responsibility:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
                expectedResponsibilityVersion: current?.version ?? 0,
            });
            setResponsibilityReasons((currentReasons) => ({
                ...currentReasons,
                [kind]: '',
            }));
            setResponsibilityDeadline('');
            await onRefresh();
        } catch {
            setError(t('workflow.actionError'));
        } finally {
            setBusy(false);
        }
    }

    async function submitManualExecutionEvidence() {
        if (!workflow.version || !canSubmitManualExecution) return;
        setBusy(true);
        setError(null);
        try {
            await submitGovernanceManualExecutionCompletion({
                caseId: governanceCase.id,
                evidence: [{
                    kind: manualEvidenceKind,
                    ref: manualEvidenceRef.trim(),
                    digest: manualEvidenceDigest.trim().toLowerCase().replace(/^sha256:/, ''),
                }],
                idempotencyKey: `manual-execution-submit:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
                expectedCompletionVersion: manualSubmission?.version ?? null,
            });
            setManualEvidenceRef('');
            setManualEvidenceDigest('');
            await onRefresh();
        } catch {
            setError(t('workflow.actionError'));
        } finally {
            setBusy(false);
        }
    }

    async function reviewManualExecutionEvidence() {
        if (!workflow.version || !canReviewManualExecution || !manualSubmission) return;
        setBusy(true);
        setError(null);
        try {
            await reviewGovernanceManualExecutionCompletion({
                caseId: governanceCase.id,
                decision: manualReviewDecision,
                reason: manualReviewReason.trim() || null,
                idempotencyKey: `manual-execution-review:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
                expectedCompletionVersion: manualSubmission.version,
            });
            setManualReviewReason('');
            await onRefresh();
        } catch {
            setError(t('workflow.actionError'));
        } finally {
            setBusy(false);
        }
    }

    async function startDrafting() {
        if (!workflow.version) return;
        setBusy(true);
        setError(null);
        try {
            await transitionGovernanceCase({
                caseId: governanceCase.id,
                toPhase: 'proposal_drafting',
                idempotencyKey: `case-transition:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.transitionError'));
        } finally {
            setBusy(false);
        }
    }

    async function closeCase() {
        if (!canSubmitClose || !workflow.version) return;
        setBusy(true);
        setError(null);
        try {
            await transitionGovernanceCase({
                caseId: governanceCase.id,
                toPhase: 'closed',
                idempotencyKey: `case-close:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
                actualOutcome: {
                    summary: outcomeSummary.trim(),
                    quantitativeImpact: outcomeLines(quantitativeImpact),
                    deviations: outcomeLines(outcomeDeviations),
                    failures: outcomeLines(outcomeFailures),
                    outstandingObligations: outcomeLines(outstandingObligations),
                    observationPeriod: {
                        startedAt: new Date(observationStartedAt).toISOString(),
                        endedAt: new Date(observationEndedAt).toISOString(),
                    },
                },
            });
            await onRefresh();
        } catch (error) {
            setError(closeErrorMessage(error, t));
        } finally {
            setBusy(false);
        }
    }

    async function recordReview() {
        if (
            !canRecordReview
            || !workflow.version
            || reviewReason.trim().length < 3
            || (reviewConclusion !== 'signoff_granted' && reviewPublicBasis.trim().length < 3)
        ) return;
        setBusy(true);
        setError(null);
        try {
            await recordGovernanceCaseReview({
                caseId: governanceCase.id,
                conclusion: reviewConclusion,
                reason: reviewReason,
                publicBasis: reviewConclusion === 'signoff_granted' ? null : reviewPublicBasis,
                idempotencyKey: `case-review:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
            });
            setReviewReason('');
            setReviewPublicBasis('');
            setReviewEditOpen(false);
            await onRefresh();
        } catch {
            setError(t('workflow.reviewError'));
        } finally {
            setBusy(false);
        }
    }

    async function declareReviewRelationship(actorRole: GovernanceCaseReviewRelationshipActorRole) {
        if (!canDeclareReviewRelationship || !workflow.version || !reviewRelationshipActorRoles.includes(actorRole)) return;
        const relationship = actorRole === 'proposer'
            ? selectedProposerRelationship
            : selectedReviewRelationship;
        setBusy(true);
        setError(null);
        try {
            await recordGovernanceCaseReviewRelationship({
                caseId: governanceCase.id,
                actorRole,
                relationship,
                idempotencyKey: `case-review-relationship:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.reviewRelationship.error'));
        } finally {
            setBusy(false);
        }
    }

    async function openApprovalStage() {
        if (!canOpenApproval || !workflow.version) return;
        setBusy(true);
        setError(null);
        try {
            await openGovernanceCaseApprovalStage({
                caseId: governanceCase.id,
                idempotencyKey: `case-approval-stage:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.approvalOpenError'));
        } finally {
            setBusy(false);
        }
    }

    async function discloseConflict() {
        if (!canDiscloseConflict || !workflow.version) return;
        setBusy(true);
        setError(null);
        try {
            await discloseGovernanceCaseApprovalConflict({
                caseId: governanceCase.id,
                publicReason: conflictReason,
                idempotencyKey: `case-approval-conflict:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.conflict.error'));
        } finally {
            setBusy(false);
        }
    }

    async function discloseGrantConflict() {
        if (!viewerPubkey || !workflow.version || !selectedGrantTarget || selectedGrantTarget.existing) return;
        setBusy(true);
        setError(null);
        try {
            await discloseGovernanceGrantReviewerConflict({
                caseId: governanceCase.id,
                artifactId: selectedGrantTarget.artifactId,
                projectRef: selectedGrantTarget.projectRef,
                publicReason: conflictReason,
                idempotencyKey: `grant-reviewer-conflict:${crypto.randomUUID()}`,
                expectedCaseVersion: workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.grant.conflictError'));
        } finally {
            setBusy(false);
        }
    }

    async function activateGrantAgreement() {
        if (!workflow.canManage || !selectedGrantTarget || selectedGrantTarget.existing) return;
        const primaryReviewerPubkeys = commaSeparatedValues(grantPrimaryReviewers);
        const alternateReviewerPubkeys = commaSeparatedValues(grantAlternateReviewers);
        const evidenceRequirements = commaSeparatedValues(grantEvidenceRequirements);
        const reviewerQuorum = Number(grantReviewerQuorum);
        const maxRevisions = Number(grantMaxRevisions);
        if (
            !grantMilestoneTitle.trim()
            || !grantDeliverable.trim()
            || evidenceRequirements.length === 0
            || !grantDeadline
            || primaryReviewerPubkeys.length === 0
            || !Number.isSafeInteger(reviewerQuorum)
            || reviewerQuorum < 1
            || !grantAcceptCriteria.trim()
            || !grantReworkCriteria.trim()
            || !grantRejectCriteria.trim()
            || !Number.isSafeInteger(maxRevisions)
            || maxRevisions < 0
        ) {
            setError(t('workflow.grant.formInvalid'));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await activateGovernanceGrantAgreement({
                caseId: governanceCase.id,
                artifactId: selectedGrantTarget.artifactId,
                projectRef: selectedGrantTarget.projectRef,
                milestones: [{
                    title: grantMilestoneTitle.trim(),
                    deliverable: grantDeliverable.trim(),
                    evidenceRequirements,
                    deadline: new Date(grantDeadline).toISOString(),
                    contractualUnits: selectedGrantTarget.totalPlannedUnits,
                    primaryReviewerPubkeys,
                    alternateReviewerPubkeys,
                    reviewerQuorum,
                    acceptCriteria: grantAcceptCriteria.trim(),
                    reworkCriteria: grantReworkCriteria.trim(),
                    rejectCriteria: grantRejectCriteria.trim(),
                    maxRevisions,
                }],
                idempotencyKey: `grant-agreement:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.grant.activationError'));
        } finally {
            setBusy(false);
        }
    }

    async function refreshGrantSettlementReadiness() {
        const agreement = selectedGrantTarget?.existing;
        if (!workflow.canManage || !agreement) return;
        setBusy(true);
        setError(null);
        try {
            await refreshGovernanceGrantSettlementReadiness({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                expectedEvaluationVersion: agreement.settlementReadinessVersion,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.grant.settlementRefreshError'));
        } finally {
            setBusy(false);
        }
    }

    async function recordGrantMilestoneReview() {
        const agreement = selectedGrantTarget?.existing;
        const milestone = agreement?.terms.milestones[0];
        const evidenceRefs = commaSeparatedValues(grantReviewEvidence);
        if (!agreement || !milestone || evidenceRefs.length === 0 || !grantReviewSummary.trim()) return;
        setBusy(true);
        setError(null);
        try {
            await recordGovernanceGrantMilestoneReview({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                milestoneId: milestone.id,
                outcome: grantReviewOutcome,
                evidenceRefs,
                summary: grantReviewSummary.trim(),
                idempotencyKey: `grant-milestone-review:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('reviewError'));
        } finally {
            setBusy(false);
        }
    }

    async function openGrantAppeal(resultDigest: string) {
        const agreement = selectedGrantTarget?.existing;
        const milestone = agreement?.terms.milestones[0];
        if (!agreement || !milestone || !grantAppealReason.trim()) return;
        setBusy(true);
        setError(null);
        try {
            await openGovernanceGrantMilestoneAppeal({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                milestoneId: milestone.id,
                originalResultDigest: resultDigest,
                reason: grantAppealReason.trim(),
                evidenceRefs: commaSeparatedValues(grantAppealEvidence),
                idempotencyKey: `grant-milestone-appeal:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('appealError'));
        } finally {
            setBusy(false);
        }
    }

    async function voteGrantAppeal(appealId: string) {
        const agreement = selectedGrantTarget?.existing;
        if (!agreement || !grantAppealVoteReason.trim()) return;
        setBusy(true);
        setError(null);
        try {
            await recordGovernanceGrantMilestoneAppealVote({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                appealId,
                vote: grantAppealVote,
                reason: grantAppealVoteReason.trim(),
                idempotencyKey: `grant-appeal-vote:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('appealVoteError'));
        } finally {
            setBusy(false);
        }
    }

    async function openGrantAmendmentCase() {
        const agreement = selectedGrantTarget?.existing;
        const milestone = agreement?.terms.milestones[0];
        if (!agreement || !milestone || !grantAmendmentDeadline || !grantAmendmentReason.trim()) return;
        const proposedTerms = structuredClone(agreement.terms) as Record<string, any>;
        proposedTerms.milestones[0].deadline = new Date(grantAmendmentDeadline).toISOString();
        proposedTerms.schedule = {
            ...proposedTerms.schedule,
            milestoneDeadlines: proposedTerms.milestones.map((item: any) => item.deadline),
        };
        setBusy(true);
        setError(null);
        try {
            await openGovernanceGrantAgreementAmendmentCase({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                proposedTerms,
                reason: grantAmendmentReason.trim(),
                idempotencyKey: `grant-amendment-case:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('amendmentError'));
        } finally {
            setBusy(false);
        }
    }

    async function openProviderTerminalAbandonmentCase() {
        if (!workflow.canManage || terminalAbandonmentReason.trim().length < 3) return;
        setBusy(true);
        setError(null);
        try {
            const result = await openGovernanceProviderExecutionTerminalAbandonmentCase({
                caseId: governanceCase.id,
                reason: terminalAbandonmentReason.trim(),
                idempotencyKey: `provider-terminal-abandonment:${crypto.randomUUID()}`,
            });
            setTerminalAbandonmentCaseId(result.case.id);
            await onRefresh();
        } catch {
            setError('Unable to open the governed terminal-abandonment Case.');
        } finally {
            setBusy(false);
        }
    }

    async function openProviderCompensationPlanCase() {
        if (!workflow.canManage || compensationPlanReason.trim().length < 3) return;
        setBusy(true);
        setError(null);
        try {
            const result = await openGovernanceProviderExecutionCompensationPlanCase({
                caseId: governanceCase.id,
                reason: compensationPlanReason.trim(),
                idempotencyKey: `provider-compensation-plan:${crypto.randomUUID()}`,
            });
            setCompensationPlanCaseId(result.case.id);
            await onRefresh();
        } catch {
            setError('Unable to open the governed compensation-plan Case.');
        } finally {
            setBusy(false);
        }
    }

    async function openGrantTerminationCase() {
        const agreement = selectedGrantTarget?.existing;
        const retainedObligations = commaSeparatedValues(grantRetainedObligations);
        if (!agreement || agreement.status !== 'active' || !grantTerminationReason.trim() || retainedObligations.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            await openGovernanceGrantAgreementTerminationCase({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                ground: grantTerminationGround,
                reason: grantTerminationReason.trim(),
                retainedObligations,
                outstandingObligations: commaSeparatedValues(grantOutstandingObligations),
                idempotencyKey: `grant-termination-case:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('terminationError'));
        } finally {
            setBusy(false);
        }
    }

    async function applyGrantTermination() {
        const agreement = selectedGrantTarget?.existing;
        if (!agreement || !agreement.lifecycle.terminationRequest || agreement.lifecycle.termination) return;
        setBusy(true);
        setError(null);
        try {
            await applyAcceptedGovernanceGrantAgreementTermination({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                idempotencyKey: `grant-termination-apply:${agreement.lifecycle.terminationRequest.caseId}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('terminationApplyError'));
        } finally {
            setBusy(false);
        }
    }

    async function recordGrantOutcome() {
        const agreement = selectedGrantTarget?.existing;
        const actualImpact = commaSeparatedValues(grantActualImpact);
        const evidenceRefs = commaSeparatedValues(grantOutcomeEvidence);
        if (
            !agreement
            || !grantOutcomeSummary.trim()
            || actualImpact.length === 0
            || evidenceRefs.length === 0
            || !grantObservationStartedAt
            || !grantObservationEndedAt
        ) return;
        setBusy(true);
        setError(null);
        try {
            await recordGovernanceGrantOutcome({
                caseId: governanceCase.id,
                agreementId: agreement.id,
                status: agreement.status === 'terminated' ? 'terminated' : grantOutcomeStatus,
                summary: grantOutcomeSummary.trim(),
                actualImpact,
                outstandingObligations: commaSeparatedValues(grantOutcomeOutstanding),
                evidenceRefs,
                observationStartedAt: new Date(grantObservationStartedAt).toISOString(),
                observationEndedAt: new Date(grantObservationEndedAt).toISOString(),
                idempotencyKey: `grant-outcome:${crypto.randomUUID()}`,
            });
            await onRefresh();
        } catch {
            setError(grantLifecycleT('outcomeError'));
        } finally {
            setBusy(false);
        }
    }

    async function submitApprovalSignal(value: 'approve' | 'reject' | 'abstain') {
        const request = governanceCase.primaryRequest;
        if (!viewerPubkey || !request || !signMessage) {
            setError(t('workflow.walletRequired'));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const challenge = await prepareGovernanceRequestSignal({
                requestId: request.id,
                actorPubkey: viewerPubkey,
                value,
            });
            const signature = await signMessageForAction({
                kind: 'governance_signal',
                source: 'governance_case_approval_stage',
                key: `governance_case_signal:${request.id}:${value}`,
                message: challenge.signedMessage,
            });
            await submitGovernanceRequestSignal({
                requestId: request.id,
                actorPubkey: viewerPubkey,
                value,
                signature: bytesToBase64(signature),
                signedMessage: challenge.signedMessage,
                nonce: challenge.envelope.nonce,
                expiresAt: challenge.envelope.expiresAt,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.signalError'));
            await onRefresh().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    }

    async function submitQuadraticVoiceSignal() {
        const request = governanceCase.primaryRequest;
        if (
            !viewerPubkey
            || !request
            || !signMessage
            || !quadraticVoice
            || !quadraticVectorReady
            || !approvalStage?.mechanism
            || 'status' in approvalStage.mechanism
            || approvalStage.mechanism.kind !== 'quadratic_voice_credits'
        ) {
            setError(t('workflow.signalError'));
            return;
        }
        const evidence = {
            schemaVersion: 1,
            mechanism: 'quadratic_voice_credits',
            choiceVector: quadraticVoice.choices.map((choice) => ({
                choiceId: choice.id,
                votes: Number(quadraticVotes[choice.id] ?? 0),
            })),
            creditBudget: quadraticVoice.creditBudgetPerActor,
            cost: quadraticCost,
            mechanismContractDigest: approvalStage.mechanism.contractDigest,
        };
        setBusy(true);
        setError(null);
        try {
            const challenge = await prepareGovernanceRequestSignal({
                requestId: request.id,
                actorPubkey: viewerPubkey,
                value: 'quadratic_voice_credits',
                evidence,
            });
            const signature = await signMessageForAction({
                kind: 'governance_signal',
                source: 'governance_case_approval_stage',
                key: `governance_case_qv_signal:${request.id}`,
                message: challenge.signedMessage,
            });
            await submitGovernanceRequestSignal({
                requestId: request.id,
                actorPubkey: viewerPubkey,
                value: 'quadratic_voice_credits',
                evidence,
                signature: bytesToBase64(signature),
                signedMessage: challenge.signedMessage,
                nonce: challenge.envelope.nonce,
                expiresAt: challenge.envelope.expiresAt,
            });
            setQuadraticVotes({});
            await onRefresh();
        } catch {
            setError(t('workflow.signalError'));
            await onRefresh().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    }

    async function submitQuadraticFundingCommitment() {
        const request = governanceCase.primaryRequest;
        if (
            !viewerPubkey
            || !request
            || !signMessage
            || !quadraticFunding
            || !quadraticCommitmentReady
            || !approvalStage?.mechanism
            || 'status' in approvalStage.mechanism
            || approvalStage.mechanism.kind !== 'quadratic_funding'
        ) {
            setError(t('workflow.signalError'));
            return;
        }
        const evidence = {
            schemaVersion: 1,
            mechanism: 'quadratic_funding',
            commitments: quadraticFunding.projects.map((project) => ({
                projectId: project.id,
                amount: Number(quadraticCommitments[project.id] ?? 0),
            })),
            budgetUnit: quadraticFunding.budgetUnit,
            totalCommitment: quadraticCommitmentTotal,
            mechanismContractDigest: approvalStage.mechanism.contractDigest,
        };
        setBusy(true);
        setError(null);
        try {
            const challenge = await prepareGovernanceRequestSignal({
                requestId: request.id,
                actorPubkey: viewerPubkey,
                value: 'quadratic_funding',
                evidence,
            });
            const signature = await signMessageForAction({
                kind: 'governance_signal',
                source: 'governance_case_approval_stage',
                key: `governance_case_qf_commitment:${request.id}`,
                message: challenge.signedMessage,
            });
            await submitGovernanceRequestSignal({
                requestId: request.id,
                actorPubkey: viewerPubkey,
                value: 'quadratic_funding',
                evidence,
                signature: bytesToBase64(signature),
                signedMessage: challenge.signedMessage,
                nonce: challenge.envelope.nonce,
                expiresAt: challenge.envelope.expiresAt,
            });
            setQuadraticCommitments({});
            await onRefresh();
        } catch {
            setError(t('workflow.signalError'));
            await onRefresh().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    }

    async function cancelApprovalStage() {
        if (!canCancelApproval || !workflow.version) return;
        if (!window.confirm(t('workflow.ballot.cancelConfirm'))) return;
        setBusy(true);
        setError(null);
        try {
            await cancelGovernanceCaseApprovalStage({
                caseId: governanceCase.id,
                expectedCaseVersion: workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('workflow.ballot.cancelError'));
            await onRefresh().catch(() => undefined);
        } finally {
            setBusy(false);
        }
    }

    if (workflow.legacy) {
        return (
            <section className={styles.panel} aria-labelledby="case-workflow-title">
                <h2 id="case-workflow-title">{t('workflow.title')}</h2>
                <p>{t('workflow.legacy')}</p>
            </section>
        );
    }

    async function downloadProviderAdmissionPackage(
        operation: 'issue' | 'read',
    ): Promise<void> {
        if (
            !canExportProviderAdmission
            || providerAdmissionBusy
            || providerAdmissionInFlightRef.current
            || providerAdmissionCoolingDown
        ) {
            return;
        }
        if (operation === 'issue' && providerAdmissionAvailable === true) {
            setProviderAdmissionError(t('workflow.providerAdmission.alreadyIssued'));
            return;
        }
        if (operation === 'read' && providerAdmissionAvailable === false) {
            setProviderAdmissionError(t('workflow.providerAdmission.notIssuedYet'));
            return;
        }
        providerAdmissionInFlightRef.current = true;
        setProviderAdmissionBusy(true);
        setProviderAdmissionError(null);
        setProviderAdmissionStatus(null);
        try {
            const submission = operation === 'issue'
                ? await issueProviderAdmissionExternalCredential(governanceCase.id)
                : await readProviderAdmissionExternalCredential(governanceCase.id);
            const jws = String(submission.credentialJws || '').trim();
            if (!jws) {
                throw new Error('route_a_provider_admission_credential_empty');
            }
            setProviderAdmissionJws(jws);
            const saved = await downloadCredentialBytes(governanceCase.id, submission);
            if (providerAdmissionSaveLinkRef.current?.objectUrl) {
                URL.revokeObjectURL(providerAdmissionSaveLinkRef.current.objectUrl);
            }
            providerAdmissionSaveLinkRef.current = saved;
            setProviderAdmissionSaveLink(saved);
            setProviderAdmissionAvailable(true);
            setProviderAdmissionStatus(
                operation === 'issue'
                    ? t('workflow.providerAdmission.generateDone')
                    : t('workflow.providerAdmission.exportDone', { filename: saved.filename }),
            );
            setProviderAdmissionCooldownUntil(Date.now() + 2500);
        } catch (error) {
            setProviderAdmissionJws(null);
            let code = error && typeof error === 'object' && 'message' in error
                ? String((error as { message?: unknown }).message ?? '')
                : '';
            const jsonMatch = code.match(/\{[\s\S]*\}$/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]) as { error?: unknown };
                    if (typeof parsed.error === 'string' && parsed.error.trim()) {
                        code = parsed.error.trim();
                    }
                } catch {
                    // keep raw
                }
            }
            code = code.replace(/^\d{3}\s+/, '').trim();
            if (operation === 'read' && /not_found/i.test(code)) {
                setProviderAdmissionAvailable(false);
            }
            const mapped = code === 'route_a_provider_admission_credential_disabled'
                || code.includes('credential_disabled')
                ? t('workflow.providerAdmission.credentialDisabled')
                : code === 'route_a_provider_admission_credential_not_found'
                    ? t('workflow.providerAdmission.notIssuedYet')
                    : code === 'route_a_provider_admission_credential_unavailable'
                        || code.includes('credential_unavailable')
                        ? t('workflow.providerAdmission.credentialUnavailable')
                        : code.includes('private_sidecar_required')
                            ? t('workflow.providerAdmission.sidecarRequired')
                            : code || t('workflow.providerAdmission.exportError');
            setProviderAdmissionError(mapped);
        } finally {
            providerAdmissionInFlightRef.current = false;
            setProviderAdmissionBusy(false);
        }
    }

    async function copyProviderAdmissionJws(): Promise<void> {
        if (!providerAdmissionJws) return;
        try {
            await navigator.clipboard.writeText(providerAdmissionJws);
            setProviderAdmissionStatus(t('workflow.providerAdmission.copiedJws'));
        } catch {
            setProviderAdmissionError(t('workflow.providerAdmission.copyJwsFailed'));
        }
    }

    const renderResponsibilityCard = (
        kind: GovernanceCaseResponsibilityKind,
        currentPhase: boolean,
    ) => {
        const responsibility = responsibilities.get(kind) ?? null;
        const selfActions = responsibility
            ? responsibilitySelfActions(responsibility.status)
            : null;
        const isViewerAssignee = Boolean(
            viewerPubkey
            && responsibility?.assigneePubkey === viewerPubkey,
        );
        const reviewCompleted = kind === 'review'
            && Boolean(currentSignoff)
            && currentSignoff?.actorPubkey === responsibility?.assigneePubkey;
        const showSelfActions = Boolean(
            currentPhase
            && !caseTerminal
            && !reviewCompleted
            && isViewerAssignee
            && selfActions
            && Object.values(selfActions).some(Boolean),
        );
        const responsibilityReason = responsibilityReasons[kind] ?? '';
        const reasonReady = responsibilityReason.trim().length >= 3;
        return (
            <article
                key={kind}
                id={`case-responsibility-${kind}`}
                data-responsibility-kind={kind}
                data-responsibility-status={responsibility?.status ?? 'unassigned'}
            >
                <span><UserRoundCheck size={16} />{t(`workflow.kind.${kind}`)}</span>
                <strong>{responsibility
                    ? candidateLabel(workflow.candidates, responsibility.assigneePubkey)
                    : currentPhase
                        ? t('workflow.unassignedRequired')
                        : t('workflow.notAssignedYet')}</strong>
                <small>{reviewCompleted
                    ? t('workflow.reviewCompleted')
                    : responsibility
                        ? t(`workflow.status.${responsibility.status}`)
                        : currentPhase
                            ? t('workflow.currentPhaseRequired')
                            : t('workflow.notRequiredNow')}</small>
                {reviewCompleted && currentSignoff?.createdAt ? (
                    <small>{t('workflow.completedAt', {
                        value: new Date(currentSignoff.createdAt).toLocaleString(),
                    })}</small>
                ) : null}
                {responsibility?.deadlineAt ? (
                    <small>{t('workflow.deadlineReadback', {
                        value: new Date(responsibility.deadlineAt).toLocaleString(),
                    })}</small>
                ) : null}
                {responsibility && !reviewCompleted ? (
                    <>
                        <small data-responsibility-sla-state={responsibilitySlaState(responsibility)}>
                            {t(`workflow.sla.state.${responsibilitySlaState(responsibility)}`)}
                        </small>
                        <small>{t('workflow.sla.ladder')}</small>
                    </>
                ) : null}
                {showSelfActions && selfActions ? (
                    <div className={styles.responsibilitySelfActions}>
                        <p>{t('workflow.selfActions.boundary', {
                            responsibility: t(`workflow.kind.${kind}`),
                        })}</p>
                        {selfActions.accept ? (
                            <div className={styles.responsibilityPrimaryActions}>
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void runResponsibilityAction(kind, 'accept')}
                                >
                                    <Check size={14} />
                                    {t(responsibility?.status === 'assigned'
                                        ? 'workflow.selfActions.accept'
                                        : 'workflow.selfActions.resume')}
                                </button>
                            </div>
                        ) : null}
                        {(selfActions.decline || selfActions.escalate || selfActions.absence) ? (
                            <details className={styles.responsibilityMoreActions}>
                                <summary>{t('workflow.selfActions.more')}</summary>
                                <div className={styles.responsibilityResponseBody}>
                                    <label>
                                        <span>{t('workflow.selfActions.reason')}</span>
                                        <input
                                            aria-label={t('workflow.selfActions.reasonFor', {
                                                responsibility: t(`workflow.kind.${kind}`),
                                            })}
                                            value={responsibilityReason}
                                            onChange={(event) => setResponsibilityReasons((currentReasons) => ({
                                                ...currentReasons,
                                                [kind]: event.target.value,
                                            }))}
                                            maxLength={500}
                                        />
                                        <small>{t('workflow.selfActions.reasonHint')}</small>
                                    </label>
                                    <div className={styles.responsibilitySecondaryActions}>
                                        {selfActions.decline ? (
                                            <button
                                                type="button"
                                                disabled={busy || !reasonReady}
                                                onClick={() => void runResponsibilityAction(kind, 'decline')}
                                            >
                                                {t(responsibility?.status === 'accepted'
                                                    ? 'workflow.selfActions.leave'
                                                    : 'workflow.selfActions.decline')}
                                            </button>
                                        ) : null}
                                        {selfActions.escalate ? (
                                            <button
                                                type="button"
                                                disabled={busy || !reasonReady}
                                                onClick={() => void runResponsibilityAction(kind, 'escalate')}
                                            >
                                                {t('workflow.selfActions.escalate')}
                                            </button>
                                        ) : null}
                                        {selfActions.absence ? (
                                            <button
                                                type="button"
                                                disabled={busy || !reasonReady}
                                                onClick={() => void runResponsibilityAction(kind, 'absence')}
                                            >
                                                {t('workflow.selfActions.absence')}
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </details>
                        ) : null}
                    </div>
                ) : null}
            </article>
        );
    };

    const timelineIsCondensed = workflow.timeline.length > 4;
    const timelineOpeningEvents = timelineIsCondensed ? workflow.timeline.slice(0, 1) : workflow.timeline;
    const timelineMiddleEvents = timelineIsCondensed ? workflow.timeline.slice(1, -2) : [];
    const timelineRecentEvents = timelineIsCondensed ? workflow.timeline.slice(-2) : [];
    const renderTimelineEvent = (event: (typeof workflow.timeline)[number]) => {
        const hasTimelineDetails = Boolean(
            event.reviewThreadId
            || event.responsibilityDeadlineAt
            || (
                event.eventType === 'review_relationship_declared'
                && event.fromState
                && event.toState
            )
            || event.briefSnapshotInvalidationReason
            || (
                event.reviewPublicBasis
                && event.eventType !== 'grant_reviewer_conflict_disclosed'
            )
            || event.reason,
        );
        const showReason = Boolean(
            event.reason
            && !(
                event.reason === 'brief_snapshot_changed'
                && event.briefSnapshotInvalidationReason
            ),
        );

        return (
            <li className={styles.timelineItem} key={event.id} data-timeline-event={event.eventType}>
                <div className={styles.timelineEventHeader}>
                    <strong>{event.eventType === 'grant_reviewer_conflict_disclosed'
                        ? t('workflow.grant.discloseConflict')
                        : t(`workflow.event.${event.eventType}`)}</strong>
                    {event.createdAt ? (
                        <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                    ) : null}
                </div>
                <div className={styles.timelineMeta}>
                    <span>{t('workflow.timelineActor', {
                        actor: event.actorPubkey
                            ? candidateLabel(workflow.candidates, event.actorPubkey)
                            : t('workflow.timelineSystem'),
                    })}</span>
                    <span>{event.responsibilityKind
                        ? t(`workflow.kind.${event.responsibilityKind}`)
                        : t('workflow.caseRecord')}</span>
                </div>
                {event.subjectPubkey && event.subjectPubkey !== event.actorPubkey ? (
                    <small>{t('workflow.timelineTarget', {
                        target: candidateLabel(workflow.candidates, event.subjectPubkey),
                    })}</small>
                ) : null}
                {event.eventType === 'review_conclusion_recorded' && event.toState ? (
                    <small>{t(`workflow.conclusion.${event.toState}`)}</small>
                ) : null}
                {event.eventType === 'review_conclusion_recorded' && event.briefSnapshotStatus ? (
                    <small className={event.briefSnapshotStatus === 'invalidated' ? styles.invalidated : styles.current}>
                        {t(`workflow.snapshot.${event.briefSnapshotStatus}`)}
                    </small>
                ) : null}
                {hasTimelineDetails ? (
                    <details className={styles.timelineEventDetails}>
                        <summary>
                            <span>{t('workflow.timelineDetails')}</span>
                            <ChevronDown aria-hidden="true" size={15} />
                        </summary>
                        <div>
                            {event.reviewThreadId ? <small>{t('workflow.reviewThread', { id: event.reviewThreadId })}</small> : null}
                            {event.responsibilityDeadlineAt ? (
                                <small>{t('workflow.deadlineReadback', {
                                    value: new Date(event.responsibilityDeadlineAt).toLocaleString(),
                                })}</small>
                            ) : null}
                            {event.eventType === 'review_relationship_declared' && event.fromState && event.toState ? (
                                <small>{t('workflow.reviewRelationship.timeline', {
                                    role: t(`workflow.reviewRelationship.role.${event.fromState}`),
                                    relationship: t(`workflow.reviewRelationship.value.${event.toState}`),
                                })}</small>
                            ) : null}
                            {event.briefSnapshotInvalidationReason ? <p>{t('workflow.snapshot.brief_snapshot_changed')}</p> : null}
                            {event.reviewPublicBasis && event.eventType !== 'grant_reviewer_conflict_disclosed'
                                ? <p>{t('workflow.reviewPublicBasisDisplay', { basis: event.reviewPublicBasis })}</p>
                                : null}
                            {showReason ? <p>{event.reason === 'brief_snapshot_changed'
                                ? t('workflow.snapshot.brief_snapshot_changed')
                                : event.eventType === 'case_closed'
                                    ? t('workflow.closeBoundary')
                                    : event.eventType === 'approval_conflict_disclosed'
                                        || event.eventType === 'grant_reviewer_conflict_disclosed'
                                        ? t(`workflow.conflict.reasonCode.${event.reason}`)
                                        : event.reason}</p> : null}
                        </div>
                    </details>
                ) : null}
            </li>
        );
    };

    return (
        <section className={styles.panel} aria-labelledby="case-workflow-title">
            <div id="case-focus-action" className={styles.heading}>
                <div>
                    <p>{t('workflow.eyebrow')}</p>
                    <h2 id="case-workflow-title">{t('workflow.title')}</h2>
                </div>
                {canRecordReview && !currentViewerReview ? (
                    composeReviewActive ? null : (
                        <a className={styles.primaryButton} href="#case-review-focus">
                            {t('workflow.recordReview')}
                        </a>
                    )
                ) : canStartDrafting ? (
                    <button type="button" onClick={() => void startDrafting()} disabled={busy}>
                        {busy ? <RefreshCw size={15} className={styles.spin} /> : <ArrowUpRight size={15} />}
                        {t('workflow.startDrafting')}
                    </button>
                ) : canAttemptOpenApproval ? (
                    <button
                        type="button"
                        onClick={() => void openApprovalStage()}
                        disabled={busy || !canOpenApproval}
                        aria-describedby={approvalStageBlocker ? 'case-approval-stage-blocker' : undefined}
                        title={approvalStageBlocker ?? undefined}
                    >
                        {busy ? <RefreshCw size={15} className={styles.spin} /> : <ArrowUpRight size={15} />}
                        {t('workflow.openApproval')}
                    </button>
                ) : canCloseCase ? (
                    <button
                        type="button"
                        onClick={() => requestCloseCase()}
                        aria-disabled={busy || !canSubmitClose}
                        title={closeBlockers[0] ? t(`workflow.actualOutcome.submitHint.${closeBlockers[0]}`) : undefined}
                    >
                        {busy ? <RefreshCw size={15} className={styles.spin} /> : <Check size={15} />}
                        {t('workflow.closeCase')}
                    </button>
                ) : null}
            </div>
            {approvalStageBlocker ? (
                <p id="case-approval-stage-blocker" className={styles.actionBlocker} role="status">
                    <XCircle size={16} aria-hidden="true" />
                    <span>{approvalStageBlocker}</span>
                </p>
            ) : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {canRecordReview ? (
                <section
                    id="case-review-focus"
                    className={styles.reviewBlock}
                    aria-labelledby="case-review-focus-title"
                    data-compose-slot="case-review-focus"
                >
                    {composeReviewActive && composeDockElement ? (
                        <div className={styles.composePlaceholder} data-compose-placeholder="case-review-focus">
                            <p>{t('compose.placeholderInDock')}</p>
                            <button
                                type="button"
                                onClick={() => {
                                    document.getElementById('case-compose-dock')?.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'nearest',
                                    });
                                }}
                            >
                                {t('compose.jumpToDock')}
                            </button>
                        </div>
                    ) : null}
                    <ComposePortal
                        shouldPortal={Boolean(composeReviewActive && composeDockElement)}
                        targetEl={composeDockElement}
                    >
                        <div data-compose-review-cluster="">
                            <p>{t('workflow.focus.eyebrow')}</p>
                            <h3 id="case-review-focus-title">{t('workflow.focus.reviewTitle')}</h3>
                            <p>{t('workflow.focus.reviewBody')}</p>
                            <ol className={styles.reviewSteps}>
                                {canDeclareReviewerRelationship ? (
                                    <li
                                        className={styles.reviewStep}
                                        data-testid="review-step-relationship"
                                        data-step-state={reviewRelationshipRecorded ? 'complete' : 'current'}
                                    >
                                        <div className={styles.reviewStepHeader}>
                                            <span className={styles.reviewStepNumber} aria-hidden="true">1</span>
                                            <div>
                                                <strong>{t('workflow.focus.relationshipStepTitle')}</strong>
                                                <small>{t('workflow.focus.relationshipStepBody')}</small>
                                            </div>
                                            <span className={styles.reviewStepState}>
                                                {t(`workflow.focus.stepState.${reviewRelationshipRecorded ? 'complete' : 'current'}`)}
                                            </span>
                                        </div>
                                        <div className={styles.controls}>
                                            <label>
                                                <span>{t('workflow.reviewRelationship.title', { role: t('workflow.reviewRelationship.role.reviewer') })}</span>
                                                <Select
                                                    ariaLabel={t('workflow.reviewRelationship.title', { role: t('workflow.reviewRelationship.role.reviewer') })}
                                                    value={selectedReviewRelationship}
                                                    onChange={(value) => setReviewRelationship(value as GovernanceCaseReviewRelationship)}
                                                    options={REVIEW_RELATIONSHIPS.map((value) => ({
                                                        value,
                                                        label: t(`workflow.reviewRelationship.value.${value}`),
                                                    }))}
                                                />
                                            </label>
                                            <div className={styles.actionRow}>
                                                <button
                                                    type="button"
                                                    disabled={busy || reviewRelationshipRecorded}
                                                    onClick={() => void declareReviewRelationship('reviewer')}
                                                >
                                                    {t('workflow.reviewRelationship.role.reviewer')} · {t('workflow.reviewRelationship.record')}
                                                </button>
                                            </div>
                                            {reviewRelationshipRecorded ? (
                                                <p className={styles.reviewStepReadback} role="status">
                                                    <Check size={15} aria-hidden="true" />
                                                    {t('workflow.focus.relationshipRecorded', {
                                                        relationship: t(`workflow.reviewRelationship.value.${selectedReviewRelationship}`),
                                                    })}
                                                </p>
                                            ) : null}
                                            <small>{t('workflow.reviewRelationship.boundary')}</small>
                                        </div>
                                    </li>
                                ) : null}
                                {canRecordReview ? (
                                    <li
                                        className={styles.reviewStep}
                                        data-testid="review-step-conclusion"
                                        data-step-state={currentViewerReview && !reviewEditOpen
                                            ? 'complete'
                                            : reviewStepUnlocked ? 'current' : 'locked'}
                                    >
                                        <div className={styles.reviewStepHeader}>
                                            <span className={styles.reviewStepNumber} aria-hidden="true">2</span>
                                            <div>
                                                <strong>{t('workflow.focus.reviewStepTitle')}</strong>
                                                <small>{t('workflow.focus.reviewStepBody')}</small>
                                            </div>
                                            <span className={styles.reviewStepState}>
                                                {t(`workflow.focus.stepState.${currentViewerReview && !reviewEditOpen
                                                    ? 'complete'
                                                    : reviewStepUnlocked ? 'current' : 'locked'}`)}
                                            </span>
                                        </div>
                                        {currentViewerReview && !reviewEditOpen ? (
                                            <div className={styles.reviewRecorded} role="status" aria-live="polite">
                                                <strong>{t('workflow.focus.reviewRecordedTitle')}</strong>
                                                <p>{t('workflow.focus.reviewRecordedBody')}</p>
                                                <small>
                                                    {t('workflow.focus.reviewRecordedConclusion', {
                                                        conclusion: t(`workflow.conclusion.${currentViewerReview.toState}`),
                                                    })}
                                                </small>
                                                {currentViewerReview.reason ? <small>{currentViewerReview.reason}</small> : null}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (REVIEW_CONCLUSIONS.includes(currentViewerReview.toState as GovernanceCaseReviewConclusion)) {
                                                            setReviewConclusion(currentViewerReview.toState as GovernanceCaseReviewConclusion);
                                                        }
                                                        setReviewReason(currentViewerReview.reason ?? '');
                                                        setReviewPublicBasis(currentViewerReview.reviewPublicBasis ?? '');
                                                        setReviewEditOpen(true);
                                                    }}
                                                >
                                                    {t('workflow.focus.updateReview')}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className={styles.controls} aria-disabled={!reviewStepUnlocked}>
                                                <label>
                                                    <span>{t('workflow.reviewConclusion')}</span>
                                                    <Select
                                                        ariaLabel={t('workflow.reviewConclusion')}
                                                        value={reviewConclusion}
                                                        disabled={!reviewStepUnlocked || busy}
                                                        onChange={(value) => setReviewConclusion(value as GovernanceCaseReviewConclusion)}
                                                        options={REVIEW_CONCLUSIONS.map((value) => ({
                                                            value,
                                                            label: t(`workflow.conclusion.${value}`),
                                                        }))}
                                                    />
                                                </label>
                                                {reviewConclusion !== 'signoff_granted' ? (
                                                    <label className={styles.reason}>
                                                        <span>{t('workflow.reviewPublicBasis')}</span>
                                                        <input disabled={!reviewStepUnlocked || busy} value={reviewPublicBasis} onChange={(event) => setReviewPublicBasis(event.target.value)} maxLength={240} />
                                                        <small>{t('workflow.reviewPublicBasisBoundary')}</small>
                                                    </label>
                                                ) : null}
                                                <label className={styles.reason}>
                                                    <span>{t('workflow.reason')}</span>
                                                    <input
                                                        disabled={!reviewStepUnlocked || busy}
                                                        value={reviewReason}
                                                        onChange={(event) => setReviewReason(event.target.value)}
                                                        maxLength={500}
                                                        placeholder={t('workflow.focus.reasonPlaceholder')}
                                                    />
                                                    <small>{t('workflow.focus.reasonHint')}</small>
                                                </label>
                                                <button
                                                    type="button"
                                                    className={styles.primaryButton}
                                                    disabled={!reviewStepUnlocked || busy || reviewReason.trim().length < 3 || (reviewConclusion !== 'signoff_granted' && reviewPublicBasis.trim().length < 3)}
                                                    onClick={() => void recordReview()}
                                                >
                                                    {t('workflow.recordReview')}
                                                </button>
                                                {!reviewStepUnlocked ? (
                                                    <small>{t('workflow.focus.reviewStepLocked')}</small>
                                                ) : reviewReason.trim().length < 3 ? (
                                                    <small>{t('workflow.focus.ctaDisabledHint')}</small>
                                                ) : null}
                                            </div>
                                        )}
                                    </li>
                                ) : null}
                            </ol>
                        </div>
                    </ComposePortal>
                </section>
            ) : null}
            {canDeclareProposerRelationship ? (
                <details className={styles.proposerDisclosure} data-testid="case-proposer-disclosure">
                    <summary>
                        <span>{t('workflow.reviewRelationship.proposerTitle')}</span>
                        <small>{proposerRelationshipRecorded
                            ? t('workflow.focus.stepState.complete')
                            : t('workflow.optional')}</small>
                    </summary>
                    <p>{t('workflow.reviewRelationship.proposerBoundary')}</p>
                    <div className={styles.controls}>
                        <label>
                            <span>{t('workflow.reviewRelationship.proposerTitle')}</span>
                            <Select
                                ariaLabel={t('workflow.reviewRelationship.proposerTitle')}
                                value={selectedProposerRelationship}
                                onChange={(value) => setProposerReviewRelationship(value as GovernanceCaseReviewRelationship)}
                                options={REVIEW_RELATIONSHIPS.map((value) => ({
                                    value,
                                    label: t(`workflow.reviewRelationship.value.${value}`),
                                }))}
                            />
                        </label>
                        <div className={styles.actionRow}>
                            <button
                                type="button"
                                disabled={busy || proposerRelationshipRecorded}
                                onClick={() => void declareReviewRelationship('proposer')}
                            >
                                {t('workflow.reviewRelationship.record')}
                            </button>
                        </div>
                        {proposerRelationshipRecorded ? (
                            <p className={styles.reviewStepReadback} role="status">
                                <Check size={15} aria-hidden="true" />
                                {t('workflow.focus.relationshipRecorded', {
                                    relationship: t(`workflow.reviewRelationship.value.${selectedProposerRelationship}`),
                                })}
                            </p>
                        ) : null}
                    </div>
                </details>
            ) : null}
            {canExportProviderAdmission ? (
                <section className={styles.stages} aria-labelledby="case-provider-admission-export-title">
                    <div className={styles.stageHeading}>
                        <h3 id="case-provider-admission-export-title">{t('workflow.providerAdmission.title')}</h3>
                        <span>{t('workflow.providerAdmission.boundary')}</span>
                    </div>
                    <p className={styles.boundary}>{t('workflow.providerAdmission.idempotentHint')}</p>
                    <div className={styles.actionRow}>
                        <button
                            type="button"
                            disabled={
                                providerAdmissionBusy
                                || providerAdmissionCoolingDown
                                || providerAdmissionAvailable === true
                                || providerAdmissionAvailable === null
                            }
                            onClick={() => void downloadProviderAdmissionPackage('issue')}
                        >
                            {providerAdmissionBusy
                                ? <RefreshCw size={14} className={styles.spin} />
                                : <ArrowUpRight size={14} />}
                            {providerAdmissionAvailable === true
                                ? t('workflow.providerAdmission.generateDone')
                                : t('workflow.providerAdmission.generate')}
                        </button>
                        <button
                            type="button"
                            disabled={
                                providerAdmissionBusy
                                || providerAdmissionCoolingDown
                                || providerAdmissionAvailable === false
                                || providerAdmissionAvailable === null
                            }
                            onClick={() => void downloadProviderAdmissionPackage('read')}
                        >
                            {t('workflow.providerAdmission.exportHistory')}
                        </button>
                        {providerAdmissionJws ? (
                            <button
                                type="button"
                                disabled={providerAdmissionBusy}
                                onClick={() => void copyProviderAdmissionJws()}
                            >
                                {t('workflow.providerAdmission.copyJws')}
                            </button>
                        ) : null}
                    </div>
                    {providerAdmissionStatus ? (
                        <p className={styles.eligible} role="status">{providerAdmissionStatus}</p>
                    ) : null}
                    {providerAdmissionSaveLink ? (
                        <p className={styles.boundary}>
                            <a
                                href={providerAdmissionSaveLink.objectUrl}
                                download={providerAdmissionSaveLink.filename}
                                rel="noopener"
                            >
                                {t('workflow.providerAdmission.saveAgain', {
                                    filename: providerAdmissionSaveLink.filename,
                                })}
                            </a>
                        </p>
                    ) : null}
                    {providerAdmissionError ? (
                        <p className={styles.error} role="alert">{providerAdmissionError}</p>
                    ) : null}
                </section>
            ) : null}
            <p className={styles.boundary}>{t('workflow.nonAuthority')}</p>
            {governanceCase.phase === 'outcome_review' || governanceCase.phase === 'closed' ? (
                <p className={styles.boundary}>{t('workflow.closeBoundary')}</p>
            ) : null}
            {governanceCase.memberRights && governanceCase.readerAudience !== 'public' ? (
                <section className={styles.stages} aria-labelledby="case-member-rights-title">
                    <div className={styles.stageHeading}>
                        <h3 id="case-member-rights-title">{t('workflow.memberRights.title')}</h3>
                        <span>{t('workflow.memberRights.boundary')}</span>
                    </div>
                    <dl>
                        <div><dt>{t('workflow.memberRights.viewerRole')}</dt><dd>{t(`workflow.memberRights.role.${governanceCase.memberRights.viewerRole ?? 'observer'}`)}</dd></div>
                        <div><dt>{t('workflow.memberRights.action')}</dt><dd>{t('workflow.memberRights.permanentRemoval')}</dd></div>
                        <div><dt>{t('workflow.memberRights.reason')}</dt><dd>{governanceCase.memberRights.publicReason ?? '—'}</dd></div>
                        <div><dt>{t('workflow.memberRights.appealDeadline')}</dt><dd>{governanceCase.memberRights.appealDeadline ?? '—'}</dd></div>
                        <div><dt>{t('workflow.memberRights.effectBoundary')}</dt><dd>{t('workflow.memberRights.effectForbidden')}</dd></div>
                        <div><dt>{t('workflow.memberRights.evidenceDigest')}</dt><dd><code>{governanceCase.memberRights.evidenceDigest ?? '—'}</code></dd></div>
                        <div data-testid="member-removal-authorization"><dt>{t('workflow.memberRights.execution')}</dt><dd>{governanceCase.memberRights.authorization?.status ?? t('workflow.memberRights.pendingDecision')}</dd></div>
                        {governanceCase.memberRights.authorization?.artifactDigest ? (
                            <div><dt>{t('workflow.memberRights.acceptedArtifact')}</dt><dd><code>{governanceCase.memberRights.authorization.artifactDigest}</code></dd></div>
                        ) : null}
                        <div><dt>{t('workflow.memberRights.membershipEffect')}</dt><dd>{governanceCase.memberRights.membershipEffect ?? 'not_executed_by_p05'}</dd></div>
                        <div><dt>{t('workflow.memberRights.provider')}</dt><dd>{t('workflow.memberRights.providerUnavailable')}</dd></div>
                    </dl>
                </section>
            ) : null}
            {canCloseCase ? (
                <section className={styles.outcomeRecord} aria-labelledby="case-actual-outcome-title">
                    <div>
                        <h3 id="case-actual-outcome-title">{t('workflow.actualOutcome.title')}</h3>
                        <span>{t('workflow.actualOutcome.boundary')}</span>
                    </div>
                    <p className={styles.boundary}>{t('workflow.actualOutcome.howTo')}</p>
                    <label>
                        {t('workflow.actualOutcome.summary')}
                        <textarea
                            value={outcomeSummary}
                            onChange={(event) => setOutcomeSummary(event.target.value)}
                            maxLength={2000}
                            required
                            placeholder={t('workflow.actualOutcome.summaryPlaceholder')}
                        />
                        <small>{t('workflow.actualOutcome.summaryHint')}</small>
                    </label>
                    <label>
                        {t('workflow.actualOutcome.quantitativeImpact')}
                        <textarea
                            value={quantitativeImpact}
                            onChange={(event) => setQuantitativeImpact(event.target.value)}
                            placeholder={t('workflow.actualOutcome.optionalPlaceholder')}
                        />
                    </label>
                    <label>
                        {t('workflow.actualOutcome.deviations')}
                        <textarea
                            value={outcomeDeviations}
                            onChange={(event) => setOutcomeDeviations(event.target.value)}
                            placeholder={t('workflow.actualOutcome.optionalPlaceholder')}
                        />
                    </label>
                    <label>
                        {t('workflow.actualOutcome.failures')}
                        <textarea
                            value={outcomeFailures}
                            onChange={(event) => setOutcomeFailures(event.target.value)}
                            placeholder={t('workflow.actualOutcome.optionalPlaceholder')}
                        />
                    </label>
                    <label>
                        {t('workflow.actualOutcome.outstandingObligations')}
                        <textarea
                            value={outstandingObligations}
                            onChange={(event) => setOutstandingObligations(event.target.value)}
                            placeholder={t('workflow.actualOutcome.optionalPlaceholder')}
                        />
                    </label>
                    <div className={styles.observationPeriod}>
                        <label>
                            {t('workflow.actualOutcome.observationStartedAt')}
                            <input type="datetime-local" value={observationStartedAt} onChange={(event) => setObservationStartedAt(event.target.value)} required />
                        </label>
                        <label>
                            {t('workflow.actualOutcome.observationEndedAt')}
                            <input type="datetime-local" value={observationEndedAt} onChange={(event) => setObservationEndedAt(event.target.value)} required />
                        </label>
                    </div>
                    <small>{t('workflow.actualOutcome.observationHint')}</small>
                    <div className={styles.actionRow}>
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => requestCloseCase()}
                            aria-disabled={busy || !canSubmitClose}
                        >
                            {busy ? <RefreshCw size={15} className={styles.spin} /> : <Check size={15} />}
                            {t('workflow.closeCase')}
                        </button>
                    </div>
                    {closeBlockers.length > 0 ? (
                        <small role="status">{t(`workflow.actualOutcome.submitHint.${closeBlockers[0]}`)}</small>
                    ) : (
                        <small>{t('workflow.actualOutcome.submitReady')}</small>
                    )}
                </section>
            ) : governanceCase.actualOutcome ? (
                <section className={styles.outcomeRecord} aria-labelledby="case-actual-outcome-title">
                    <div>
                        <h3 id="case-actual-outcome-title">{t('workflow.actualOutcome.title')}</h3>
                        <span>{t(`workflow.actualOutcome.integrity.${governanceCase.actualOutcome.integrity}`)}</span>
                    </div>
                    {governanceCase.actualOutcome.integrity === 'verified' ? (
                        <>
                            <p>{governanceCase.actualOutcome.summary}</p>
                            <OutcomeFacts title={t('workflow.actualOutcome.quantitativeImpact')} values={governanceCase.actualOutcome.quantitativeImpact} empty={t('workflow.actualOutcome.none')} />
                            <OutcomeFacts title={t('workflow.actualOutcome.deviations')} values={governanceCase.actualOutcome.deviations} empty={t('workflow.actualOutcome.none')} />
                            <OutcomeFacts title={t('workflow.actualOutcome.failures')} values={governanceCase.actualOutcome.failures} empty={t('workflow.actualOutcome.none')} />
                            <OutcomeFacts title={t('workflow.actualOutcome.outstandingObligations')} values={governanceCase.actualOutcome.outstandingObligations} empty={t('workflow.actualOutcome.none')} />
                            <small>{t('workflow.actualOutcome.observationPeriod')}: {governanceCase.actualOutcome.observationPeriod?.startedAt} — {governanceCase.actualOutcome.observationPeriod?.endedAt}</small>
                            <small>{t('workflow.actualOutcome.recordedBy')}: {governanceCase.actualOutcome.recordedByPubkey}</small>
                            {governanceCase.actualOutcome.externalExecution ? (
                                <div className={styles.externalOutcome} data-testid="provider-admission-external-outcome">
                                    <strong>{t('workflow.actualOutcome.externalExecution.title')}</strong>
                                    <span>{t('workflow.actualOutcome.externalExecution.boundary')}</span>
                                    <dl>
                                        <div><dt>{t('workflow.actualOutcome.externalExecution.provider')}</dt><dd>{governanceCase.actualOutcome.externalExecution.providerResourceRef}</dd></div>
                                        <div><dt>{t('workflow.actualOutcome.externalExecution.status')}</dt><dd>{governanceCase.actualOutcome.externalExecution.providerStatus}</dd></div>
                                        <div><dt>{t('workflow.actualOutcome.externalExecution.settlement')}</dt><dd>{governanceCase.actualOutcome.externalExecution.settlementState}</dd></div>
                                        <div><dt>{t('workflow.actualOutcome.externalExecution.network')}</dt><dd>{governanceCase.actualOutcome.externalExecution.network}</dd></div>
                                        <div><dt>{t('workflow.actualOutcome.externalExecution.executedAt')}</dt><dd>{governanceCase.actualOutcome.externalExecution.executedAt}</dd></div>
                                        <div><dt>{t('workflow.actualOutcome.externalExecution.receipt')}</dt><dd>{governanceCase.actualOutcome.externalExecution.providerAdmissionReceiptRef}</dd></div>
                                    </dl>
                                </div>
                            ) : null}
                            <code>{governanceCase.actualOutcome.digest}</code>
                        </>
                    ) : (
                        <p role="alert" className={styles.error}>{t('workflow.actualOutcome.invalid')}</p>
                    )}
                </section>
            ) : null}
            {governanceCase.template?.reviewPolicy ? (
                <div className={styles.policy}>
                    {governanceCase.template.actionAuthority ? (
                        <div data-testid="case-frozen-action-authority">
                            <strong>{t('workflow.actionAuthority.title')}</strong>
                            <span>{t('workflow.actionAuthority.source', {
                                source: governanceCase.template.actionAuthority.sourceType,
                                ref: governanceCase.template.actionAuthority.sourceType === 'governance_mandate'
                                    ? governanceCase.template.actionAuthority.mandateId
                                    : governanceCase.template.actionAuthority.sourceType === 'governance_recovery_policy'
                                        ? governanceCase.template.actionAuthority.recoveryPolicy.id
                                        : governanceCase.template.actionAuthority.projectionBindingId,
                                version: governanceCase.template.actionAuthority.sourceVersion,
                            })}</span>
                            <span>{t('workflow.actionAuthority.scope', {
                                action: governanceCase.template.actionAuthority.action.type,
                                subject: `${governanceCase.template.actionAuthority.subject.type}:${governanceCase.template.actionAuthority.subject.ref}`,
                            })}</span>
                            <span>{t('workflow.actionAuthority.policy', {
                                committee: governanceCase.template.actionAuthority.committeeHome.ref,
                                version: governanceCase.template.actionAuthority.policy.version,
                            })}</span>
                            <span>{t('workflow.actionAuthority.context', {
                                purpose: governanceCase.template.actionAuthority.purpose,
                                network: governanceCase.template.actionAuthority.network,
                                risk: governanceCase.template.actionAuthority.action.riskFloor,
                            })}</span>
                            <span>{t('workflow.actionAuthority.minimums', {
                                risk: governanceCase.template.actionAuthority.minimumConstraints.riskFloor,
                                quorum: governanceCase.template.actionAuthority.minimumConstraints.minimumApprovalThreshold,
                                timelock: governanceCase.template.actionAuthority.minimumConstraints.minimumTimelockSeconds,
                            })}</span>
                            <span>{t('workflow.actionAuthority.window', {
                                from: governanceCase.template.actionAuthority.effectiveFrom,
                                until: governanceCase.template.actionAuthority.effectiveUntil ?? '—',
                            })}</span>
                            <code>{governanceCase.template.actionAuthority.authorityPolicyBinding.bindingDigest}</code>
                        </div>
                    ) : null}
                    <strong>{t('workflow.reviewPolicy.title')}</strong>
                    <span>{t('workflow.reviewPolicy.reviewerReplacement')}</span>
                    <span>{t('workflow.reviewPolicy.appeal')}</span>
                    <span>{t('workflow.reviewPolicy.higherReviewGate')}</span>
                    {governanceCase.template.outcomePolicy ? (
                        <>
                            <span>{t('workflow.outcomePolicy.signoff')}</span>
                            <span>{t(`workflow.outcomePolicy.impact.${riskFloor ?? 'notApplicable'}`)}</span>
                            <span role={executorSeparationReady ? undefined : 'alert'}>
                                {t(`workflow.outcomePolicy.separation.${executorSeparationReady ? 'ready' : 'blocked'}`)}
                            </span>
                        </>
                    ) : (
                        <span role="alert">{t('workflow.outcomePolicy.unavailable')}</span>
                    )}
                    <span>{t('workflow.stages.mechanism')}: {governanceCase.template.decisionMechanism
                        ? t(`template.mechanisms.kind.${governanceCase.template.decisionMechanism.kind}`)
                        : t('workflow.stages.mechanismStatus.invalid')}</span>
                    {governanceCase.template.participationPolicy ? (
                        <>
                            <span>{t('template.participation.admission')}</span>
                            <span>{t('template.participation.proposal')}</span>
                            {governanceCase.template.decisionMechanism ? <span>{t('template.participation.voter')}</span> : null}
                            {governanceCase.template.decisionMechanism ? <span>{t(governanceCase.template.decisionMechanism.kind === 'quadratic_voice_credits'
                                ? 'template.mechanisms.kind.quadratic_voice_credits'
                                : 'template.participation.power')}</span> : null}
                        </>
                    ) : null}
                    {governanceCase.template.conflictOfInterestPolicy ? (
                        <span>{t('workflow.conflict.policy')}</span>
                    ) : null}
                </div>
            ) : null}
            {governanceCase.policySimulation ? (
                <section
                    className={`${styles.simulation} ${governanceCase.policySimulation.status === 'ready' ? styles.simulationReady : styles.simulationBlocked}`}
                    aria-labelledby="case-policy-simulation-title"
                >
                    <div>
                        <span>{t('workflow.policySimulation.eyebrow')}</span>
                        <strong id="case-policy-simulation-title">{t('workflow.policySimulation.title')}</strong>
                    </div>
                    <dl>
                        <div>
                            <dt>{t('workflow.policySimulation.electorate')}</dt>
                            <dd>{governanceCase.policySimulation.electorate.eligibleActorCount}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.conflict.baseElectorate')}</dt>
                            <dd>{governanceCase.policySimulation.electorate.baseEligibleActorCount}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.conflict.recusalCount')}</dt>
                            <dd>{governanceCase.policySimulation.electorate.recusalCount}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.policySimulation.threshold')}</dt>
                            <dd>{governanceCase.policySimulation.electorate.approvalThreshold ?? '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.policySimulation.provider')}</dt>
                            <dd>{t(`workflow.policySimulation.providerStatus.${governanceCase.policySimulation.provider.status}`)}</dd>
                        </div>
                    </dl>
                    <p role={governanceCase.policySimulation.status === 'blocked' ? 'alert' : undefined}>
                        {t(`workflow.policySimulation.reason.${governanceCase.policySimulation.reason === 'decision_mechanism_unavailable'
                            ? 'approval_policy_rule_unavailable'
                            : governanceCase.policySimulation.reason}`)}
                    </p>
                    <p>{t(`workflow.conflict.viewer.${governanceCase.policySimulation.conflictOfInterest.viewerStatus}`)}</p>
                    {quadraticVoiceReadiness ? (
                        <div className={styles.ballotSections} data-testid="qv-activation-readiness">
                            <p><strong>{t('workflow.qv.nativeMode', { budget: quadraticVoiceReadiness.nativeMode.creditBudgetPerActor })}</strong></p>
                            <p role={quadraticVoiceReadiness.externalResourceMode.activation === 'blocked' ? 'status' : undefined}>
                                {quadraticVoiceReadiness.externalResourceMode.state === 'ready'
                                    ? t('workflow.qv.externalResourceReady')
                                    : t('workflow.qv.externalResourceSetupRequired')}
                            </p>
                            {quadraticVoiceReadiness.externalResourceMode.blockerCodes.length > 0 ? (
                                <code>{quadraticVoiceReadiness.externalResourceMode.blockerCodes.join(', ')}</code>
                            ) : null}
                        </div>
                    ) : null}
                    {quadraticFundingReadiness ? (
                        <div className={styles.ballotSections} data-testid="qf-activation-readiness">
                            <p><strong>{t('workflow.qf.nativeMode')}</strong></p>
                            <p role={quadraticFundingReadiness.resourceFundedMode.activation === 'blocked' ? 'status' : undefined}>
                                {quadraticFundingReadiness.resourceFundedMode.state === 'ready'
                                    ? t('workflow.qf.resourceFundedReady')
                                    : t('workflow.qf.resourceFundedSetupRequired')}
                            </p>
                            <p>{t('workflow.qf.payoutNotCreated')}</p>
                            {quadraticFundingReadiness.resourceFundedMode.blockerCodes.length > 0 ? (
                                <code>{quadraticFundingReadiness.resourceFundedMode.blockerCodes.join(', ')}</code>
                            ) : null}
                        </div>
                    ) : null}
                    {canDiscloseConflict ? (
                        <div className={styles.controls}>
                            <label>
                                <span>{t('workflow.conflict.reason')}</span>
                                <Select
                                    ariaLabel={t('workflow.conflict.reason')}
                                    value={conflictReason}
                                    onChange={(value) => setConflictReason(value as GovernanceCaseConflictReason)}
                                    options={CONFLICT_REASONS.map((value) => ({
                                        value,
                                        label: t(`workflow.conflict.reasonCode.${value}`),
                                    }))}
                                />
                            </label>
                            <button type="button" disabled={busy} onClick={() => void discloseConflict()}>
                                {t('workflow.conflict.disclose')}
                            </button>
                        </div>
                    ) : null}
                </section>
            ) : null}
            <section className={styles.responsibilityGroups} aria-labelledby="case-current-responsibilities-title">
                <div className={styles.responsibilityGroupHeading}>
                    <strong id="case-current-responsibilities-title">{t('workflow.currentPhaseRoles')}</strong>
                    <span>{t(`phase.${governanceCase.phase}`)}</span>
                </div>
                <div className={styles.cards}>
                    {currentResponsibilityKinds.map((kind) => renderResponsibilityCard(kind, true))}
                </div>
                {currentResponsibilityKinds.length === 0 ? (
                    <p className={styles.responsibilityEmpty}>{t('workflow.noCurrentResponsibilityRoles')}</p>
                ) : null}
                {otherResponsibilityKinds.length > 0 ? (
                    <details className={styles.otherResponsibilities}>
                        <summary>
                            <span>{t('workflow.otherLifecycleRoles')}</span>
                            <small>{t('workflow.otherLifecycleRolesHint', {
                                count: otherResponsibilityKinds.length,
                            })}</small>
                        </summary>
                        <p>{t('workflow.otherLifecycleRolesBoundary')}</p>
                        <div className={styles.cards}>
                            {otherResponsibilityKinds.map((kind) => renderResponsibilityCard(kind, false))}
                        </div>
                    </details>
                ) : null}
            </section>
            {viewerPubkey && responsibilityManagementKinds.length > 0 ? (
                <details className={styles.responsibilityManagement}>
                    <summary>
                        <span>{t('workflow.management.title')}</span>
                        <small>{t('workflow.management.hint')}</small>
                    </summary>
                    <p>{t(workflow.canManage
                        ? 'workflow.management.managerBoundary'
                        : 'workflow.management.assigneeBoundary')}</p>
                    <div className={styles.controls}>
                        <label>
                            <span>{t('workflow.responsibility')}</span>
                            <Select
                                ariaLabel={t('workflow.responsibility')}
                                value={managementKind}
                                onChange={(value) => {
                                    setSelectedKind(value as GovernanceCaseResponsibilityKind);
                                    setTargetPubkey('');
                                    setResponsibilityDeadline('');
                                }}
                                options={responsibilityManagementKinds.map((kind) => ({
                                    value: kind,
                                    label: t(`workflow.kind.${kind}`),
                                }))}
                            />
                        </label>
                        <label>
                            <span>{t('workflow.assignee')}</span>
                            <Select
                                ariaLabel={t('workflow.assignee')}
                                value={targetPubkey}
                                onChange={setTargetPubkey}
                                options={[
                                    { value: '', label: t('workflow.chooseAssignee') },
                                    ...workflow.candidates
                                        .filter((candidate) => (
                                            candidate.eligibleResponsibilityKinds.includes(managementKind)
                                        ))
                                        .map((candidate) => ({
                                            value: candidate.pubkey,
                                            label: `${candidate.displayName || candidate.handle} · ${candidate.role}`,
                                        })),
                                ]}
                            />
                        </label>
                        <label>
                            <span>{t('workflow.deadline')}</span>
                            <input
                                type="datetime-local"
                                value={responsibilityDeadline}
                                onChange={(event) => setResponsibilityDeadline(event.target.value)}
                            />
                            <small>{selected?.deadlineAt
                                ? t('workflow.deadlineCurrent', {
                                    value: new Date(selected.deadlineAt).toLocaleString(),
                                })
                                : t('workflow.deadlineRequired')}</small>
                        </label>
                        <label className={styles.reason}>
                            <span>{t('workflow.management.reason')}</span>
                            <input
                                value={responsibilityReasons[managementKind] ?? ''}
                                onChange={(event) => setResponsibilityReasons((currentReasons) => ({
                                    ...currentReasons,
                                    [managementKind]: event.target.value,
                                }))}
                                maxLength={500}
                            />
                        </label>
                        {managementKind === 'review' && currentSignoff ? (
                            <p className={styles.responsibilityManagementWarning} role="note">
                                {t('workflow.management.replaceCompletedReviewWarning')}
                            </p>
                        ) : null}
                        <div className={styles.actionRow}>
                            <button
                                type="button"
                                disabled={busy || !targetPubkey || !responsibilityDeadlineReady}
                                onClick={() => void runResponsibilityAction(managementKind, 'reassign')}
                            >
                                {t('workflow.action.reassign')}
                            </button>
                            {workflow.canManage && selected?.deadlineAt ? (
                                <>
                                    <button
                                        type="button"
                                        disabled={busy || !responsibilityDeadline || (responsibilityReasons[managementKind]?.trim().length ?? 0) < 3}
                                        onClick={() => void runResponsibilityAction(managementKind, 'extend_deadline')}
                                    >
                                        {t('workflow.action.extendDeadline')}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={busy || (responsibilityReasons[managementKind]?.trim().length ?? 0) < 3}
                                        onClick={() => void runResponsibilityAction(managementKind, 'cancel_deadline')}
                                    >
                                        {t('workflow.action.cancelDeadline')}
                                    </button>
                                </>
                            ) : null}
                        </div>
                    </div>
                </details>
            ) : null}
            {voteSummary && !governanceCase.decisionStages ? (
                <section className={styles.stages} aria-labelledby="case-public-decision-summary-title">
                    <div className={styles.stageHeading}>
                        <h3 id="case-public-decision-summary-title">{t('workflow.ballot.publicSummaryTitle')}</h3>
                        <span>{t(`workflow.ballotRuntime.state.${voteSummary.ballot.state}`)}</span>
                    </div>
                    <dl>
                        <div>
                            <dt>{t('workflow.ballot.requestedDecision')}</dt>
                            <dd>{voteSummary.requestedDecision}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.electoratePolicy')}</dt>
                            <dd>{voteSummary.rule
                                ? `${voteSummary.rule.id} · ${voteSummary.rule.strategy}`
                                : '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.threshold')}</dt>
                            <dd>{ballotThreshold}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.eligibleCount')}</dt>
                            <dd>{voteSummary.ballot.tally?.eligible ?? '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.tally')}</dt>
                            <dd>{voteSummary.ballot.tally
                                ? t('workflow.ballotRuntime.currentTally', voteSummary.ballot.tally)
                                : '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.provider')}</dt>
                            <dd>{voteSummary.provider
                                ? `${voteSummary.provider.type} · ${voteSummary.provider.version}`
                                : '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.finality')}</dt>
                            <dd>{voteSummary.finality
                                ? `${voteSummary.finality.source} · ${t(`workflow.ballotRuntime.state.${voteSummary.ballot.state}`)} · ${voteSummary.finality.terminalStates.join(' / ')}`
                                : '—'}</dd>
                        </div>
                        <div>
                            <dt>{t('workflow.ballot.resultReason')}</dt>
                            <dd>{governanceCase.primaryRequest?.decision?.reason
                                || t('workflow.ballot.decisionPending')}</dd>
                        </div>
                    </dl>
                </section>
            ) : null}
            {governanceCase.ballotDisclosure ? (
                <section className={styles.disclosure} aria-labelledby="case-ballot-disclosure-title">
                    <div>
                        <h3 id="case-ballot-disclosure-title">{t('workflow.ballotDisclosure.title')}</h3>
                        <span>{t(`workflow.ballotDisclosure.mode.${governanceCase.ballotDisclosure.mode ?? 'unavailable'}`)}</span>
                    </div>
                    <p className={governanceCase.ballotDisclosure.state === 'visible' ? styles.eligible : styles.ineligible} role="status">
                        {t(`workflow.ballotDisclosure.state.${governanceCase.ballotDisclosure.state}`)} · {t(`workflow.ballotDisclosure.reason.${governanceCase.ballotDisclosure.reason}`)}
                    </p>
                    {governanceCase.ballotDisclosure.state === 'visible'
                        && governanceCase.ballotDisclosure.rawSignals.length > 0 ? (
                        <ul className={styles.rawSignals}>
                            {governanceCase.ballotDisclosure.rawSignals.map((signal) => (
                                <li key={signal.actorPubkey}>
                                    <strong>{candidateLabel(workflow.candidates, signal.actorPubkey)}</strong>
                                    <code>{shortPubkey(signal.actorPubkey)}</code>
                                    <span>{signal.choice === 'quadratic_voice_credits'
                                        ? `${t('template.mechanisms.kind.quadratic_voice_credits')} · ${(signal.choiceVector ?? [])
                                            .map((choice) => `${choice.choiceId}: ${choice.votes}`)
                                            .join(' · ')} · ${signal.cost ?? 0}`
                                        : signal.choice === 'abstain'
                                            ? t('workflow.conclusion.abstained')
                                            : t(`workflow.stages.${signal.choice}`)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className={styles.disclosureEmpty}>{t('workflow.ballotDisclosure.empty')}</p>
                    )}
                </section>
            ) : null}
            {governanceCase.decisionStages ? (
                <section className={styles.stages} aria-labelledby="case-decision-stages-title">
                    <div className={styles.stageHeading}>
                        <h3 id="case-decision-stages-title">{t('workflow.stages.title')}</h3>
                        <span>{t('workflow.stages.rule')}: {governanceCase.decisionStages.resolutionRule ?? '—'}</span>
                        <span>{t('workflow.stages.outcome')}: {governanceCase.decisionStages.outcome
                            ? t(`workflow.stages.state.${governanceCase.decisionStages.outcome}`)
                            : '—'}</span>
                    </div>
                    {governanceCase.decisionStages.integrity !== 'verified' ? (
                        <p className={styles.error} role="alert">{t('workflow.stages.integrityInvalid')}</p>
                    ) : null}
                    {governanceCase.decisionStages.evidencePolicy ? (
                        <div className={styles.disclosureSummary}>
                            <strong>{t('evidenceShare.title')}</strong>
                            <p>{t('evidenceShare.boundary')}</p>
                        </div>
                    ) : null}
                    <ol>
                        {governanceCase.decisionStages.stages.map((stage) => (
                            <li key={stage.stageRef}>
                                <div>
                                    <strong>{stage.order}. {t(`workflow.stages.purpose.${stage.purpose}`)}</strong>
                                    <span className={styles.stageState}>{t(`workflow.stages.state.${stage.state}`)}</span>
                                </div>
                                <dl>
                                    <div><dt>{t('workflow.stages.authority')}</dt><dd>{stage.institutionalAuthority.type} · {stage.institutionalAuthority.ref}</dd></div>
                                    <div><dt>{t('workflow.stages.provider')}</dt><dd>{stage.provider.type} · {stage.provider.version}</dd></div>
                                    <div>
                                        <dt>{t('workflow.stages.mechanism')}</dt>
                                        <dd>{'status' in stage.mechanism
                                            ? t(`workflow.stages.mechanismStatus.${stage.mechanism.status}`)
                                            : stage.mechanism.kind === 'quadratic_voice_credits'
                                                ? t('template.mechanisms.kind.quadratic_voice_credits')
                                                : stage.mechanism.kind === 'quadratic_funding'
                                                    ? t('template.mechanisms.kind.quadratic_funding')
                                                    : t('workflow.stages.mechanismEqualWeight')}</dd>
                                    </div>
                                    {!('status' in stage.mechanism) ? (
                                        <div>
                                            <dt>{t('workflow.stages.contractDigest')}</dt>
                                            <dd><code>{stage.mechanism.contractDigest}</code></dd>
                                        </div>
                                    ) : null}
                                    <div><dt>{t('workflow.stages.expires')}</dt><dd>{stage.expiresAt ? new Date(stage.expiresAt).toLocaleString() : t('workflow.stages.noExpiry')}</dd></div>
                                </dl>
                                {stage.purpose === 'approval' && stage.state === 'active' ? (
                                    <>
                                        {voteSummary ? (
                                            <details className={styles.ballot} data-testid="case-ballot-review-details">
                                                <summary className={styles.ballotSummary}>
                                                    <span className={styles.ballotSummaryCopy}>
                                                        <span>{t('workflow.ballot.title')}</span>
                                                        <strong>{voteSummary.requestedDecision}</strong>
                                                        {voteSummary.ballot.tally ? (
                                                            <small>{t('workflow.ballotRuntime.currentTally', voteSummary.ballot.tally)}</small>
                                                        ) : null}
                                                    </span>
                                                    <span className={styles.ballotSummaryAction}>
                                                        <span className={styles.ballotSummaryExpand}>{t('workflow.ballot.expandDetails')}</span>
                                                        <span className={styles.ballotSummaryCollapse}>{t('workflow.ballot.collapseDetails')}</span>
                                                        <ChevronDown aria-hidden="true" size={16} />
                                                    </span>
                                                </summary>
                                                <div className={styles.ballotBody}>
                                                <div className={styles.ballotFacts}>
                                                    <span>{t('workflow.ballot.rule')}: {voteSummary.rule?.strategy || '—'}</span>
                                                    <span>{t('workflow.ballot.deadline')}: {voteSummary.deadline ? new Date(voteSummary.deadline).toLocaleString() : '—'}</span>
                                                    <span>{t('workflow.ballot.provider')}: {voteSummary.provider ? `${voteSummary.provider.type} · ${voteSummary.provider.version}` : '—'}</span>
                                                    <span>{t('workflow.stages.mechanism')}: {voteSummary.mechanism
                                                        ? t(`workflow.stages.mechanismVerification.${voteSummary.mechanism.status}`)
                                                        : t('workflow.stages.mechanismStatus.invalid')}</span>
                                                    <span>{t('workflow.ballot.replacement')}: {t('workflow.ballot.replacementNotAllowed')}</span>
                                                    <span>{t('workflow.ballotRuntime.choices')}: {voteSummary.ballot.choices.map((choice) => typeof choice === 'string'
                                                        ? choice === 'abstain' ? t('workflow.conclusion.abstained') : t(`workflow.stages.${choice}`)
                                                        : choice.label).join(' · ')}</span>
                                                    <span>{t('workflow.ballotRuntime.quorum')}: {voteSummary.ballot.quorum
                                                        ? t('workflow.ballotRuntime.quorumValue', {
                                                            numerator: voteSummary.ballot.quorum.numerator,
                                                            denominator: voteSummary.ballot.quorum.denominator,
                                                            required: voteSummary.ballot.quorum.required,
                                                        })
                                                        : '—'}</span>
                                                    <span>{t('workflow.ballotRuntime.history')}: {t('workflow.ballotRuntime.historyFirstSignal')}</span>
                                                    <span>{t('workflow.ballotRuntime.earlyFinalization')}: {t('workflow.ballotRuntime.earlyThreshold')}</span>
                                                </div>
                                                {stage.provider.type === 'alcheme_internal' ? (
                                                    <p data-testid="native-governance-cost-boundary">
                                                        {t('workflow.nativeCostBoundary')}
                                                    </p>
                                                ) : null}
                                                {voteSummary.ballot.tally ? (
                                                    <p className={voteSummary.ballot.state === 'held' ? styles.ineligible : styles.eligible} role={voteSummary.ballot.state === 'held' ? 'alert' : 'status'}>
                                                        {t(`workflow.ballotRuntime.state.${voteSummary.ballot.state}`)} · {voteSummary.ballot.reason === 'awaiting_qv_signals'
                                                            ? t('template.mechanisms.kind.quadratic_voice_credits')
                                                            : t(`workflow.ballotRuntime.reason.${voteSummary.ballot.reason}`)} · {t('workflow.ballotRuntime.currentTally', voteSummary.ballot.tally)}
                                                    </p>
                                                ) : null}
                                                {quadraticVoice ? (
                                                    <div className={styles.ballotSections}>
                                                        {quadraticVoiceReadiness ? (
                                                            <p data-testid="qv-frozen-activation-readiness">
                                                                {t('workflow.qv.nativeMode', { budget: quadraticVoiceReadiness.nativeMode.creditBudgetPerActor })}{' '}
                                                                {quadraticVoiceReadiness.externalResourceMode.state === 'ready'
                                                                    ? t('workflow.qv.externalResourceReady')
                                                                    : t('workflow.qv.externalResourceSetupRequired')}{' '}
                                                                {quadraticVoiceReadiness.externalResourceMode.blockerCodes.length > 0 ? (
                                                                    <code>{quadraticVoiceReadiness.externalResourceMode.blockerCodes.join(', ')}</code>
                                                                ) : null}
                                                            </p>
                                                        ) : null}
                                                        {quadraticVoice.choices.map((choice) => (
                                                            <label key={choice.id}>
                                                                <span>{choice.label} · {choice.votes}</span>
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    step={1}
                                                                    value={quadraticVotes[choice.id] ?? '0'}
                                                                    onChange={(event) => setQuadraticVotes((current) => ({
                                                                        ...current,
                                                                        [choice.id]: event.target.value,
                                                                    }))}
                                                                    disabled={busy || !canSignal}
                                                                />
                                                            </label>
                                                        ))}
                                                        <p role="status">
                                                            {Number.isFinite(quadraticCost) ? quadraticCost : '—'} / {quadraticVoice.creditBudgetPerActor}
                                                        </p>
                                                        <p>{quadraticVoice.submitted} / {quadraticVoice.pending}</p>
                                                    </div>
                                                ) : null}
                                                {quadraticFunding ? (
                                                    <div className={styles.ballotSections}>
                                                        <p><strong>{quadraticFunding.roundRef}</strong> · {quadraticFunding.matchingBudget} {quadraticFunding.budgetUnit}</p>
                                                        {quadraticFunding.projects.map((project) => (
                                                            <label key={project.id}>
                                                                <span>{project.label} · {project.projectRef} · cap {quadraticFunding.commitmentCapPerActorPerProject}</span>
                                                                <input
                                                                    type="number"
                                                                    min={0}
                                                                    max={quadraticFunding.commitmentCapPerActorPerProject}
                                                                    step={1}
                                                                    value={quadraticCommitments[project.id] ?? '0'}
                                                                    onChange={(event) => setQuadraticCommitments((current) => ({
                                                                        ...current,
                                                                        [project.id]: event.target.value,
                                                                    }))}
                                                                    disabled={busy || !canSignal}
                                                                />
                                                            </label>
                                                        ))}
                                                        <p role="status">{t('workflow.qf.commitmentTotal', {
                                                            total: Number.isFinite(quadraticCommitmentTotal) ? quadraticCommitmentTotal : '—',
                                                            unit: quadraticFunding.budgetUnit,
                                                        })}</p>
                                                        <p>{t('workflow.qf.unfundedBoundary')}</p>
                                                        {quadraticFunding.activationReadiness.resourceFundedMode.blockerCodes.length > 0 ? (
                                                            <p data-testid="qf-frozen-activation-readiness">
                                                                {t('workflow.qf.resourceFundedSetupRequired')}{' '}
                                                                <code>{quadraticFunding.activationReadiness.resourceFundedMode.blockerCodes.join(', ')}</code>
                                                            </p>
                                                        ) : (
                                                            <p>{t('workflow.qf.resourceFundedReady')}</p>
                                                        )}
                                                    </div>
                                                ) : null}
                                                <div className={styles.ballotSections}>
                                                    {(['evidence', 'argumentsFor', 'argumentsAgainst', 'risks'] as const).map((key) => (
                                                        <article key={key}>
                                                            <strong>{t(`workflow.ballot.${key}`)}</strong>
                                                            <p>{voteSummary[key] || t('workflow.ballot.notProvided')}</p>
                                                        </article>
                                                    ))}
                                                </div>
                                                <dl className={styles.eligibilityFacts}>
                                                    <div>
                                                        <dt>{t('workflow.ballot.currentValue')}</dt>
                                                        <dd>{voteSummary.eligibility.status === 'eligible'
                                                            ? t('workflow.ballot.currentEligible', { weight: voteSummary.eligibility.weight || '1' })
                                                            : voteSummary.eligibility.status === 'ineligible'
                                                                ? t('workflow.ballot.currentIneligible')
                                                                : t('workflow.ballot.walletRequired')}</dd>
                                                    </div>
                                                    <div><dt>{t('workflow.ballot.threshold')}</dt><dd>{ballotThreshold}</dd></div>
                                                    <div><dt>{t('workflow.ballot.scope')}</dt><dd>{eligibilityScope}</dd></div>
                                                    <div>
                                                        <dt>{t('workflow.ballot.gap')}</dt>
                                                        <dd>{voteSummary.eligibility.status === 'eligible'
                                                            ? t('workflow.ballot.gapNone')
                                                            : voteSummary.eligibility.status === 'ineligible'
                                                                ? t('workflow.ballot.gapFrozenElectorate')
                                                                : t('workflow.ballot.gapWallet')}</dd>
                                                    </div>
                                                    <div className={styles.eligibilityEvidence}>
                                                        <dt>{t('workflow.ballot.snapshotEvidence')}</dt>
                                                        <dd><code>{voteSummary.snapshotDigest}</code></dd>
                                                    </div>
                                                </dl>
                                                <p className={styles.correctionBoundary}>
                                                    {t('workflow.ballot.correctionBoundary')}{' '}
                                                    {correctionCircleId ? (
                                                        <Link href={`/circles/${correctionCircleId}?settings=members`}>
                                                            {t('workflow.ballot.correctionOpen')}
                                                        </Link>
                                                    ) : null}
                                                </p>
                                                <p className={voteSummary.eligibility.status === 'eligible' ? styles.eligible : styles.ineligible} role="status">
                                                    {voteSummary.submission.status === 'recorded'
                                                        ? t('workflow.ballot.recorded', { choice: voteSummary.submission.choice === 'quadratic_voice_credits'
                                                            ? t('template.mechanisms.kind.quadratic_voice_credits')
                                                            : voteSummary.submission.choice === 'quadratic_funding'
                                                            ? t('workflow.qf.signedCommitment')
                                                            : voteSummary.submission.choice === 'abstain'
                                                            ? t('workflow.conclusion.abstained')
                                                            : t(`workflow.stages.${voteSummary.submission.choice}`) })
                                                        : voteSummary.eligibility.status === 'eligible'
                                                        ? t('workflow.ballot.eligible', { weight: voteSummary.eligibility.weight || '1' })
                                                        : voteSummary.eligibility.status === 'ineligible'
                                                            ? t('workflow.ballot.ineligible')
                                                            : t('workflow.ballot.walletRequired')}
                                                </p>
                                                </div>
                                            </details>
                                        ) : null}
                                        <div className={styles.actionRow}>
                                            {quadraticVoice ? (
                                                <button
                                                    type="button"
                                                    disabled={busy || !canSignal || !quadraticVectorReady}
                                                    onClick={() => void submitQuadraticVoiceSignal()}
                                                >
                                                    <Check size={14} />{t('template.mechanisms.kind.quadratic_voice_credits')}
                                                </button>
                                            ) : quadraticFunding ? (
                                                <button
                                                    type="button"
                                                    disabled={busy || !canSignal || !quadraticCommitmentReady}
                                                    onClick={() => void submitQuadraticFundingCommitment()}
                                                >
                                                    <Check size={14} />{t('workflow.qf.submitCommitment')}
                                                </button>
                                            ) : (
                                                <>
                                                    <button type="button" disabled={busy || !canSignal} onClick={() => void submitApprovalSignal('approve')}>
                                                        <Check size={14} />{t('workflow.stages.approve')}
                                                    </button>
                                                    <button type="button" disabled={busy || !canSignal} onClick={() => void submitApprovalSignal('reject')}>
                                                        {t('workflow.stages.reject')}
                                                    </button>
                                                    <button type="button" disabled={busy || !canSignal} onClick={() => void submitApprovalSignal('abstain')}>
                                                        {t('workflow.conclusion.abstained')}
                                                    </button>
                                                </>
                                            )}
                                            {canCancelApproval ? (
                                                <button type="button" disabled={busy} onClick={() => void cancelApprovalStage()}>
                                                    <XCircle size={14} />{t('workflow.ballot.cancel')}
                                                </button>
                                            ) : null}
                                        </div>
                                    </>
                                ) : stage.purpose === 'approval' && voteSummary?.ballot.state === 'held' ? (
                                    <section className={styles.ballotResult} role="alert">
                                        <strong>{t('workflow.ballotRuntime.state.held')}</strong>
                                        <span>{t(`workflow.ballotRuntime.reason.${voteSummary.ballot.reason}`)}</span>
                                        <span>{t('workflow.ballotRuntime.holdBoundary')}</span>
                                    </section>
                                ) : stage.purpose === 'approval' && governanceCase.primaryRequest?.decision ? (
                                    <section className={styles.ballotResult} aria-label={t('workflow.ballot.resultTitle')}>
                                        <strong>{t('workflow.ballot.resultTitle')}</strong>
                                        <span>{t('workflow.stages.outcome')}: {t(`workflow.stages.state.${governanceCase.primaryRequest.decision.decision}`)}</span>
                                        <span>{t('workflow.ballot.resultReason')}: {governanceCase.primaryRequest.decision.reason}</span>
                                        {governanceCase.primaryRequest.decision.mechanism?.kind === 'quadratic_voice_credits' ? (
                                            <div className={styles.ballotSections}>
                                                <span>{Array.isArray(governanceCase.primaryRequest.decision.tally.choices)
                                                    ? (governanceCase.primaryRequest.decision.tally.choices as Array<{ label?: string; votes?: number }>)
                                                        .map((choice) => `${choice.label ?? '—'}: ${choice.votes ?? 0}`)
                                                        .join(' · ')
                                                    : '—'}</span>
                                                {quadraticVoiceReadiness ? (
                                                    <span data-testid="qv-frozen-activation-readiness">
                                                        {t('workflow.qv.nativeMode', { budget: quadraticVoiceReadiness.nativeMode.creditBudgetPerActor })}{' '}
                                                        {quadraticVoiceReadiness.externalResourceMode.state === 'ready'
                                                            ? t('workflow.qv.externalResourceReady')
                                                            : t('workflow.qv.externalResourceSetupRequired')}{' '}
                                                        {quadraticVoiceReadiness.externalResourceMode.blockerCodes.length > 0 ? (
                                                            <code>{quadraticVoiceReadiness.externalResourceMode.blockerCodes.join(', ')}</code>
                                                        ) : null}
                                                    </span>
                                                ) : null}
                                            </div>
                                        ) : governanceCase.primaryRequest.decision.mechanism?.kind === 'quadratic_funding' ? (
                                            <div className={styles.ballotSections}>
                                                {(Array.isArray(governanceCase.primaryRequest.decision.tally.projects)
                                                    ? governanceCase.primaryRequest.decision.tally.projects as Array<any>
                                                    : []).map((project) => (
                                                    <span key={String(project.id)}>{project.label}: {project.matchingAllocationUnits} + {project.contributionUnits} {String(governanceCase.primaryRequest?.decision?.tally.budgetUnit ?? '')}</span>
                                                ))}
                                                <span>{t('workflow.qf.unfundedBoundary')}</span>
                                                {quadraticFundingReadiness ? (
                                                    <span data-testid="qf-frozen-activation-readiness">
                                                        {quadraticFundingReadiness.resourceFundedMode.state === 'ready'
                                                            ? t('workflow.qf.resourceFundedReady')
                                                            : t('workflow.qf.resourceFundedSetupRequired')}{' '}
                                                        {quadraticFundingReadiness.resourceFundedMode.blockerCodes.length > 0 ? (
                                                            <code>{quadraticFundingReadiness.resourceFundedMode.blockerCodes.join(', ')}</code>
                                                        ) : null}
                                                    </span>
                                                ) : null}
                                                <code>{String(governanceCase.primaryRequest.decision.tally.contributionSnapshotDigest ?? '')}</code>
                                            </div>
                                        ) : (
                                            <span>{t('workflow.ballotRuntime.currentTally', {
                                                approved: String(governanceCase.primaryRequest.decision.tally.approved ?? 0),
                                                rejected: String(governanceCase.primaryRequest.decision.tally.rejected ?? 0),
                                                abstained: String(governanceCase.primaryRequest.decision.tally.abstained ?? 0),
                                                eligible: String(governanceCase.primaryRequest.decision.tally.eligible ?? 0),
                                            })}</span>
                                        )}
                                        <span>{t('workflow.ballot.decidedAt')}: {governanceCase.primaryRequest.decision.decidedAt
                                            ? new Date(governanceCase.primaryRequest.decision.decidedAt).toLocaleString()
                                            : '—'}</span>
                                        {governanceCase.primaryRequest.decision.mechanism ? (
                                            <>
                                                <span>{t('workflow.stages.mechanism')}: {voteSummary?.mechanism
                                                    ? t(`workflow.stages.mechanismVerification.${voteSummary.mechanism.status}`)
                                                    : t('workflow.stages.mechanismStatus.invalid')}</span>
                                                <span>{t('workflow.stages.contractDigest')}</span>
                                                <code>{governanceCase.primaryRequest.decision.mechanism.contractDigest}</code>
                                                <span>{t('workflow.stages.resultDigest')}</span>
                                                <code>{governanceCase.primaryRequest.decision.mechanism.resultDigest}</code>
                                            </>
                                        ) : null}
                                        <code>{governanceCase.primaryRequest.decision.decisionDigest}</code>
                                    </section>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                    {viewerPubkey && !signMessage && approvalStage?.state === 'active' ? (
                        <p className={styles.error}>{t('workflow.walletRequired')}</p>
                    ) : null}
                </section>
            ) : null}
            {governanceCase.primaryRequest?.providerResourceExecutionAdmission ? (
                <section
                    id="case-provider-resource-execution-admission"
                    className={styles.ballotResult}
                    data-provider-resource-execution-admission={governanceCase.primaryRequest.providerResourceExecutionAdmission.state}
                    role="status"
                >
                    <strong>governed resource admitted for exact provider execution</strong>
                    <span>
                        {governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.cluster}
                        {' · '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.provider}
                        {' · '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.capability}
                        {' · resource '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.resourceRef}
                        {' · owner program '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.ownerProgramRef}
                    </span>
                    <span>
                        purpose {governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.purpose}
                        {' · slot '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.verifiedSlot}
                        {' · state '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.binding.stateDigest}
                        {' · title inference: forbidden'}
                    </span>
                    {governanceCase.primaryRequest.providerResourceExecutionAdmission.controllingAuthorities.map((authority) => (
                        <span key={authority.bindingId}>
                            {authority.role} · {authority.publicAuthority}
                            {' · custody '}{authority.custodyProvider}/{authority.custodyStatus}
                            {' · operations '}{authority.allowedOperations.join(', ')}
                            {' · key ref exposed: no'}
                        </span>
                    ))}
                    {governanceCase.primaryRequest.providerResourceExecutionAdmission.artifactMapping ? (
                        <span data-provider-execution-resource-artifact={governanceCase.primaryRequest.providerResourceExecutionAdmission.artifactMapping.artifactId}>
                            artifact {governanceCase.primaryRequest.providerResourceExecutionAdmission.artifactMapping.artifactId}
                            {' · exact resource '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.artifactMapping.resourceBindingId}
                            {' · adapter '}{governanceCase.primaryRequest.providerResourceExecutionAdmission.artifactMapping.adapterRef}
                            {' · title inference: forbidden'}
                        </span>
                    ) : null}
                </section>
            ) : null}
            {governanceCase.primaryRequest?.preExecutionCost ? (
                <section
                    className={styles.ballotResult}
                    data-pre-execution-cost={governanceCase.primaryRequest.preExecutionCost.state}
                    aria-label="pre-execution cost readiness"
                >
                    <strong>pre-execution cost readiness</strong>
                    <span>
                        payer policy {governanceCase.primaryRequest.preExecutionCost.payer.policyId}
                        {' · bearer '}{governanceCase.primaryRequest.preExecutionCost.payer.economicBearer}
                        {' · sponsor '}{governanceCase.primaryRequest.preExecutionCost.payer.sponsor}
                    </span>
                    <span>
                        single cap {governanceCase.primaryRequest.preExecutionCost.limits.singleTransaction} lamports
                        {' · total cap '}{governanceCase.primaryRequest.preExecutionCost.limits.total} lamports
                    </span>
                    <span>
                        estimate {governanceCase.primaryRequest.preExecutionCost.estimate}
                        {' · rent '}{governanceCase.primaryRequest.preExecutionCost.rent}
                        {' · refund '}{governanceCase.primaryRequest.preExecutionCost.refund}
                    </span>
                    <code>{governanceCase.primaryRequest.preExecutionCost.provider.profileRef}</code>
                    {governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight ? (
                        <div
                            data-provider-execution-authority-preflight={governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.state}
                            role="status"
                        >
                            <strong>execution authority preflight: verified</strong>
                            <span>
                                snapshot {governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.frozenAuthority.snapshotId}
                                {' · mandate '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.mandate.id}
                                {' v'}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.mandate.version}
                                {' · artifact '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.governedDecision.artifactId}
                            </span>
                            <span>
                                action {governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.governedDecision.actionType}
                                {' · subject '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.governedDecision.subject.type}:{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.governedDecision.subject.ref}
                                {' · resource '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.governedDecision.resourceBindingId}
                            </span>
                            <span>
                                live authority {governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.liveExecutionAuthority.result}
                                {' · authorities '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.liveExecutionAuthority.controllingAuthorityCount}
                                {' · freeze '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.emergencyFreeze.state}
                                {' · execution allowed: yes'}
                            </span>
                            <span data-provider-execution-enforcement-binding="verified_live">
                                enforcement {governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.executionEnforcementBinding.mode}
                                {' · adapter '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.executionEnforcementBinding.allowedAdapter}
                                {' · operations '}{governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.executionEnforcementBinding.allowedOperations.join(', ')}
                                {' · bypass prevented: no'}
                            </span>
                            <span>next gate {governanceCase.primaryRequest.preExecutionCost.executionAuthorityPreflight.nextGate}</span>
                        </div>
                    ) : null}
                    {governanceCase.primaryRequest.preExecutionCost.executionPreview ? (
                        <div
                            data-provider-execution-preview="canonical_cost_preflight_pre_sign_state_and_active_binding"
                            role="status"
                        >
                            <strong>provider execution preview: ready to sign</strong>
                            <span>
                                {governanceCase.primaryRequest.preExecutionCost.executionPreview.instruction.summary}
                                {' · provider '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.provider}
                                {' · network '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.network}
                            </span>
                            <span>
                                programs {governanceCase.primaryRequest.preExecutionCost.executionPreview.instruction.programIds.join(', ')}
                                {' · accounts '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.instruction.accountScope.map((account) => `${account.role}:${account.ref}`).join(', ')}
                            </span>
                            <span>
                                asset change {governanceCase.primaryRequest.preExecutionCost.executionPreview.instruction.assetChange}
                                {' · simulation '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.instruction.simulation}
                                {' · opaque instructions: no · raw instruction exposed: no'}
                            </span>
                            <span>
                                signer {governanceCase.primaryRequest.preExecutionCost.executionPreview.signingAuthority.publicAuthority}
                                {' · custody '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.signingAuthority.custodyProvider}
                                {' · key ref exposed: no · assignment grants authority: no'}
                            </span>
                            <span>
                                payer {governanceCase.primaryRequest.preExecutionCost.executionPreview.feePayer.policyId}
                                {' · bearer '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.feePayer.economicBearer}
                                {' · quoted '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.estimate.quotedFee} lamports
                                {' · ceiling '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.estimate.authorizedCeiling} lamports
                            </span>
                            <span>
                                bypass risk {governanceCase.primaryRequest.preExecutionCost.executionPreview.bypassRisk.known}
                                {' · prevented: no · next gate '}{governanceCase.primaryRequest.preExecutionCost.executionPreview.nextGate}
                            </span>
                        </div>
                    ) : null}
                    {governanceCase.primaryRequest.preExecutionCost.executionProgress ? (
                        <div
                            data-provider-partial-execution={governanceCase.primaryRequest.preExecutionCost.executionProgress.state}
                            role="status"
                        >
                            <strong>provider execution is partial, not complete</strong>
                            <span>
                                completed {governanceCase.primaryRequest.preExecutionCost.executionProgress.completed.map((step) => (
                                    `${step.stepId}@${step.actionReceipt.observedSlot}:${step.actionReceipt.providerReference}`
                                )).join(', ')}
                                {' · remaining '}{governanceCase.primaryRequest.preExecutionCost.executionProgress.remaining.join(', ')}
                            </span>
                            <span>
                                irreversible changes {governanceCase.primaryRequest.preExecutionCost.executionProgress.completed.length}
                                {' · compensation '}{governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.state}
                                {' · owner '}{typeof governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.owner === 'string'
                                    ? governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.owner
                                    : `${governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.owner.pubkey} via ${governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.owner.caseId}`}
                                {' · next gate '}{governanceCase.primaryRequest.preExecutionCost.executionProgress.nextGate}
                            </span>
                            <span
                                data-provider-partial-resolution={governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.acceptedResolution ?? 'deterministic_resume_available'}
                                data-provider-partial-public-record={governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.publicRecord.displayedExecutionState}
                                data-provider-partial-emergency-deviation={String(governanceCase.primaryRequest.preExecutionCost.executionProgress.resolutionPolicy.emergencyActorPermanentDeviationAllowed)}
                                data-provider-partial-accept-partial-executed={String(governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.publicRecord.acceptPartialShownAsExecuted)}
                            >
                                resolution {governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.acceptedResolution ?? 'resume original artifact only'}
                                {' · realized '}{governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.realizedActionIds.join(', ')}
                                {' · unrealized '}{governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.unrealizedActionIds.join(', ')}
                                {' · original fully executed '}{String(governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.publicRecord.originalDecisionFullyExecuted)}
                                {' · accept partial shown as executed '}{String(governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.publicRecord.acceptPartialShownAsExecuted)}
                            </span>
                            <span>
                                remaining obligations {governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.remainingObligations.join(', ')}
                                {' · follow-up Case '}{governanceCase.primaryRequest.preExecutionCost.executionProgress.outcome.followUpCaseId ?? 'none'}
                            </span>
                            {workflow.canManage
                                && governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.state
                                    === 'not_required_without_terminal_abandonment_decision' ? (
                                <div>
                                    <label>
                                        Terminal-abandonment reason
                                        <textarea
                                            value={terminalAbandonmentReason}
                                            onChange={(event) => setTerminalAbandonmentReason(event.target.value)}
                                            maxLength={2000}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        disabled={busy || terminalAbandonmentReason.trim().length < 3}
                                        onClick={() => void openProviderTerminalAbandonmentCase()}
                                    >
                                        Open governed terminal-abandonment Case
                                    </button>
                                </div>
                            ) : null}
                            {terminalAbandonmentCaseId ? (
                                <span>
                                    terminal-abandonment Case{' '}
                                    <Link href={`/governance/cases/${encodeURIComponent(terminalAbandonmentCaseId)}`}>
                                        {terminalAbandonmentCaseId} <ArrowUpRight size={14} />
                                    </Link>
                                </span>
                            ) : null}
                            {workflow.canManage
                                && governanceCase.primaryRequest.preExecutionCost.executionProgress.compensation.state
                                    === 'compensation_required' ? (
                                <div>
                                    <label>
                                        Compensation-plan reason
                                        <textarea
                                            value={compensationPlanReason}
                                            onChange={(event) => setCompensationPlanReason(event.target.value)}
                                            maxLength={2000}
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        disabled={busy || compensationPlanReason.trim().length < 3}
                                        onClick={() => void openProviderCompensationPlanCase()}
                                    >
                                        Open governed compensation-plan Case
                                    </button>
                                    <span>
                                        Opens a separate frozen governed action; the original ActionIntent remains immutable.
                                    </span>
                                </div>
                            ) : null}
                            {compensationPlanCaseId ? (
                                <span>
                                    compensation-plan Case{' '}
                                    <Link href={`/governance/cases/${encodeURIComponent(compensationPlanCaseId)}`}>
                                        {compensationPlanCaseId} <ArrowUpRight size={14} />
                                    </Link>
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                    {governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability ? (
                        <div
                            data-provider-automatic-execution-availability={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.state}
                            data-provider-readiness-state={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.readinessState}
                            data-provider-risk-maturity={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.riskMaturity}
                            data-provider-stage-open-gate={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.openStage}
                            data-provider-execute-gate={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.execute}
                            data-provider-enforcement-mode={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.mode}
                            role="status"
                        >
                            <strong>
                                automatic provider execution {governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.state}
                                {' · readiness '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.readinessState}
                                {' · risk '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.riskMaturity}
                            </strong>
                            <span>
                                {governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.providerModule}
                                {' · operations '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.allowedOperations.join(', ') || 'none'}
                                {' · blockers '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.blockers.join(', ') || 'none'}
                            </span>
                            <span>
                                wallet manual {governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.walletManual}
                                {' · advisory '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.advisoryOnly}
                                {' · completion claim allowed: no'}
                                {' · next gate '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.nextGate}
                                {' · stage '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.openStage}
                                {' · execute '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.execute}
                                {' · risk confirmation '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.riskConfirmation}
                            </span>
                        </div>
                    ) : null}
                </section>
            ) : null}
            {governanceCase.manualExecutionControl ? (
                <section
                    id="case-manual-execution-control"
                    className={styles.ballotResult}
                    data-manual-execution-control={governanceCase.manualExecutionControl.state}
                    role="status"
                >
                    <strong>manual execution control</strong>
                    <span>
                        assignee {governanceCase.manualExecutionControl.stageAssignee?.pubkey ?? 'missing'}
                        {' · deadline '}{governanceCase.manualExecutionControl.stageAssignee?.deadlineAt ?? 'missing'}
                        {' · reviewer '}{governanceCase.manualExecutionControl.reviewer?.pubkey ?? 'missing'}
                    </span>
                    <span>
                        completion source {governanceCase.manualExecutionControl.completionSource}
                        {' · direct mark executed: forbidden'}
                        {' · assignment grants signer authority: no'}
                    </span>
                    {governanceCase.manualExecutionControl.completionEvidence ? (
                        <span data-manual-execution-completion-evidence={governanceCase.manualExecutionControl.completionEvidence.receiptId}>
                            receipt {governanceCase.manualExecutionControl.completionEvidence.receiptId}
                            {' · slot '}{governanceCase.manualExecutionControl.completionEvidence.observedSlot}
                            {' · '}{governanceCase.manualExecutionControl.completionEvidence.providerFinality}
                            {' · reviewer action required'}
                        </span>
                    ) : null}
                    {manualSubmission ? (
                        <span data-manual-execution-submission={manualSubmission.status}>
                            submission v{manualSubmission.version}
                            {' · evidence '}{manualSubmission.evidenceCount}
                            {' · digest '}{manualSubmission.evidenceDigest}
                            {' · submitted '}{new Date(manualSubmission.submittedAt).toLocaleString()}
                            {manualSubmission.reviewedAt
                                ? ` · reviewed ${new Date(manualSubmission.reviewedAt).toLocaleString()}`
                                : ''}
                            {manualSubmission.receiptId ? ` · receipt ${manualSubmission.receiptId}` : ''}
                        </span>
                    ) : null}
                    {governanceCase.manualExecutionControl.blockers.length ? (
                        <span>{governanceCase.manualExecutionControl.blockers.join(', ')}</span>
                    ) : null}
                    {canSubmitManualExecution ? (
                        <div className={styles.controls} data-manual-execution-submit-form="available">
                            <label>
                                <span>Evidence kind</span>
                                <Select
                                    ariaLabel="Evidence kind"
                                    value={manualEvidenceKind}
                                    onChange={(value) => setManualEvidenceKind(value as typeof manualEvidenceKind)}
                                    options={[
                                        { value: 'verification_record', label: 'Verification record' },
                                        { value: 'external_receipt', label: 'External receipt' },
                                        { value: 'artifact', label: 'Artifact' },
                                    ]}
                                />
                            </label>
                            <label>
                                <span>Public-safe evidence reference</span>
                                <input
                                    value={manualEvidenceRef}
                                    maxLength={256}
                                    placeholder={isStorageFabricProviderAdmission
                                        ? 'storage-fabric:provider-admission-execution:<operationId>'
                                        : undefined}
                                    onChange={(event) => setManualEvidenceRef(event.target.value)}
                                />
                            </label>
                            <label className={styles.reason}>
                                <span>Evidence SHA-256 digest</span>
                                <input
                                    value={manualEvidenceDigest}
                                    maxLength={71}
                                    inputMode="text"
                                    placeholder={isStorageFabricProviderAdmission
                                        ? 'sha256:<projectionDigest>'
                                        : undefined}
                                    onChange={(event) => setManualEvidenceDigest(event.target.value)}
                                />
                            </label>
                            {isStorageFabricProviderAdmission ? (
                                <small>
                                    Copy the Storage Fabric operation ID and projectionDigest from the
                                    authoritative execution readback. This form records public-safe evidence;
                                    it does not execute or alter the Storage Fabric operation.
                                </small>
                            ) : null}
                            <div className={styles.actionRow}>
                                <button
                                    type="button"
                                    disabled={busy
                                        || !manualEvidenceRef.trim()
                                        || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(manualEvidenceDigest.trim())}
                                    onClick={() => void submitManualExecutionEvidence()}
                                >
                                    Submit completion evidence
                                </button>
                            </div>
                        </div>
                    ) : null}
                    {canReviewManualExecution ? (
                        <div className={styles.controls} data-manual-execution-review-form="available">
                            <label>
                                <span>Review decision</span>
                                <Select
                                    ariaLabel="Review decision"
                                    value={manualReviewDecision}
                                    onChange={(value) => setManualReviewDecision(value as 'approve' | 'reject')}
                                    options={[
                                        { value: 'approve', label: 'Approve and record executed receipt' },
                                        { value: 'reject', label: 'Reject for resubmission' },
                                    ]}
                                />
                            </label>
                            <label className={styles.reason}>
                                <span>Review reason</span>
                                <input
                                    value={manualReviewReason}
                                    maxLength={1000}
                                    onChange={(event) => setManualReviewReason(event.target.value)}
                                />
                            </label>
                            <div className={styles.actionRow}>
                                <button
                                    type="button"
                                    disabled={busy || (
                                        manualReviewDecision === 'reject'
                                        && !manualReviewReason.trim()
                                    )}
                                    onClick={() => void reviewManualExecutionEvidence()}
                                >
                                    {manualReviewDecision === 'approve'
                                        ? 'Approve controlled execution'
                                        : 'Reject completion evidence'}
                                </button>
                            </div>
                        </div>
                    ) : null}
                </section>
            ) : null}
            {governanceCase.primaryRequest?.providerExecution ? (
                <section
                    className={styles.ballotResult}
                    aria-label={t('workflow.providerExecution.title')}
                    role={['held', 'execution_expired'].includes(
                        governanceCase.primaryRequest.providerExecution.status,
                    ) ? 'alert' : undefined}
                >
                    <strong>{t('workflow.providerExecution.title')}</strong>
                    <span>
                        {t('workflow.providerExecution.status')}:{' '}
                        {governanceCase.primaryRequest.providerExecution.status === 'execution_expired'
                            ? 'execution_expired · authoritative readback'
                            : t(`workflow.providerExecution.state.${governanceCase.primaryRequest.providerExecution.status}`)}
                    </span>
                    <span>{t('workflow.providerExecution.integrity')}: {t(`workflow.providerExecution.integrityState.${governanceCase.primaryRequest.providerExecution.integrity}`)}</span>
                    {governanceCase.primaryRequest.providerExecution.blocker ? (
                        <span>{t('workflow.providerExecution.blocker')}: {governanceCase.primaryRequest.providerExecution.blocker}</span>
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.expiry ? (
                        <span
                            data-provider-execution-expiry={governanceCase.primaryRequest.providerExecution.expiry.state}
                        >
                            step {governanceCase.primaryRequest.providerExecution.expiry.stepId}
                            {' · finalized height '}{governanceCase.primaryRequest.providerExecution.expiry.observedBlockHeight}
                            {' > last valid '}{governanceCase.primaryRequest.providerExecution.expiry.lastValidBlockHeight}
                            {' · signature status '}{governanceCase.primaryRequest.providerExecution.expiry.signatureStatus}
                            {' · provider effect '}{governanceCase.primaryRequest.providerExecution.expiry.providerEffect}
                            {' · automatic retry allowed: no'}
                            {' · next gate '}{governanceCase.primaryRequest.providerExecution.expiry.nextGate}
                        </span>
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.retry ? (
                        <span
                            data-testid="provider-execution-retry"
                            data-retry-mode={governanceCase.primaryRequest.providerExecution.retry.mode}
                            data-retry-request-id={governanceCase.primaryRequest.providerExecution.retry.requestId}
                            data-retry-attempt-count={governanceCase.primaryRequest.providerExecution.retry.attemptCount}
                        >
                            {recoveryRetryT(`mode.${governanceCase.primaryRequest.providerExecution.retry.mode}`)}
                            {' · '}{recoveryRetryT('attempt', {
                                count: governanceCase.primaryRequest.providerExecution.retry.attemptCount,
                            })}
                            {' · '}
                            <time dateTime={governanceCase.primaryRequest.providerExecution.retry.nextRetryAt}>
                                {new Date(governanceCase.primaryRequest.providerExecution.retry.nextRetryAt).toLocaleString()}
                            </time>
                        </span>
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.recovery ? (
                        <GovernanceExecutionRecoveryStatus
                            recovery={{
                                blocker: governanceCase.primaryRequest.providerExecution.blocker,
                                ...governanceCase.primaryRequest.providerExecution.recovery,
                            }}
                            boundaryText={t('recovery.boundary')}
                            blockerText={governanceCase.primaryRequest.providerExecution.blocker
                                ? t('recovery.blocker', {
                                    value: governanceCase.primaryRequest.providerExecution.blocker,
                                })
                                : null}
                        />
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.reconciliation ? (
                        <>
                            <span>
                                {t('workflow.providerExecution.status')}: {governanceCase.primaryRequest.providerExecution.reconciliation.state}
                                {' · '}{governanceCase.primaryRequest.providerExecution.reconciliation.authority}
                            </span>
                            <span>
                                {t('workflow.providerExecution.finality')}: {governanceCase.primaryRequest.providerExecution.reconciliation.observedSlot ?? 'hold'}
                                {' · '}{new Date(governanceCase.primaryRequest.providerExecution.reconciliation.observedAt).toLocaleString()}
                            </span>
                            {governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident ? (
                                <GovernanceProviderIncidentStatus
                                    incident={{
                                        id: governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident.incidentId,
                                        state: governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident.lifecycleState,
                                        evidenceDigest: governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident.eventDigest,
                                        occurredAt: governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident.occurredAt,
                                        pendingExecution: governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident.pendingExecution,
                                        originalDecisionAndReceipt: governanceCase.primaryRequest.providerExecution.reconciliation.providerIncident.originalDecisionAndReceipt,
                                    }}
                                />
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback ? (
                                <span
                                    data-provider-reconciliation-fallback={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.sourceState}
                                    data-provider-fallback-mode={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.mode}
                                    data-provider-questioned-self-adjudication={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.questionedProviderMayAdjudicate}
                                    data-provider-operator-selects-fallback={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.operatorMaySelectProvider}
                                >
                                    reconciliation fallback · {governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.sourceState}
                                    {' · '}{governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.activation}
                                    {' · superseding '}{String(governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.superseding.required)}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.reconciliation.accountSemantics ? (
                                <span>{t('workflow.providerExecution.accountSemantics', {
                                    signatory: governanceCase.primaryRequest.providerExecution.reconciliation.accountSemantics.signatoryRecord,
                                    voterWeight: governanceCase.primaryRequest.providerExecution.reconciliation.accountSemantics.voterWeightAddin,
                                    maxVoterWeight: governanceCase.primaryRequest.providerExecution.reconciliation.accountSemantics.maxVoterWeightAddin,
                                    plugins: governanceCase.primaryRequest.providerExecution.reconciliation.accountSemantics.customPlugins,
                                })}</span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity ? (
                                <div
                                    data-testid="provider-voting-power-security"
                                    data-voting-power-readiness={governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.readinessState}
                                >
                                    <strong>{t('workflow.providerExecution.votingPowerTitle')}</strong>
                                    <span>{t('workflow.providerExecution.votingPowerUnavailable')}</span>
                                    <span>
                                        {t('workflow.providerExecution.votingPowerSnapshot', {
                                            slot: governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.source.snapshotSlot,
                                        })}
                                    </span>
                                    <span>
                                        {governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.tokenOwnerRecords.map((record) => (
                                            `${record.role}:${record.depositAmount}:delegate-${record.governanceDelegate ?? 'none'}`
                                        )).join(' · ')}
                                    </span>
                                    <span>
                                        root {governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.sameResourceRoot.rootDigest}
                                    </span>
                                    {governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerChallenge ? (
                                        <span data-testid="provider-voting-power-challenge">
                                            challenge {governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerChallenge.state}
                                            {' · pre '}{governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerChallenge.preObservedSlot}
                                            {' · post '}{governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerChallenge.postObservedSlot ?? 'pending'}
                                            {' · history '}{governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerChallenge.historicalTallyInvariant}
                                        </span>
                                    ) : null}
                                    <span>
                                        {t('workflow.providerExecution.votingPowerProtections', {
                                            snapshotDelay: governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.protections.snapshotDelay,
                                            cooldown: governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.protections.cooldown,
                                            borrowedCapital: governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.protections.borrowedCapitalRisk,
                                        })}
                                    </span>
                                    <span>{governanceCase.primaryRequest.providerExecution.reconciliation.votingPowerSecurity.blockerCodes.join(' · ')}</span>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.provider ? (
                        <>
                            <span>{t('workflow.providerExecution.provider')}: {governanceCase.primaryRequest.providerExecution.provider.module}</span>
                            <span>{governanceCase.primaryRequest.providerExecution.provider.chainId} · {governanceCase.primaryRequest.providerExecution.provider.profileRef}@{governanceCase.primaryRequest.providerExecution.provider.profileVersion}</span>
                            <span>{t('workflow.providerExecution.finality')}: {governanceCase.primaryRequest.providerExecution.provider.finality} · slot {governanceCase.primaryRequest.providerExecution.provider.observedSlot}</span>
                            <span>{t('workflow.providerExecution.resource')}: {governanceCase.primaryRequest.providerExecution.provider.resourceRef}</span>
                            <span>{t('workflow.providerExecution.ownerProgram')}: {governanceCase.primaryRequest.providerExecution.provider.ownerProgramRef}</span>
                            {governanceCase.primaryRequest.providerExecution.provider.proposalTransactionReadback ? (
                                <div
                                    data-provider-proposal-transaction-readback="provider_receipt_and_independent_finalized_readback"
                                    data-provider-proposal-execution-status={governanceCase.primaryRequest.providerExecution.provider.proposalTransactionReadback.executionStatus}
                                    role="status"
                                >
                                    <strong>provider proposal transaction readback</strong>
                                    <span>
                                        proposal {governanceCase.primaryRequest.providerExecution.provider.proposalTransactionReadback.proposalRef}
                                        {' · transaction '}{governanceCase.primaryRequest.providerExecution.provider.proposalTransactionReadback.proposalTransactionRef}
                                        {' · commitment '}{governanceCase.primaryRequest.providerExecution.provider.proposalTransactionReadback.commitment}
                                    </span>
                                    <ol>
                                        {governanceCase.primaryRequest.providerExecution.provider.proposalTransactionReadback.instructions.map((instruction) => (
                                            <li key={`${instruction.stepId}:${instruction.signature}`}>
                                                <strong>{instruction.stepId}</strong>
                                                {' · '}{instruction.summary}
                                                {' · signature '}{instruction.signature}
                                                {' · slot '}{instruction.slot}
                                                {' · '}{instruction.commitment}/{instruction.executionStatus}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.executionAuthorities?.map((authority) => (
                                <span
                                    key={`${authority.role}:${authority.publicAuthority ?? authority.verifiedSlot}`}
                                    data-provider-execution-authority={authority.role}
                                    data-custody-status={authority.custodyStatus}
                                >
                                    {authority.role} · {authority.publicAuthority ?? 'public authority unavailable'}
                                    {' · '}{authority.custodyProvider}/{authority.custodyStatus}
                                    {' · slot '}{authority.verifiedSlot}
                                    {' · '}{authority.allowedOperations.join(', ')}
                                </span>
                            ))}
                            {governanceCase.primaryRequest.providerExecution.provider.authorityPaymentBoundary ? (
                                <span
                                    data-provider-authority-payment-boundary={governanceCase.primaryRequest.providerExecution.provider.authorityPaymentBoundary.separation}
                                    role="status"
                                >
                                    authority roles {governanceCase.primaryRequest.providerExecution.provider.authorityPaymentBoundary.executionAuthorityRoles.join(', ')}
                                    {' · payer policy '}{governanceCase.primaryRequest.providerExecution.provider.authorityPaymentBoundary.payerPolicyId}
                                    {' · economic bearer '}{governanceCase.primaryRequest.providerExecution.provider.authorityPaymentBoundary.economicBearer}
                                    {' · sponsor '}{governanceCase.primaryRequest.providerExecution.provider.authorityPaymentBoundary.sponsorRole}
                                    {' · fee payer only · sponsor authority gain: none'}
                                    {' · private key exposure: none'}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy ? (
                                <span
                                    data-provider-mandate-cost-policy={governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy.mandateTermsDigest}
                                    role="status"
                                >
                                    mandate cost policy {governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy.mandateId}
                                    {' @v'}{governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy.mandateVersion}
                                    {' · classes '}{governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy.costClasses.map((item) => `${item.costClass}:${item.economicBearer}`).join(', ')}
                                    {' · special budget '}{governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy.specialBudget.mode}
                                    {' · payer authority '}{governanceCase.primaryRequest.providerExecution.provider.mandateCostPolicy.payerAuthority}
                                    {' · silent transfer allowed: no'}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary ? (
                                <span
                                    data-provider-funding-source-fee-payer={governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary.fundingSourceRole}
                                    role="status"
                                >
                                    funding source {governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary.fundingSourceRef}
                                    {' · payer policy '}{governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary.payerPolicyId}
                                    {' · fee payer '}{governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary.actualFeePayer}
                                    {' · funding source may sign fees: no'}
                                    {' · approved payment path '}{governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary.approvedPaymentPath}
                                    {' · reimbursement '}{governanceCase.primaryRequest.providerExecution.provider.fundingSourceFeePayerBoundary.reimbursementPolicy}
                                    {' · executor cash-flow responsibility: forbidden'}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure ? (
                                <span
                                    data-provider-residual-bypass-risk={governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure.residualBypassRisk}
                                    role="status"
                                >
                                    {governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure.mode}
                                    {' · '}{governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure.proofScope}
                                    {' · '}{governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure.residualBypassRisk}
                                    {' · '}{governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure.allowedOperations.join(', ')}
                                    {' · decision '}{governanceCase.primaryRequest.providerExecution.provider.enforcementDisclosure.decisionLinkage.decisionDigest}
                                    {' · bypass prevented: no'}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.preSignStateReadback ? (
                                <span
                                    data-provider-pre-sign-state="verified"
                                    role="status"
                                >
                                    pre-sign state verified
                                    {' · slot '}{governanceCase.primaryRequest.providerExecution.provider.preSignStateReadback.latestObservedSlot}
                                    {' · signature checks '}{governanceCase.primaryRequest.providerExecution.provider.preSignStateReadback.signatureCheckCount}
                                    {' · canonical owners/current balance/trust profile/P05 freeze bound'}
                                    {' · execution allowed at signature: yes'}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.costReconciliation ? (
                                <div data-provider-cost-reconciliation={governanceCase.primaryRequest.providerExecution.provider.costReconciliation.reconciliation}>
                                    <strong>provider cost reconciliation</strong>
                                    <span>
                                        payer policy {governanceCase.primaryRequest.providerExecution.provider.costReconciliation.payerPolicyId}
                                        {' · bearer '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.economicBearer}
                                        {' · sponsor '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.sponsorRole}
                                        {' · funding '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.fundingSource}
                                        {' · direct rent '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.totalDirectRentLamports === null
                                            ? 'not itemized'
                                            : `${governanceCase.primaryRequest.providerExecution.provider.costReconciliation.totalDirectRentLamports} lamports`}
                                        {' · total '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.totalSpendLamports} lamports
                                        {' · final balance '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.finalBalanceLamports} lamports
                                        {' · refund '}{governanceCase.primaryRequest.providerExecution.provider.costReconciliation.refund}
                                    </span>
                                    {governanceCase.primaryRequest.providerExecution.provider.costReconciliation.transactions.map((cost) => (
                                        <code key={cost.stepId}>
                                            {cost.stepId} · quote {cost.quotedFeeLamports} · direct rent {cost.directRentLamports === null ? 'not itemized' : cost.directRentLamports} · actual {cost.actualSpendLamports} lamports
                                        </code>
                                    ))}
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary ? (
                                <div
                                    data-provider-cost-control-boundary={governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.authority}
                                    role="status"
                                >
                                    <strong>provider cost-control sponsor receipt</strong>
                                    <span>
                                        payer policy {governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.payerPolicyId}
                                        {' · action '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.scope.actionType}
                                        {' · network '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.scope.network}
                                        {' · window '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.timeWindow.scope}
                                        {' · checked '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.timeWindow.checkedAt ?? 'not recorded'}
                                    </span>
                                    <span>
                                        single {governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.limits.singleTransactionLamports} lamports
                                        {' · period '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.limits.periodLamports} lamports
                                        {' · max balance '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.limits.maximumWalletBalanceLamports ?? 'not configured'}
                                        {' · final balance '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.balance.finalBalanceLamports} lamports
                                        {' · state '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.balance.state}
                                    </span>
                                    <span>
                                        rate scope {governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.rateLimit.actionWindowScope}
                                        {' · spend single ok '}{String(governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.alerts.spendWithinSingleLimit)}
                                        {' · spend period ok '}{String(governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.alerts.spendWithinPeriodLimit)}
                                        {' · balance ok '}{String(governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.alerts.finalBalanceWithinConfiguredMaximum)}
                                    </span>
                                    <code>
                                        sponsor receipt {governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.sponsorReceipt.receiptDigest}
                                        {' · sponsor '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.sponsorReceipt.sponsorRole}
                                        {' · bearer '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.sponsorReceipt.economicBearer}
                                        {' · refund '}{governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.sponsorReceipt.refund}
                                        {' · signer exposed '}{String(governanceCase.primaryRequest.providerExecution.provider.providerCostControlBoundary.sponsorReceipt.feePayerSignerRefExposed)}
                                    </code>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback ? (
                                <div
                                    data-provider-execution-plan="canonical_request_cost_preflight_provider_plan_and_terminal_receipt"
                                    data-provider-execution-mode={governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.executionMode}
                                    role="status"
                                >
                                    <strong>provider execution plan</strong>
                                    <span>
                                        request {governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.requestId}
                                        {' · decision '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.decisionDigest}
                                        {' · action intent '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.actionIntentDigest}
                                        {' · plan '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.planDigest}
                                        {' · terminal attempt '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.terminalTransactionAttemptDigest}
                                    </span>
                                    <span
                                        data-provider-duplicate-prevention={governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.duplicatePrevention.state}
                                    >
                                        duplicate action observed: no
                                        {' · idempotency keys '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.duplicatePrevention.actionIdempotencyKeys.length}
                                        {' · unique provider references '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.duplicatePrevention.providerReferences.length}
                                        {' · authoritative readback: yes'}
                                        {' · duplicate payment '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.duplicatePrevention.duplicatePaymentObserved}
                                        {' · retry '}{governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.duplicatePrevention.retryBoundary}
                                    </span>
                                    <ol>
                                        {governanceCase.primaryRequest.providerExecution.provider.executionPlanReadback.actions.map((action) => (
                                            <li key={action.actionId} data-provider-execution-action={action.actionId}>
                                                <strong>{action.order}. {action.humanSummary}</strong>
                                                <span>
                                                    {action.executor} · {action.operation}
                                                    {' · semantic '}{action.instructionSemantics}
                                                    {' · programs '}{action.programScope.join(', ')}
                                                    {' · accounts '}{action.accountScope.map((account) => `${account.role}:${account.ref}`).join(', ')}
                                                    {' · asset change '}{action.assetChange}
                                                    {' · depends on '}{action.dependsOnActionIds.length === 0 ? 'none' : action.dependsOnActionIds.join(', ')}
                                                    {' · atomic '}{action.atomicity}
                                                </span>
                                                {action.attempts.map((attempt) => (
                                                    <code key={attempt.providerReference}>
                                                        finalized attempt · slot {attempt.slot} · {attempt.providerReference}
                                                        {' · blockhash retry-only '}{attempt.recentBlockhash}
                                                        {' · message '}{attempt.messageDigest}
                                                    </code>
                                                ))}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary ? (
                                <div
                                    data-provider-action-safety="reviewed_provider_adapter_instruction_safety"
                                    data-provider-opaque-auto-execution="false"
                                    role="status"
                                >
                                    <strong>provider action safety boundary</strong>
                                    <span>
                                        reviewed adapter {governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary.reviewedAdapter}
                                        {' · actions '}{governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary.actionCount}
                                        {' · programs '}{governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary.programAllowlist.join(', ')}
                                    </span>
                                    <span>
                                        asset conservation {governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary.checks.assetConservation}
                                        {' · max outflow '}{governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary.checks.maxOutflowLamports}
                                        {' · simulation required: yes'}
                                        {' · material changes require '}{governanceCase.primaryRequest.providerExecution.provider.providerActionSafetyBoundary.retryMaterialChangeGate}
                                    </span>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary ? (
                                <div
                                    data-provider-service-payer-boundary={governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.authority}
                                    role="status"
                                >
                                    <strong>service payer authority boundary</strong>
                                    <span>
                                        fee scope {governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.feeScope}
                                        {' · payer policy '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.payerPolicyId}
                                        {' · sponsor authority gain '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.sponsorAuthorityGain}
                                        {' · actual payer '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.actualFeePayer}
                                    </span>
                                    <span>
                                        controls token/metadata/program/governance authority: no
                                        {' · mint/freeze/update source '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.mintFreezeUpdateAuthoritySource}
                                        {' · restricted mint op '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.restrictedMintOperation}
                                        {' · universal key allowed '}{String(governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.longLivedUniversalKeyAllowed)}
                                        {' · material authority change '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.materialAuthorityChangeRequires}
                                    </span>
                                    <span>
                                        cost readback {governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.costReadback.totalSpendLamports} lamports
                                        {' · direct rent '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.costReadback.totalDirectRentLamports === null
                                            ? 'not itemized'
                                            : `${governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.costReadback.totalDirectRentLamports} lamports`}
                                        {' · refund '}{governanceCase.primaryRequest.providerExecution.provider.servicePayerAuthorityBoundary.costReadback.refund}
                                    </span>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary ? (
                                <div
                                    data-provider-asset-authority-sponsor-boundary={governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.authority}
                                    role="status"
                                >
                                    <strong>asset authority / sponsor separation</strong>
                                    <span>
                                        payer policy {governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.payerPolicyId}
                                        {' · sponsor '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.sponsorRole}
                                        {' · bearer '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.economicBearer}
                                        {' · receipt '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.sponsorReceiptDigest}
                                    </span>
                                    <span>
                                        asset authority source {governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.assetAuthority.ownerIssuerMintFreezeUpdateSource}
                                        {' · restricted mint op '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.assetAuthority.restrictedMintOperation}
                                        {' · current outflow '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.assetAuthority.currentActionAssetOutflow}
                                        {' · material change '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.assetAuthority.materialAuthorityChangeRequires}
                                    </span>
                                    <span>
                                        sponsor may pay fees: {String(governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.sponsorSeparation.sponsorMayPayFees)}
                                        {' · authority gain '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.sponsorSeparation.sponsorAuthorityGain}
                                        {' · signer exposed '}{String(governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.sponsorSeparation.feePayerSignerRefExposed)}
                                        {' · controls token/metadata/program/governance: no'}
                                    </span>
                                    <span>
                                        reviewed adapter {governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.actionSafety.reviewedAdapter}
                                        {' · actions '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.actionSafety.actionCount}
                                        {' · max outflow '}{governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.actionSafety.maxOutflowLamports}
                                        {' · opaque allowed '}{String(governanceCase.primaryRequest.providerExecution.provider.assetAuthoritySponsorBoundary.actionSafety.opaqueInstructionsAllowed)}
                                    </span>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.attemptOwner ? (
                                <span data-provider-attempt-owner={governanceCase.primaryRequest.providerExecution.provider.attemptOwner.authority}>
                                    preflight {governanceCase.primaryRequest.providerExecution.provider.attemptOwner.preflightId}
                                    {' · action intent '}{governanceCase.primaryRequest.providerExecution.provider.attemptOwner.actionIntentDigest}
                                    {' · transaction attempt '}{governanceCase.primaryRequest.providerExecution.provider.attemptOwner.transactionAttemptDigest}
                                </span>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution.provider.retryBoundary ? (
                                <span data-provider-retry-boundary={governanceCase.primaryRequest.providerExecution.provider.retryBoundary.authority}>
                                    same-intent retry allows {governanceCase.primaryRequest.providerExecution.provider.retryBoundary.sameIntentRetry.allowedChanges.join(', ')}
                                    {' · action set '}{governanceCase.primaryRequest.providerExecution.provider.retryBoundary.actionSetDigest}
                                    {' · material change '}{governanceCase.primaryRequest.providerExecution.provider.retryBoundary.materialChangesRequire}
                                    {' · '}{governanceCase.primaryRequest.providerExecution.provider.retryBoundary.materialChanges.join(', ')}
                                    {' · automatic material mutation: no'}
                                </span>
                            ) : null}
                            <span>{t('workflow.providerExecution.noRealAssets')}</span>
                            {governanceCase.primaryRequest.providerExecution.provider.transactions.map((transaction) => (
                                <div key={`${transaction.stepId}:${transaction.signature}`}>
                                    <code>
                                        {transaction.stepId} · slot {transaction.slot} · {transaction.signature}
                                        {' · '}{transaction.finalityTransitions.map((transition) => (
                                            transition.slot === undefined
                                                ? transition.state
                                                : `${transition.state}@${transition.slot}`
                                        )).join(' → ')}
                                    </code>
                                    {transaction.attemptContext ? (
                                        <span data-provider-attempt-context={transaction.attemptContext.authority}>
                                            blockhash {transaction.attemptContext.recentBlockhash}
                                            {' · fee '}{transaction.attemptContext.quotedFeeLamports} lamports
                                            {' · payer policy '}{transaction.attemptContext.feePayerPolicyId}
                                            {' · payer binding '}{transaction.attemptContext.feePayerBinding}
                                            {' · attempt #'}{transaction.attemptContext.attemptOrdinal}
                                            {' · digest '}{transaction.attemptContext.transactionAttemptDigest}
                                            {' · priority fee '}{transaction.attemptContext.priorityFeeLamports} lamports
                                            {' · priority proof '}{transaction.attemptContext.priorityFeeState}
                                            {' · quote slot '}{transaction.attemptContext.quoteSlot}@{transaction.attemptContext.quotedAt}
                                            {' · resimulation '}{transaction.attemptContext.resimulationTrigger}
                                        </span>
                                    ) : null}
                                    {transaction.humanReadableAction ? (
                                        <span
                                            data-provider-human-readable-action={transaction.humanReadableAction.operation}
                                            data-provider-asset-change={transaction.humanReadableAction.assetChange}
                                        >
                                            {transaction.humanReadableAction.summary}
                                            {' · programs '}{transaction.humanReadableAction.programScope.join(', ')}
                                            {' · accounts '}{transaction.humanReadableAction.accountScope.map((account) => (
                                                `${account.role}:${account.ref}`
                                            )).join(', ')}
                                            {' · asset change '}{transaction.humanReadableAction.assetChange}
                                            {' · simulation '}{transaction.humanReadableAction.simulation}
                                            {' · enforcement '}{transaction.humanReadableAction.enforcement}
                                            {' · opaque instructions: no'}
                                        </span>
                                    ) : null}
                                    {transaction.actionContext ? (
                                        <span
                                            data-provider-action-context={transaction.actionContext.authority}
                                            data-provider-action-order={transaction.actionContext.order}
                                        >
                                            action {transaction.actionContext.order}
                                            {' · depends on '}{transaction.actionContext.dependsOnStepIds.length === 0
                                                ? 'none'
                                                : transaction.actionContext.dependsOnStepIds.join(', ')}
                                            {' · atomic '}{transaction.actionContext.atomicity}
                                            {' · expected '}{transaction.actionContext.expectedStateChange}
                                            {' · idempotency '}{transaction.actionContext.idempotencyKey}
                                            {' · deadline block height '}{transaction.actionContext.deadline.value}
                                            {' · aggregate '}{transaction.actionContext.aggregateRule}
                                        </span>
                                    ) : null}
                                    {transaction.statePrecondition ? (
                                        <span
                                            data-provider-pre-sign-state={transaction.statePrecondition.authority}
                                            data-provider-pre-sign-step={transaction.statePrecondition.stepId}
                                        >
                                            pre-sign slot {transaction.statePrecondition.observedSlot}
                                            {' · state '}{transaction.statePrecondition.providerStateDigest}
                                            {' · payer '}{transaction.statePrecondition.feePayerBalanceLamports} lamports
                                            {' · owners '}{transaction.statePrecondition.canonicalOwnerState.stateDigest}
                                            {' · emergency freeze '}{transaction.statePrecondition.canonicalOwnerState.emergencyFreeze}
                                            <span
                                                data-provider-instruction-safety={transaction.statePrecondition.instructionSafety.simulation}
                                                data-provider-opaque-instructions={transaction.statePrecondition.instructionSafety.opaqueInstructions}
                                            >
                                                {' · program '}{transaction.statePrecondition.instructionSafety.programIds.join(', ')}
                                                {' · privilege '}{transaction.statePrecondition.instructionSafety.accountPrivilegeCheck}
                                                {' · asset outflow '}{transaction.statePrecondition.instructionSafety.assetOutflowLamports}
                                            </span>
                                            {' · digest '}{transaction.statePrecondition.digest}
                                        </span>
                                    ) : null}
                                </div>
                            ))}
                            {governanceCase.primaryRequest.providerExecution.provider.expiredAttemptHistory?.attempts.length ? (
                                <ol data-provider-expired-attempt-history="canonical_cost_preflight_checkpoint">
                                    {governanceCase.primaryRequest.providerExecution.provider.expiredAttemptHistory.attempts.map((attempt) => (
                                        <li key={attempt.messageDigest}>
                                            <code>{attempt.stepId} · {attempt.messageDigest}</code>
                                            <span>
                                                {attempt.recentBlockhash} · {attempt.lastValidBlockHeight}
                                                {' → '}{attempt.expiredAtBlockHeight} · {attempt.disposition}
                                            </span>
                                        </li>
                                    ))}
                                </ol>
                            ) : null}
                        </>
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.decisionMapping ? (
                        <>
                            <span>{t('workflow.providerExecution.ballotMapping')}</span>
                            <code>{governanceCase.primaryRequest.providerExecution.decisionMapping.sourceMechanism.kind} · {governanceCase.primaryRequest.providerExecution.decisionMapping.sourceMechanism.contractDigest}</code>
                            <span>{t('workflow.providerExecution.proposal')}: {governanceCase.primaryRequest.providerExecution.decisionMapping.providerProposalRef}</span>
                            <span>{t('workflow.providerExecution.voteRecord')}: {governanceCase.primaryRequest.providerExecution.decisionMapping.providerVoteRecordRef}</span>
                            <span>{t('workflow.providerExecution.voteWeight', {
                                yes: governanceCase.primaryRequest.providerExecution.decisionMapping.yesVoteWeight,
                                total: governanceCase.primaryRequest.providerExecution.decisionMapping.voterWeight,
                            })}</span>
                            <span>{t('workflow.providerExecution.authorityBoundary')}</span>
                        </>
                    ) : null}
                    <span>{t('workflow.providerExecution.attempts', {
                        total: governanceCase.primaryRequest.providerExecution.attempts.total,
                        failed: governanceCase.primaryRequest.providerExecution.attempts.failed,
                    })}</span>
                    {governanceCase.primaryRequest.providerExecution.privateEvidenceRelease ? (
                        <span
                            data-provider-private-evidence-release={governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.status}
                            data-provider-private-evidence-integrity={governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.integrity}
                            data-provider-private-evidence-http-self-proves={String(governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.httpSuccessSelfProvesCompletion)}
                        >
                            private evidence · {governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.provider}
                            {' · '}{governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.purpose}
                            {' · packages '}{governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.authorization.packageCount ?? 'invalid'}
                            {' · digest '}{governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.minimumPayloadDigest}
                            {' · completion '}{governanceCase.primaryRequest.providerExecution.privateEvidenceRelease.completionAuthority}
                        </span>
                    ) : null}
                    {governanceCase.primaryRequest.providerExecution.attempts.history.length > 0 ? (
                        <ol aria-label={t('workflow.providerExecution.attemptHistory')}>
                            {governanceCase.primaryRequest.providerExecution.attempts.history.map((attempt, index) => (
                                <li key={attempt.receiptId ?? `${attempt.status}:${index}`}>
                                    <span>{t(`workflow.providerExecution.attemptState.${attempt.status}`)}</span>
                                    {attempt.errorCode ? <code>{attempt.errorCode}</code> : null}
                                    {attempt.executedAt ? <time dateTime={attempt.executedAt}>{new Date(attempt.executedAt).toLocaleString()}</time> : null}
                                </li>
                            ))}
                        </ol>
                    ) : null}
                    <span>{t('workflow.providerExecution.artifactNotApplicable')}</span>
                    {governanceCase.primaryRequest.providerExecution.evidenceDigest ? (
                        <code>{governanceCase.primaryRequest.providerExecution.evidenceDigest}</code>
                    ) : null}
                </section>
            ) : null}
            {governanceCase.decisionOutputArtifacts.length > 0 ? (
                <section className={styles.stages} aria-labelledby="case-decision-output-title">
                    <div className={styles.stageHeading}>
                        <h3 id="case-decision-output-title">{t('workflow.artifact.title')}</h3>
                        <span>{t('workflow.artifact.boundary')}</span>
                    </div>
                    <ol>
                        {governanceCase.decisionOutputArtifacts.map((artifact) => (
                            <li key={artifact.id}>
                                <div>
                                    <strong>{artifact.kind === 'grant_agreement_amendment'
                                        ? grantLifecycleT('amendmentTitle')
                                        : artifact.kind === 'internal_execution_plan'
                                            || artifact.kind === 'manual_execution_plan'
                                            ? t('workflow.artifact.execution')
                                        : t(`workflow.artifact.kind.${artifact.kind}`)}</strong>
                                    <span className={artifact.integrity === 'verified' ? styles.current : styles.invalidated}>
                                        {t(`workflow.artifact.integrity.${artifact.integrity}`)}
                                    </span>
                                </div>
                                <dl>
                                    <div><dt>{t('workflow.artifact.source')}</dt><dd>{artifact.source.ref || t('workflow.artifact.sourceWithheld')}</dd></div>
                                    <div><dt>{t('workflow.artifact.contentDigest')}</dt><dd><code>{artifact.contentDigest}</code></dd></div>
                                    <div><dt>{t('workflow.artifact.decisionDigest')}</dt><dd><code>{artifact.decisionDigest}</code></dd></div>
                                    <div><dt>{t('workflow.artifact.finality')}</dt><dd>{t('workflow.artifact.nativeFinality')}</dd></div>
                                    <div><dt>{t('workflow.artifact.execution')}</dt><dd>{(artifact.kind === 'internal_execution_plan'
                                        || artifact.kind === 'manual_execution_plan')
                                        && 'executionPlan' in artifact.constraints
                                        ? String(artifact.constraints.executionPlan.aggregateStatus ?? '—')
                                        : t(artifact.kind === 'allocation_plan'
                                        ? 'workflow.artifact.noOpAllocation'
                                        : artifact.kind === 'selection_result'
                                            ? 'workflow.artifact.noOpSelection'
                                            : artifact.kind === 'appeal_resolution'
                                                ? artifact.executionCapability === 'current_adapter'
                                                    ? 'workflow.artifact.appealEffectApplied'
                                                    : 'workflow.artifact.appealUpheld'
                                            : 'workflow.artifact.noOp')}</dd></div>
                                    <div><dt>{t('workflow.artifact.adapter')}</dt><dd>{(artifact.kind === 'internal_execution_plan'
                                        || artifact.kind === 'manual_execution_plan')
                                        ? artifact.constraints.execution.adapterRef
                                        : t(artifact.executionCapability === 'current_adapter'
                                        ? 'workflow.artifact.externalAppAdapter'
                                        : 'workflow.artifact.noAdapter')}</dd></div>
                                    <div><dt>{t('workflow.artifact.providerReadiness')}</dt><dd>{t(artifact.kind === 'allocation_plan' ? 'workflow.artifact.providerNotReady' : 'workflow.artifact.providerNotApplicable')}</dd></div>
                                    {artifact.kind === 'allocation_plan' && 'allocationPlan' in artifact.constraints ? (
                                        <>
                                            <div><dt>{t('workflow.qf.round')}</dt><dd>{String(artifact.constraints?.allocationPlan?.roundRef ?? '—')}</dd></div>
                                            <div><dt>{t('workflow.qf.settlement')}</dt><dd>{t('workflow.qf.unfundedBoundary')}</dd></div>
                                        </>
                                    ) : null}
                                    {(artifact.kind === 'internal_execution_plan'
                                        || artifact.kind === 'manual_execution_plan')
                                        && 'executionPlan' in artifact.constraints ? (
                                        <>
                                            <div><dt>Request</dt><dd>{String(artifact.constraints.executionPlan.requestId ?? '—')}</dd></div>
                                            <div><dt>Receipt</dt><dd>{String((artifact.constraints.executionPlan.actions as any[])?.[0]?.receipt?.id ?? '—')}</dd></div>
                                            <div><dt>Action intent</dt><dd><code>{String((artifact.constraints.executionPlan.actions as any[])?.[0]?.actionIntentDigest ?? '—')}</code></dd></div>
                                            <div><dt>Network</dt><dd>{String((artifact.constraints.executionPlan.actions as any[])?.[0]?.network ?? '—')}</dd></div>
                                            <div><dt>Program</dt><dd>{String((artifact.constraints.executionPlan.actions as any[])?.[0]?.program ?? 'not applicable')}</dd></div>
                                            <div><dt>Atomicity</dt><dd>{String((artifact.constraints.executionPlan.actions as any[])?.[0]?.atomicity ?? '—')}</dd></div>
                                        </>
                                    ) : null}
                                    {artifact.kind === 'selection_result' && 'selectionResult' in artifact.constraints ? (
                                        <>
                                            <div><dt>{t('workflow.artifact.selectionSeats')}</dt><dd>{String(artifact.constraints.selectionResult.seatCount ?? '—')}</dd></div>
                                            <div><dt>{t('workflow.artifact.tieResolver')}</dt><dd>{String(artifact.constraints.selectionResult.tieResolver ?? '—')}</dd></div>
                                            <div><dt>{t('workflow.artifact.selectionResult')}</dt><dd>
                                                <ol>
                                                    {selectionRankedCandidates(artifact.constraints.selectionResult).map((candidate) => (
                                                        <li key={candidate.candidateRef}>
                                                            #{candidate.rank} {candidate.label} · {candidate.candidateRef} · {t('workflow.artifact.selectionScore', { score: candidate.score })} · {t(candidate.selected
                                                                ? 'workflow.artifact.selectionSelected'
                                                                : 'workflow.artifact.selectionNotSelected')}
                                                        </li>
                                                    ))}
                                                </ol>
                                            </dd></div>
                                        </>
                                    ) : null}
                                    {artifact.kind === 'appeal_resolution' && 'appealResolution' in artifact.constraints ? (
                                        <>
                                            <div><dt>{t('workflow.artifact.appealOutcome')}</dt><dd>{t(`workflow.artifact.appealOutcomeValue.${String(artifact.constraints.appealResolution.outcome)}`)}</dd></div>
                                            <div><dt>{t('workflow.artifact.originalReceipt')}</dt><dd><code>{String(artifact.constraints.appealResolution.originalExecutionReceiptId ?? '—')}</code></dd></div>
                                            <div><dt>{t('workflow.artifact.resultingStatus')}</dt><dd>{String(artifact.constraints.appealResolution.resultingDiscoveryStatus ?? artifact.constraints.appealResolution.resultingEffectState ?? '—')}</dd></div>
                                            <div><dt>{t('workflow.artifact.effectStatus')}</dt><dd>{String(artifact.constraints.appealResolution.effectStatus ?? '—')}</dd></div>
                                        </>
                                    ) : null}
                                    {artifact.kind === 'grant_agreement_amendment' && 'grantAgreementAmendment' in artifact.constraints ? (
                                        <>
                                            <div><dt>{grantLifecycleT('amendmentTitle')}</dt><dd><code>{String(artifact.constraints.grantAgreementAmendment.agreementId ?? '—')}</code></dd></div>
                                            <div><dt>{t('workflow.artifact.contentDigest')}</dt><dd><code>{String(artifact.constraints.grantAgreementAmendment.proposedTermsDigest ?? '—')}</code></dd></div>
                                            <div><dt>{grantLifecycleT('amendmentBoundary')}</dt><dd>{String(artifact.constraints.grantAgreementAmendment.reason ?? '—')}</dd></div>
                                        </>
                                    ) : null}
                                    <div><dt>{t('workflow.artifact.digest')}</dt><dd><code>{artifact.artifactDigest}</code></dd></div>
                                </dl>
                            </li>
                        ))}
                    </ol>
                </section>
            ) : null}
            {grantTargets.length > 0 ? (
                <section className={styles.stages} aria-labelledby="case-grant-agreement-title">
                    <div className={styles.stageHeading}>
                        <h3 id="case-grant-agreement-title">{t('workflow.grant.title')}</h3>
                        <span>{selectedGrantTarget?.existing
                            ? `${t('workflow.grant.fundingStatus')}: ${selectedGrantTarget.existing.fundingStatus}`
                            : t('workflow.grant.unfundedBoundary')}</span>
                    </div>
                    <div className={styles.grantForm}>
                        <label>
                            {t('workflow.grant.project')}
                            <Select
                                ariaLabel={t('workflow.grant.project')}
                                value={selectedGrantTarget?.key ?? ''}
                                onChange={setGrantTargetKey}
                                disabled={busy}
                                options={grantTargets.map((target) => ({
                                    value: target.key,
                                    label: `${target.projectRef} · ${target.totalPlannedUnits} ${target.budgetUnit}`,
                                }))}
                            />
                        </label>
                        {selectedGrantTarget ? (
                            <div className={styles.grantFacts}>
                                <span>{t('workflow.grant.recipient')}: {selectedGrantTarget.recipientRef}</span>
                                <span>{t('workflow.grant.contractualBudget')}: {selectedGrantTarget.totalPlannedUnits} {selectedGrantTarget.budgetUnit}</span>
                            </div>
                        ) : null}
                        {selectedGrantTarget?.existing ? (
                            <article className={styles.grantAgreement}>
                                <div>
                                    <strong>{selectedGrantTarget.existing.status === 'terminated'
                                        ? grantLifecycleT('terminated')
                                        : t('workflow.grant.active')}</strong>
                                    <span className={selectedGrantTarget.existing.integrity === 'verified' ? styles.current : styles.invalidated}>
                                        {t(`workflow.artifact.integrity.${selectedGrantTarget.existing.integrity}`)}
                                    </span>
                                </div>
                                <dl>
                                    <div><dt>{t('workflow.grant.fundingStatus')}</dt><dd>{selectedGrantTarget.existing.fundingStatus}</dd></div>
                                    <div><dt>{t('workflow.grant.contractualBudget')}</dt><dd>{selectedGrantTarget.existing.budget.contractualUnits} = {selectedGrantTarget.existing.budget.committedContractualUnits} committed; {selectedGrantTarget.existing.budget.paidContractualUnits} paid; {selectedGrantTarget.existing.budget.remainingContractualUnits} remaining; {selectedGrantTarget.existing.budget.blockedContractualUnits} blocked {selectedGrantTarget.existing.budget.unit}</dd></div>
                                    <div><dt>{t('workflow.grant.decisionDigest')}</dt><dd><code>{selectedGrantTarget.existing.governingDecision.digest}</code></dd></div>
                                    <div><dt>{t('workflow.grant.termsDigest')}</dt><dd><code>{selectedGrantTarget.existing.termsDigest}</code></dd></div>
                                    <div><dt>{t('workflow.grant.activatedAt')}</dt><dd>{selectedGrantTarget.existing.activatedAt ? new Date(selectedGrantTarget.existing.activatedAt).toLocaleString() : '—'}</dd></div>
                                </dl>
                                <section
                                    className={styles.grantFacts}
                                    data-testid="grant-settlement-readiness"
                                    data-readiness-state={selectedGrantTarget.existing.settlementReadiness?.state ?? 'setup_required'}
                                    data-readiness-integrity={selectedGrantTarget.existing.settlementReadinessIntegrity}
                                >
                                    <strong>{t('workflow.grant.settlementReadiness')}</strong>
                                    <span>
                                        {t('workflow.grant.settlementState')}: {' '}
                                        {selectedGrantTarget.existing.settlementReadiness?.state ?? 'setup_required'}
                                        {' · '}{t('workflow.grant.settlementIntegrity')}: {' '}
                                        {selectedGrantTarget.existing.settlementReadinessIntegrity}
                                        {' · v'}{selectedGrantTarget.existing.settlementReadinessVersion}
                                    </span>
                                    <span>
                                        {t('workflow.grant.settlementEvaluatedAt')}: {' '}
                                        {selectedGrantTarget.existing.settlementReadinessEvaluatedAt
                                            ? new Date(selectedGrantTarget.existing.settlementReadinessEvaluatedAt).toLocaleString()
                                            : '—'}
                                    </span>
                                    {selectedGrantTarget.existing.settlementReadiness ? <>
                                        <span>
                                            {t('workflow.grant.settlementResource')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.resource.state}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.resource.chainId ?? '—'}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.resource.profileRef ?? '—'}
                                            {selectedGrantTarget.existing.settlementReadiness.resource.profileVersion == null
                                                ? ''
                                                : ` v${selectedGrantTarget.existing.settlementReadiness.resource.profileVersion}`}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.resource.resourceRef ?? '—'}
                                        </span>
                                        <span>
                                            {t('workflow.grant.settlementAuthority')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.authority.state}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.authority.bindingRefs.join(', ') || '—'}
                                        </span>
                                        <span>
                                            {t('workflow.grant.settlementPayer')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.payer.state}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.payer.policyRef ?? '—'}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.payer.fundingBlockerCode ?? 'no blocker'}
                                        </span>
                                        <span>
                                            {t('workflow.grant.settlementAssetAuthority')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.assetAuthority.state}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.assetAuthority.policyRef ?? '—'}
                                        </span>
                                        <span>
                                            {t('workflow.grant.settlementFundingReadback')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.fundingReadback.state}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.fundingReadback.availableUnits ?? '—'}
                                            {' · '}{selectedGrantTarget.existing.settlementReadiness.fundingReadback.finality ?? 'not finalized'}
                                        </span>
                                        <span>
                                            {t('workflow.grant.settlementPayoutBoundary')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.payout.intent}
                                            {' · paid='}{String(selectedGrantTarget.existing.settlementReadiness.payout.paid)}
                                            {' · finality='}{String(selectedGrantTarget.existing.settlementReadiness.payout.providerFinality)}
                                        </span>
                                        <span>
                                            {t('workflow.grant.settlementBlockers')}: {' '}
                                            {selectedGrantTarget.existing.settlementReadiness.blockerCodes.join(', ') || t('workflow.grant.settlementNoBlockers')}
                                        </span>
                                    </> : <span>
                                        {t('workflow.grant.settlementBlockers')}: {' '}
                                        {selectedGrantTarget.existing.settlementReadinessIntegrity === 'not_evaluated'
                                            ? 'grant_settlement_readiness_not_evaluated'
                                            : 'grant_settlement_readiness_invalid'}
                                    </span>}
                                    {workflow.canManage ? <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void refreshGrantSettlementReadiness()}
                                    >
                                        <RefreshCw size={14} aria-hidden="true" />
                                        {t('workflow.grant.settlementRefresh')}
                                    </button> : null}
                                    {selectedGrantTarget.existing.payoutRequests[0] ? <span
                                        data-testid="grant-payout-request-readback"
                                        data-request-state={selectedGrantTarget.existing.payoutRequests[0].state}
                                    >
                                        {t('workflow.grant.settlementPayoutRequest')} <code>{selectedGrantTarget.existing.payoutRequests[0].id}</code>
                                        {' · '}{selectedGrantTarget.existing.payoutRequests[0].state}
                                        {selectedGrantTarget.existing.payoutRequests[0].decision
                                            ? ` · ${selectedGrantTarget.existing.payoutRequests[0].decision.decision}`
                                            : ''}
                                        {selectedGrantTarget.existing.payoutRequests[0].execution
                                            ? ` · ${selectedGrantTarget.existing.payoutRequests[0].execution.status}`
                                            : ''}
                                    </span> : null}
                                    {selectedGrantTarget.existing.payoutRequests[0]?.providerExecution?.retry ? <span
                                        data-testid="grant-payout-provider-retry"
                                        data-retry-mode={selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.mode}
                                        data-retry-request-id={selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.requestId}
                                        data-retry-attempt-count={selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.attemptCount}
                                    >
                                        {selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.mode}
                                        {' · attempt '}{selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.attemptCount}
                                        {' · '}
                                        <time dateTime={selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.nextRetryAt}>
                                            {new Date(selectedGrantTarget.existing.payoutRequests[0].providerExecution.retry.nextRetryAt).toLocaleString()}
                                        </time>
                                    </span> : null}
                                </section>
                                {selectedGrantTarget.existing.lifecycle.terminationRequest ? <div className={styles.grantFacts}>
                                    <strong>{grantLifecycleT('terminationGovernance')}</strong>
                                    <span>{grantLifecycleT('terminationCase')}: <Link href={`/governance/cases/${String(selectedGrantTarget.existing.lifecycle.terminationRequest.caseId)}`}>{String(selectedGrantTarget.existing.lifecycle.terminationRequest.caseId)} <ArrowUpRight size={14} /></Link></span>
                                    <span>{grantLifecycleT('terminationRequestStatus')}: {String(selectedGrantTarget.existing.lifecycle.terminationRequest.status)}</span>
                                </div> : null}
                                {selectedGrantTarget.existing.lifecycle.termination ? <dl>
                                    <div><dt>{grantLifecycleT('terminationGround')}</dt><dd>{String(selectedGrantTarget.existing.lifecycle.termination.ground)}</dd></div>
                                    <div><dt>{grantLifecycleT('stoppedFutureMilestones')}</dt><dd>{(selectedGrantTarget.existing.lifecycle.termination.stoppedFutureMilestoneIds as string[]).join(', ') || '—'}</dd></div>
                                    <div><dt>{grantLifecycleT('blockedContractualIntents')}</dt><dd>{(selectedGrantTarget.existing.lifecycle.termination.blockedContractualIntentIds as string[]).join(', ') || '—'}</dd></div>
                                    <div><dt>{grantLifecycleT('retainedObligations')}</dt><dd>{(selectedGrantTarget.existing.lifecycle.termination.retainedObligations as string[]).join('; ')}</dd></div>
                                    <div><dt>{grantLifecycleT('outstandingObligations')}</dt><dd>{(selectedGrantTarget.existing.lifecycle.termination.outstandingObligations as string[]).join('; ') || '—'}</dd></div>
                                    <div><dt>{grantLifecycleT('recoveryBoundary')}</dt><dd>{grantLifecycleT('manualClaimOnly')}</dd></div>
                                    <div><dt>{grantLifecycleT('terminationArtifact')}</dt><dd><code>{String(selectedGrantTarget.existing.lifecycle.termination.amendmentArtifactDigest)}</code></dd></div>
                                </dl> : null}
                                <ol>
                                    {selectedGrantTarget.existing.terms.milestones.map((milestone) => {
                                        const agreement = selectedGrantTarget.existing!;
                                        const results = agreement.lifecycle.milestoneResults.filter((item) => item.milestoneId === milestone.id);
                                        const latestResult = results.at(-1) ?? null;
                                        const appeal = agreement.lifecycle.appeals.find((item) => item.milestoneId === milestone.id && item.status === 'open') ?? null;
                                        const appealForLatestResult = latestResult
                                            ? agreement.lifecycle.appeals.find((item) => item.originalResultDigest === latestResult.digest) ?? null
                                            : null;
                                        const canReviewMilestone = Boolean(
                                            viewerPubkey
                                            && agreement.status === 'active'
                                            && milestone.reviewerAuthority.effectiveReviewerPubkeys.includes(viewerPubkey)
                                            && !appeal
                                            && (!latestResult || latestResult.outcome === 'rework'),
                                        );
                                        const recipientWallet = agreement.recipientRef.startsWith('wallet:') ? agreement.recipientRef.slice(7) : agreement.recipientRef;
                                        const recipientOrApplicantPubkeys = new Set([
                                            recipientWallet,
                                            ...agreement.terms.recipient.applicantPubkeys,
                                        ]);
                                        const canAppealMilestone = Boolean(
                                            viewerPubkey
                                            && recipientOrApplicantPubkeys.has(viewerPubkey)
                                            && latestResult
                                            && ['rework', 'reject'].includes(String(latestResult.outcome))
                                            && !appealForLatestResult,
                                        );
                                        const canVoteAppeal = Boolean(viewerPubkey && appeal?.reviewerPubkeys?.includes(viewerPubkey) && !appeal?.originalReviewerPubkeys?.includes(viewerPubkey));
                                        return <li key={milestone.id}>
                                            <strong>{milestone.title}</strong>
                                            <span>{milestone.deliverable}</span>
                                            <span>{grantLifecycleT('trancheAmount')}: {milestone.contractualUnits} {agreement.budget.unit}</span>
                                            <span>{t('workflow.grant.deadline')}: {new Date(milestone.deadline).toLocaleString()}</span>
                                            <span>{t('workflow.grant.reviewerQuorum')}: {milestone.reviewerAuthority.quorum}</span>
                                            <span>{t('workflow.grant.effectiveReviewers')}: {milestone.reviewerAuthority.effectiveReviewerPubkeys.join(', ')}</span>
                                            <span>{t('workflow.grant.recusedReviewers')}: {milestone.reviewerAuthority.recusedReviewerPubkeys.join(', ') || '—'}</span>
                                            <span>{grantLifecycleT('appealReviewers')}: {milestone.appealAuthority.reviewerPubkeys.join(', ')}</span>
                                            <span>{t('workflow.grant.maxRevisions')}: {milestone.maxRevisions}</span>
                                            {latestResult ? <span>{grantLifecycleT('latestResult')}: {String(latestResult.outcome)} · <code>{String(latestResult.digest)}</code></span> : null}
                                            {agreement.lifecycle.trancheIntents.filter((item) => item.milestoneId === milestone.id).map((intent) => (
                                                <span key={String(intent.id)}>{grantLifecycleT('trancheIntent')}: {String(intent.amountUnits)} {String(intent.budgetUnit)} · {intent.effectiveStatus === 'blocked_terminated' ? grantLifecycleT('blockedTerminated') : grantLifecycleT('unpaidIntent')}</span>
                                            ))}
                                            {appeal ? <span>{grantLifecycleT('disputed')}: {String(appeal.status)} · {String(appeal.settlementAuthorization)}</span> : null}
                                            {canReviewMilestone ? <div className={styles.grantForm}>
                                                <label>
                                                    {grantLifecycleT('reviewOutcome')}
                                                    <Select
                                                        ariaLabel={grantLifecycleT('reviewOutcome')}
                                                        value={grantReviewOutcome}
                                                        onChange={(value) => setGrantReviewOutcome(value as typeof grantReviewOutcome)}
                                                        disabled={busy}
                                                        options={[
                                                            { value: 'accept', label: 'accept' },
                                                            { value: 'rework', label: 'rework' },
                                                            { value: 'reject', label: 'reject' },
                                                        ]}
                                                    />
                                                </label>
                                                <label className={styles.grantWide}>{grantLifecycleT('reviewEvidence')}<input value={grantReviewEvidence} onChange={(event) => setGrantReviewEvidence(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                                <label className={styles.grantWide}>{grantLifecycleT('reviewSummary')}<textarea value={grantReviewSummary} onChange={(event) => setGrantReviewSummary(event.target.value)} disabled={busy} /></label>
                                                <button type="button" disabled={busy || !grantReviewEvidence.trim() || !grantReviewSummary.trim()} onClick={() => void recordGrantMilestoneReview()}>{grantLifecycleT('recordReview')}</button>
                                            </div> : null}
                                            {canAppealMilestone && latestResult ? <div className={styles.grantForm}>
                                                <label className={styles.grantWide}>{grantLifecycleT('appealReason')}<textarea value={grantAppealReason} onChange={(event) => setGrantAppealReason(event.target.value)} disabled={busy} /></label>
                                                <label className={styles.grantWide}>{grantLifecycleT('appealEvidence')}<input value={grantAppealEvidence} onChange={(event) => setGrantAppealEvidence(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                                <button type="button" disabled={busy || !grantAppealReason.trim()} onClick={() => void openGrantAppeal(String(latestResult.digest))}>{grantLifecycleT('openAppeal')}</button>
                                            </div> : null}
                                            {canVoteAppeal && appeal ? <div className={styles.grantForm}>
                                                <label>
                                                    {grantLifecycleT('appealVote')}
                                                    <Select
                                                        ariaLabel={grantLifecycleT('appealVote')}
                                                        value={grantAppealVote}
                                                        onChange={(value) => setGrantAppealVote(value as typeof grantAppealVote)}
                                                        disabled={busy}
                                                        options={[
                                                            { value: 'uphold', label: 'uphold' },
                                                            { value: 'overturn_accept', label: 'overturn_accept' },
                                                        ]}
                                                    />
                                                </label>
                                                <label className={styles.grantWide}>{grantLifecycleT('appealVoteReason')}<textarea value={grantAppealVoteReason} onChange={(event) => setGrantAppealVoteReason(event.target.value)} disabled={busy} /></label>
                                                <button type="button" disabled={busy || !grantAppealVoteReason.trim()} onClick={() => void voteGrantAppeal(String(appeal.id))}>{grantLifecycleT('recordAppealVote')}</button>
                                            </div> : null}
                                        </li>;
                                    })}
                                </ol>
                                {workflow.canManage && selectedGrantTarget.existing.status === 'active' ? <div className={styles.grantForm}>
                                    <strong className={styles.grantWide}>{grantLifecycleT('amendmentTitle')}</strong>
                                    <span className={styles.grantWide}>{grantLifecycleT('amendmentBoundary')}</span>
                                    <label>{grantLifecycleT('amendedDeadline')}<input type="datetime-local" value={grantAmendmentDeadline} onChange={(event) => setGrantAmendmentDeadline(event.target.value)} disabled={busy} /></label>
                                    <label className={styles.grantWide}>{grantLifecycleT('amendmentReason')}<textarea value={grantAmendmentReason} onChange={(event) => setGrantAmendmentReason(event.target.value)} disabled={busy} /></label>
                                    <button type="button" disabled={busy || !grantAmendmentDeadline || !grantAmendmentReason.trim()} onClick={() => void openGrantAmendmentCase()}>{grantLifecycleT('openAmendmentCase')}</button>
                                </div> : null}
                                {workflow.canManage
                                    && selectedGrantTarget.existing.status === 'active'
                                    && !selectedGrantTarget.existing.lifecycle.terminationRequest ? <div className={styles.grantForm}>
                                    <strong className={styles.grantWide}>{grantLifecycleT('terminationTitle')}</strong>
                                    <span className={styles.grantWide}>{grantLifecycleT('terminationBoundary')}</span>
                                    <label>
                                        {grantLifecycleT('terminationGround')}
                                        <Select
                                            ariaLabel={grantLifecycleT('terminationGround')}
                                            value={grantTerminationGround}
                                            onChange={(value) => setGrantTerminationGround(value as typeof grantTerminationGround)}
                                            disabled={busy}
                                            options={[
                                                { value: 'milestone_rejected', label: 'milestone_rejected' },
                                                { value: 'schedule_expired', label: 'schedule_expired' },
                                                { value: 'governing_decision_revoked', label: 'governing_decision_revoked' },
                                            ]}
                                        />
                                    </label>
                                    <label className={styles.grantWide}>{grantLifecycleT('terminationReason')}<textarea value={grantTerminationReason} onChange={(event) => setGrantTerminationReason(event.target.value)} disabled={busy} /></label>
                                    <label className={styles.grantWide}>{grantLifecycleT('retainedObligations')}<input value={grantRetainedObligations} onChange={(event) => setGrantRetainedObligations(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                    <label className={styles.grantWide}>{grantLifecycleT('outstandingObligations')}<input value={grantOutstandingObligations} onChange={(event) => setGrantOutstandingObligations(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                    <button type="button" disabled={busy || !grantTerminationReason.trim() || !grantRetainedObligations.trim()} onClick={() => void openGrantTerminationCase()}>{grantLifecycleT('openTerminationCase')}</button>
                                </div> : null}
                                {workflow.canManage
                                    && selectedGrantTarget.existing.lifecycle.terminationRequest?.status === 'governance_pending' ? <div className={styles.grantForm}>
                                    <span className={styles.grantWide}>{grantLifecycleT('terminationApplyBoundary')}</span>
                                    <button type="button" disabled={busy} onClick={() => void applyGrantTermination()}>{grantLifecycleT('applyAcceptedTermination')}</button>
                                </div> : null}
                                {selectedGrantTarget.existing.lifecycle.outcome ? <dl>
                                    <div><dt>{grantLifecycleT('outcomeStatus')}</dt><dd>{String(selectedGrantTarget.existing.lifecycle.outcome.status)}</dd></div>
                                    <div><dt>{grantLifecycleT('outcomeSummary')}</dt><dd>{String(selectedGrantTarget.existing.lifecycle.outcome.summary)}</dd></div>
                                    <div><dt>{grantLifecycleT('actualImpact')}</dt><dd>{(selectedGrantTarget.existing.lifecycle.outcome.actualImpact as string[]).join('; ')}</dd></div>
                                    <div><dt>{grantLifecycleT('outstandingObligations')}</dt><dd>{(selectedGrantTarget.existing.lifecycle.outcome.outstandingObligations as string[]).join('; ') || '—'}</dd></div>
                                    <div><dt>{grantLifecycleT('fundingEvidence')}</dt><dd>{grantLifecycleT('noPayoutEvidence')}</dd></div>
                                    <div><dt>{grantLifecycleT('outcomeDigest')}</dt><dd><code>{String(selectedGrantTarget.existing.lifecycle.outcome.digest)}</code></dd></div>
                                </dl> : viewerPubkey && selectedGrantTarget.existing.terms.outcomePolicy.reviewerPubkeys.includes(viewerPubkey) ? <div className={styles.grantForm}>
                                    <strong className={styles.grantWide}>{grantLifecycleT('outcomeTitle')}</strong>
                                    <span className={styles.grantWide}>{grantLifecycleT('outcomeBoundary')}</span>
                                    {selectedGrantTarget.existing.status === 'active' ? (
                                        <label>
                                            {grantLifecycleT('outcomeStatus')}
                                            <Select
                                                ariaLabel={grantLifecycleT('outcomeStatus')}
                                                value={grantOutcomeStatus}
                                                onChange={(value) => setGrantOutcomeStatus(value as typeof grantOutcomeStatus)}
                                                disabled={busy}
                                                options={[
                                                    { value: 'fulfilled', label: 'fulfilled' },
                                                    { value: 'partially_fulfilled', label: 'partially_fulfilled' },
                                                    { value: 'not_fulfilled', label: 'not_fulfilled' },
                                                ]}
                                            />
                                        </label>
                                    ) : null}
                                    <label className={styles.grantWide}>{grantLifecycleT('outcomeSummary')}<textarea value={grantOutcomeSummary} onChange={(event) => setGrantOutcomeSummary(event.target.value)} disabled={busy} /></label>
                                    <label className={styles.grantWide}>{grantLifecycleT('actualImpact')}<input value={grantActualImpact} onChange={(event) => setGrantActualImpact(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                    <label className={styles.grantWide}>{grantLifecycleT('outstandingObligations')}<input value={grantOutcomeOutstanding} onChange={(event) => setGrantOutcomeOutstanding(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                    <label className={styles.grantWide}>{grantLifecycleT('outcomeEvidence')}<input value={grantOutcomeEvidence} onChange={(event) => setGrantOutcomeEvidence(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                    <label>{grantLifecycleT('observationStartedAt')}<input type="datetime-local" value={grantObservationStartedAt} onChange={(event) => setGrantObservationStartedAt(event.target.value)} disabled={busy} /></label>
                                    <label>{grantLifecycleT('observationEndedAt')}<input type="datetime-local" value={grantObservationEndedAt} onChange={(event) => setGrantObservationEndedAt(event.target.value)} disabled={busy} /></label>
                                    <button type="button" disabled={busy || !grantOutcomeSummary.trim() || !grantActualImpact.trim() || !grantOutcomeEvidence.trim() || !grantObservationStartedAt || !grantObservationEndedAt} onClick={() => void recordGrantOutcome()}>{grantLifecycleT('recordOutcome')}</button>
                                </div> : null}
                            </article>
                        ) : (
                            <>
                                {viewerPubkey && workflow.version ? (
                                    <div className={styles.actionRow}>
                                        <Select
                                            ariaLabel={t('workflow.conflict.reason')}
                                            value={conflictReason}
                                            onChange={(value) => setConflictReason(value as GovernanceCaseConflictReason)}
                                            disabled={busy}
                                            options={CONFLICT_REASONS.map((value) => ({
                                                value,
                                                label: t(`workflow.conflict.reasonCode.${value}`),
                                            }))}
                                        />
                                        <button type="button" disabled={busy} onClick={() => void discloseGrantConflict()}>
                                            {t('workflow.grant.discloseConflict')}
                                        </button>
                                    </div>
                                ) : null}
                                {workflow.canManage ? (
                                    <>
                                        <label>{t('workflow.grant.milestoneTitle')}<input value={grantMilestoneTitle} onChange={(event) => setGrantMilestoneTitle(event.target.value)} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.deliverable')}<textarea value={grantDeliverable} onChange={(event) => setGrantDeliverable(event.target.value)} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.evidenceRequirements')}<input value={grantEvidenceRequirements} onChange={(event) => setGrantEvidenceRequirements(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                        <label>{t('workflow.grant.deadline')}<input type="datetime-local" value={grantDeadline} onChange={(event) => setGrantDeadline(event.target.value)} disabled={busy} /></label>
                                        <label>{t('workflow.grant.reviewerQuorum')}<input type="number" min="1" value={grantReviewerQuorum} onChange={(event) => setGrantReviewerQuorum(event.target.value)} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.primaryReviewers')}<input value={grantPrimaryReviewers} onChange={(event) => setGrantPrimaryReviewers(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.alternateReviewers')}<input value={grantAlternateReviewers} onChange={(event) => setGrantAlternateReviewers(event.target.value)} placeholder={t('workflow.grant.commaSeparated')} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.acceptCriteria')}<textarea value={grantAcceptCriteria} onChange={(event) => setGrantAcceptCriteria(event.target.value)} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.reworkCriteria')}<textarea value={grantReworkCriteria} onChange={(event) => setGrantReworkCriteria(event.target.value)} disabled={busy} /></label>
                                        <label className={styles.grantWide}>{t('workflow.grant.rejectCriteria')}<textarea value={grantRejectCriteria} onChange={(event) => setGrantRejectCriteria(event.target.value)} disabled={busy} /></label>
                                        <label>{t('workflow.grant.maxRevisions')}<input type="number" min="0" max="10" value={grantMaxRevisions} onChange={(event) => setGrantMaxRevisions(event.target.value)} disabled={busy} /></label>
                                        <div className={styles.actionRow}>
                                            <button type="button" disabled={busy} onClick={() => void activateGrantAgreement()}>
                                                {t('workflow.grant.activate')}
                                            </button>
                                        </div>
                                    </>
                                ) : null}
                            </>
                        )}
                    </div>
                </section>
            ) : null}
            <div className={styles.timeline}>
                <div className={styles.timelineHeading}>
                    <div>
                        <h3>{t('workflow.timeline')}</h3>
                        <span>{t('workflow.timelineCount', { count: workflow.timeline.length })}</span>
                    </div>
                    <p>{t('workflow.timelineHistoryBoundary')}</p>
                </div>
                {workflow.timeline.length ? (
                    <ol className={styles.timelineList}>
                        {timelineOpeningEvents.map(renderTimelineEvent)}
                        {timelineMiddleEvents.length ? (
                            <li className={styles.timelineGap}>
                                <details data-testid="case-timeline-history">
                                    <summary>
                                        <span>{t('workflow.timelineMore', { count: timelineMiddleEvents.length })}</span>
                                        <ChevronDown aria-hidden="true" size={16} />
                                    </summary>
                                    <ol className={styles.timelineArchive}>
                                        {timelineMiddleEvents.map(renderTimelineEvent)}
                                    </ol>
                                </details>
                            </li>
                        ) : null}
                        {timelineRecentEvents.map(renderTimelineEvent)}
                    </ol>
                ) : <p className={styles.timelineEmpty}>{t('workflow.timelineEmpty')}</p>}
            </div>
        </section>
    );
}

function selectionRankedCandidates(value: Record<string, unknown>): Array<{
    rank: number;
    selected: boolean;
    label: string;
    candidateRef: string;
    score: number;
}> {
    if (!Array.isArray(value.rankedCandidates)) return [];
    return value.rankedCandidates.flatMap((candidate: any) => {
        const rank = Number(candidate?.rank);
        const score = Number(candidate?.score);
        const label = String(candidate?.label ?? '').trim();
        const candidateRef = String(candidate?.candidateRef ?? '').trim();
        if (!Number.isSafeInteger(rank) || rank < 1 || !Number.isSafeInteger(score) || score < 0 || !label || !candidateRef) {
            return [];
        }
        return [{ rank, score, label, candidateRef, selected: candidate?.selected === true }];
    });
}

function commaSeparatedValues(value: string): string[] {
    return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function outcomeLines(value: string): string[] {
    return value.split('\n').map((item) => item.trim()).filter((item) => {
        if (!item) return false;
        if (/^(无|没有|none|n\/a|-)$/i.test(item)) return false;
        return item.length >= 2;
    });
}

function governanceWorkflowErrorCode(error: unknown): string | null {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as { error?: unknown };
            if (typeof parsed.error === 'string' && parsed.error.startsWith('governance_case_')) {
                return parsed.error;
            }
        } catch {
            // Fall through to regex.
        }
    }
    return raw.match(/governance_case_[a-z0-9_]+/)?.[0] ?? null;
}

function closeErrorMessage(error: unknown, t: (key: string) => string): string {
    const code = governanceWorkflowErrorCode(error);
    if (!code) return t('workflow.closeError');
    if (/actual_outcome_(quantitative_impact|deviations|failures|outstanding_obligations)_invalid/.test(code)) {
        return t('workflow.closeErrors.optionalLineTooShort');
    }
    const mapped = t(`workflow.closeErrors.${code}`);
    return mapped === `workflow.closeErrors.${code}` ? t('workflow.closeError') : mapped;
}

function OutcomeFacts({ title, values, empty }: { title: string; values: string[]; empty: string }) {
    return (
        <div className={styles.outcomeFacts}>
            <strong>{title}</strong>
            {values.length > 0 ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <span>{empty}</span>}
        </div>
    );
}

function candidateLabel(
    candidates: GovernanceCase['workflow']['candidates'],
    pubkey: string,
): string {
    const candidate = candidates.find((item) => item.pubkey === pubkey);
    if (candidate) return candidate.displayName || candidate.handle;
    return shortPubkey(pubkey);
}

function responsibilityKindsForPhase(
    phase: GovernanceCase['phase'],
): GovernanceCaseResponsibilityKind[] {
    if (phase === 'evidence_review') return ['coordinator', 'review'];
    if (phase === 'execution_preparation' || phase === 'execution_in_progress') {
        return ['execution'];
    }
    if (phase === 'outcome_review') return ['outcome'];
    if (phase === 'decision_in_progress' || phase === 'closed' || phase === 'archived') return [];
    return ['coordinator'];
}

function responsibilityKindForTaskRole(
    role: 'proposer' | 'coordinator' | 'reviewer' | 'voter' | 'appellant' | 'executor' | 'outcome_reviewer' | null | undefined,
): GovernanceCaseResponsibilityKind | null {
    if (role === 'coordinator') return 'coordinator';
    if (role === 'reviewer') return 'review';
    if (role === 'executor') return 'execution';
    if (role === 'outcome_reviewer') return 'outcome';
    return null;
}

function responsibilitySelfActions(
    status: GovernanceCaseResponsibilityStatus,
): Record<'accept' | 'decline' | 'escalate' | 'absence', boolean> {
    return {
        accept: status === 'assigned' || status === 'escalated' || status === 'absent',
        decline: status === 'assigned' || status === 'accepted',
        escalate: status === 'assigned' || status === 'accepted',
        absence: status === 'assigned' || status === 'accepted' || status === 'escalated',
    };
}

function shortPubkey(pubkey: string): string {
    return pubkey.length > 14 ? `${pubkey.slice(0, 7)}…${pubkey.slice(-5)}` : pubkey;
}

async function downloadCredentialBytes(
    caseId: string,
    submission: ProviderAdmissionExternalCredentialSubmission,
): Promise<{ filename: string; objectUrl: string }> {
    const stem = caseId.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const filename = `${stem}-provider-admission.json`;
    // octet-stream so mobile WebViews download instead of rendering JSON in-tab.
    // Never window.open(blob): that replaces the app with a JSON page and no back button.
    const jsonBlob = new Blob([JSON.stringify(submission, null, 2)], {
        type: 'application/octet-stream',
    });
    const objectUrl = URL.createObjectURL(jsonBlob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const jws = String(submission.credentialJws || '').trim();
    if (jws) {
        const jwsUrl = URL.createObjectURL(new Blob([jws], { type: 'text/plain' }));
        const jwsAnchor = document.createElement('a');
        jwsAnchor.href = jwsUrl;
        jwsAnchor.download = `${stem}-provider-admission.jws`;
        jwsAnchor.rel = 'noopener';
        document.body.appendChild(jwsAnchor);
        jwsAnchor.click();
        jwsAnchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(jwsUrl), 1_000);
    }
    return { filename, objectUrl };
}

function responsibilitySlaState(
    responsibility: GovernanceCase['workflow']['responsibilities'][number],
): 'on_track' | 'overdue' | 'escalated' | 'absent' | 'declined' | 'no_deadline' {
    if (responsibility.status === 'escalated') return 'escalated';
    if (responsibility.status === 'absent') return 'absent';
    if (responsibility.status === 'declined') return 'declined';
    if (!responsibility.deadlineAt) return 'no_deadline';
    return new Date(responsibility.deadlineAt).getTime() <= Date.now() ? 'overdue' : 'on_track';
}
