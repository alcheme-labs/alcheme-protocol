'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileText, Landmark, RefreshCw, Search } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import ScenarioComposeSurface from '@/features/compose/ScenarioComposeSurface';
import GovernanceCaseBriefPanel from '@/features/governance/GovernanceCaseBriefPanel';
import GovernanceDecisionExecutionStatus from '@/features/governance/GovernanceDecisionExecutionStatus';
import GovernanceExecutionRecoveryStatus from '@/features/governance/GovernanceExecutionRecoveryStatus';
import GovernanceProviderIncidentStatus from '@/features/governance/GovernanceProviderIncidentStatus';
import GovernanceCaseEvidenceSharePanel from '@/features/governance/GovernanceCaseEvidenceSharePanel';
import GovernanceCaseWorkflowPanel from '@/features/governance/GovernanceCaseWorkflowPanel';
import {
    resolveCaseScenarioCompose,
    scrollToComposeTarget,
} from '@/features/governance/caseScenarioCompose';
import {
    exportGovernanceCaseAudience,
    fetchGovernanceCase,
    fetchGovernanceCaseSearch,
    GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS,
    governanceCaseResumeFragment,
    openGovernanceConfigurationRollback,
    retryGovernanceFundingAmendedExecution,
    updateGovernanceCaseAttentionPreference,
    updateGovernanceCaseReadCursor,
    type GovernanceCase,
    type GovernanceCaseSearchResponse,
} from '@/lib/api/governance';
import { buildGovernanceCaseMarkdownSummary } from '@/lib/governance/caseShare';
import {
    governanceCaseRequestStatus,
    startGovernanceCaseForegroundRefetch,
} from '@/lib/governance/governanceCaseRealtime.mjs';
import { fetchSessionMe } from '@/lib/api/session';
import styles from './page.module.css';

function decodeRouteParam(value: unknown): string {
    const raw = String(value || '');
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

export default function GovernanceCasePage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const t = useI18n('GovernanceCases');
    const inboxT = useI18n('MyGovernance');
    const manualExecutionT = useI18n('MyGovernanceManualExecution');
    const caseId = decodeRouteParam(params.id);
    const [governanceCase, setGovernanceCase] = useState<GovernanceCase | null>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<'link' | 'markdown' | null>(null);
    const [viewerPubkey, setViewerPubkey] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [openingRollback, setOpeningRollback] = useState(false);
    const [rollbackError, setRollbackError] = useState<string | null>(null);
    const [retryingFundingAmendment, setRetryingFundingAmendment] = useState(false);
    const [fundingAmendmentRetryError, setFundingAmendmentRetryError] = useState(false);
    const [attentionSaving, setAttentionSaving] = useState(false);
    const [attentionError, setAttentionError] = useState(false);
    const [readResumeFragment, setReadResumeFragment] = useState<string | null | undefined>(undefined);
    const [caseSearchQuery, setCaseSearchQuery] = useState('');
    const [caseSearchResult, setCaseSearchResult] = useState<GovernanceCaseSearchResponse | null>(null);
    const [caseSearchLoading, setCaseSearchLoading] = useState(false);
    const [caseSearchError, setCaseSearchError] = useState(false);
    const readCursorVisitId = useRef<string>(crypto.randomUUID());
    const readCursorMarked = useRef<string | null>(null);
    const activeCaseIdRef = useRef(caseId);
    const caseReadVersionRef = useRef(0);
    const [composeCollapsed, setComposeCollapsed] = useState(false);
    const [composeDockElement, setComposeDockElement] = useState<HTMLDivElement | null>(null);
    const composeScenarioKeyRef = useRef<string | null>(null);

    const loadCase = useCallback(async () => {
        const requestVersion = caseReadVersionRef.current + 1;
        caseReadVersionRef.current = requestVersion;
        const requestedCaseId = caseId;
        try {
            const value = await fetchGovernanceCase(caseId);
            if (
                activeCaseIdRef.current === requestedCaseId
                && caseReadVersionRef.current === requestVersion
            ) {
                setGovernanceCase(value);
            }
        } catch (error) {
            const status = governanceCaseRequestStatus(error);
            if (
                [401, 403, 404, 410].includes(status ?? 0)
                && activeCaseIdRef.current === requestedCaseId
                && caseReadVersionRef.current === requestVersion
            ) {
                setGovernanceCase(null);
            }
            throw error;
        }
    }, [caseId]);

    const changeAttention = useCallback((level: 'watch' | 'track' | 'mute') => {
        const preference = governanceCase?.attentionPreference;
        if (!preference || attentionSaving || preference.level === level) return;
        setAttentionSaving(true);
        setAttentionError(false);
        void updateGovernanceCaseAttentionPreference({
            caseId,
            level,
            expectedVersion: preference.version,
        }).then((result) => {
            setGovernanceCase((current) => current
                ? { ...current, attentionPreference: result.preference }
                : current);
        }).catch(() => setAttentionError(true)).finally(() => setAttentionSaving(false));
    }, [attentionSaving, caseId, governanceCase?.attentionPreference]);

    const retryFundingAmendedExecution = useCallback(() => {
        const requestId = governanceCase?.primaryRequest?.id;
        if (!requestId || retryingFundingAmendment) return;
        if (!window.confirm(
            'Retry the exact accepted Provider action with the governed funding amendment? This may request a fresh quote and signer confirmation.',
        )) return;
        setRetryingFundingAmendment(true);
        setFundingAmendmentRetryError(false);
        void retryGovernanceFundingAmendedExecution({
            requestId,
            confirmation: 'retry_same_intent_with_accepted_funding_amendment',
        }).then(loadCase)
            .catch(() => setFundingAmendmentRetryError(true))
            .finally(() => setRetryingFundingAmendment(false));
    }, [governanceCase?.primaryRequest?.id, loadCase, retryingFundingAmendment]);

    useEffect(() => {
        let active = true;
        activeCaseIdRef.current = caseId;
        caseReadVersionRef.current += 1;
        setLoading(true);
        setGovernanceCase(null);
        Promise.all([
            fetchGovernanceCase(caseId),
            fetchSessionMe().catch(() => ({ authenticated: false as const })),
        ])
            .then(([value, session]) => {
                if (!active) return;
                setGovernanceCase(value);
                setViewerPubkey(session.authenticated && session.user ? session.user.pubkey : null);
            })
            .catch(() => { if (active) setGovernanceCase(null); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [caseId]);

    useEffect(() => {
        const key = governanceCase?.nextRequiredAction?.primaryAction ?? null;
        if (composeScenarioKeyRef.current === key) return;
        composeScenarioKeyRef.current = key;
        setComposeCollapsed(false);
    }, [caseId, governanceCase?.nextRequiredAction?.primaryAction]);

    useEffect(() => {
        if (!governanceCase) return;
        return startGovernanceCaseForegroundRefetch({
            policy: governanceCase.realtimePolicy,
            getVisibilityState: () => document.visibilityState,
            load: loadCase,
        });
    }, [
        governanceCase?.realtimePolicy.mode,
        governanceCase?.realtimePolicy.refreshAfterMs,
        governanceCase?.realtimePolicy.terminal,
        loadCase,
    ]);

    useEffect(() => {
        const syncResumeFragment = () => {
            setReadResumeFragment(governanceCaseResumeFragment(window.location.hash.slice(1)));
        };
        syncResumeFragment();
        window.addEventListener('hashchange', syncResumeFragment);
        return () => window.removeEventListener('hashchange', syncResumeFragment);
    }, [caseId]);

    useEffect(() => {
        const readState = governanceCase?.readState;
        if (!readState || readResumeFragment === undefined) return;
        const marker = `${readState.currentActivityCursor}|${readResumeFragment ?? ''}`;
        if (readCursorMarked.current === marker) return;
        readCursorMarked.current = marker;
        void updateGovernanceCaseReadCursor({
            caseId,
            activityCursor: readState.currentActivityCursor,
            resumeFragment: readResumeFragment,
            visitId: readCursorVisitId.current,
            expectedVersion: readState.version,
        }).then((result) => {
            setGovernanceCase((current) => current ? { ...current, readState: result.readState } : current);
        }).catch(() => {
            readCursorMarked.current = null;
        });
    }, [caseId, governanceCase?.readState, readResumeFragment]);

    const submitCaseSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const query = caseSearchQuery.normalize('NFKC').trim();
        if (query.length < 2 || query.length > 256 || caseSearchLoading) return;
        setCaseSearchLoading(true);
        setCaseSearchError(false);
        void fetchGovernanceCaseSearch(caseId, query)
            .then(setCaseSearchResult)
            .catch(() => {
                setCaseSearchResult(null);
                setCaseSearchError(true);
            })
            .finally(() => setCaseSearchLoading(false));
    };

    if (loading || (governanceCase && governanceCase.id !== caseId)) {
        return <main className={styles.state}><RefreshCw size={20} className={styles.spin} />{t('loading')}</main>;
    }
    if (!governanceCase) {
        return <main className={styles.state} role="alert">{t('notFound')}</main>;
    }
    const circleHome = governanceCase.governanceHome?.type === 'circle'
        ? Number(governanceCase.governanceHome.ref)
        : null;
    const authorityHealthReadback = governanceCase.authorityHealthReadback;
    const migrationReturnUrl = authorityHealthReadback
        && Number.isSafeInteger(circleHome)
        && Number(circleHome) === authorityHealthReadback.targetCircleId
        ? `/circles/${authorityHealthReadback.targetCircleId}?tab=governance&governanceMigration=read#governance-migration-recovery`
        : null;
    const fromMyGovernance = searchParams.get('from') === 'my-governance';
    const inboxPageValue = Number(searchParams.get('page'));
    const inboxPage = Number.isInteger(inboxPageValue) && inboxPageValue > 0 && inboxPageValue <= 10
        ? inboxPageValue
        : 1;
    const inboxParams = new URLSearchParams();
    for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
        const value = searchParams.get(key)?.trim();
        if (value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) {
            inboxParams.set(key, value);
        }
    }
    if (inboxPage > 1) inboxParams.set('page', String(inboxPage));
    const requestedActionPayload = governanceCase.requestedAction?.payload ?? null;
    const requestedMandateTerms = requestedActionPayload?.mandateTerms
        && typeof requestedActionPayload.mandateTerms === 'object'
        && !Array.isArray(requestedActionPayload.mandateTerms)
        ? requestedActionPayload.mandateTerms as Record<string, unknown>
        : null;
    const requestedMandateVersion = Number(requestedActionPayload?.mandateVersion);
    const supersededMandateVersion = Number(requestedActionPayload?.supersedesMandateVersion);
    const isMandateSupersedeAction = governanceCase.governedSubject.type === 'circle_governance_binding'
        && requestedMandateTerms !== null
        && Number.isSafeInteger(requestedMandateVersion)
        && Number.isSafeInteger(supersededMandateVersion)
        && requestedMandateVersion > supersededMandateVersion
        && typeof requestedActionPayload?.mandateTermsDigest === 'string';
    const requestedBindingScope = requestedActionPayload?.bindingScope
        && typeof requestedActionPayload.bindingScope === 'object'
        && !Array.isArray(requestedActionPayload.bindingScope)
        ? requestedActionPayload.bindingScope as Record<string, unknown>
        : null;
    const configurationTransitionPlan = requestedActionPayload?.configurationTransitionPlan
        && typeof requestedActionPayload.configurationTransitionPlan === 'object'
        && !Array.isArray(requestedActionPayload.configurationTransitionPlan)
        ? requestedActionPayload.configurationTransitionPlan as Record<string, unknown>
        : null;
    const isConfigurationTransition = configurationTransitionPlan?.kind === 'governance_configuration_transition';
    const configurationTransitionReadback = governanceCase.configurationTransitionReadback;
    const configurationTransitionAuditRecord = governanceCase.configurationTransitionAuditRecord;
    const transitionFromBundle = isConfigurationTransition
        && configurationTransitionPlan?.fromBundle
        && typeof configurationTransitionPlan.fromBundle === 'object'
        && !Array.isArray(configurationTransitionPlan.fromBundle)
        ? configurationTransitionPlan.fromBundle as Record<string, unknown>
        : null;
    const transitionToBundle = isConfigurationTransition
        && configurationTransitionPlan?.toBundle
        && typeof configurationTransitionPlan.toBundle === 'object'
        && !Array.isArray(configurationTransitionPlan.toBundle)
        ? configurationTransitionPlan.toBundle as Record<string, unknown>
        : null;
    const transitionReadiness = isConfigurationTransition
        && configurationTransitionPlan?.targetReadiness
        && typeof configurationTransitionPlan.targetReadiness === 'object'
        && !Array.isArray(configurationTransitionPlan.targetReadiness)
        ? configurationTransitionPlan.targetReadiness as Record<string, unknown>
        : null;
    const transitionBlockers = Array.isArray(transitionReadiness?.blockers)
        ? transitionReadiness.blockers.map(String)
        : [];
    const transitionRequiredChecks = Array.isArray(transitionReadiness?.requiredChecks)
        ? transitionReadiness.requiredChecks.map(String)
        : [];
    const transitionExternalSigner = transitionReadiness?.externalSigner
        && typeof transitionReadiness.externalSigner === 'object'
        && !Array.isArray(transitionReadiness.externalSigner)
        ? transitionReadiness.externalSigner as Record<string, unknown>
        : null;
    const transitionDiffs = Array.isArray(configurationTransitionPlan?.structuredDiff)
        ? configurationTransitionPlan.structuredDiff.flatMap((value) => (
            value && typeof value === 'object' && !Array.isArray(value)
                ? [value as Record<string, unknown>]
                : []
        ))
        : [];
    const transitionAudience = isConfigurationTransition
        && configurationTransitionPlan?.audience
        && typeof configurationTransitionPlan.audience === 'object'
        && !Array.isArray(configurationTransitionPlan.audience)
        ? configurationTransitionPlan.audience as Record<string, unknown>
        : null;
    const transitionImpact = isConfigurationTransition
        && configurationTransitionPlan?.memberImpact
        && typeof configurationTransitionPlan.memberImpact === 'object'
        && !Array.isArray(configurationTransitionPlan.memberImpact)
        ? configurationTransitionPlan.memberImpact as Record<string, unknown>
        : null;
    const transitionResourceImpact = isConfigurationTransition
        && configurationTransitionPlan?.resourceImpact
        && typeof configurationTransitionPlan.resourceImpact === 'object'
        && !Array.isArray(configurationTransitionPlan.resourceImpact)
        ? configurationTransitionPlan.resourceImpact as Record<string, unknown>
        : null;
    const transitionTaskImpact = isConfigurationTransition
        && configurationTransitionPlan?.taskImpact
        && typeof configurationTransitionPlan.taskImpact === 'object'
        && !Array.isArray(configurationTransitionPlan.taskImpact)
        ? configurationTransitionPlan.taskImpact as Record<string, unknown>
        : null;
    const transitionExitWindow = isConfigurationTransition
        && configurationTransitionPlan?.exitWindow
        && typeof configurationTransitionPlan.exitWindow === 'object'
        && !Array.isArray(configurationTransitionPlan.exitWindow)
        ? configurationTransitionPlan.exitWindow as Record<string, unknown>
        : null;
    const transitionNotificationPlan = isConfigurationTransition
        && configurationTransitionPlan?.notificationPlan
        && typeof configurationTransitionPlan.notificationPlan === 'object'
        && !Array.isArray(configurationTransitionPlan.notificationPlan)
        ? configurationTransitionPlan.notificationPlan as Record<string, unknown>
        : null;
    const transitionContinuity = isConfigurationTransition
        && configurationTransitionPlan?.institutionalContinuity
        && typeof configurationTransitionPlan.institutionalContinuity === 'object'
        && !Array.isArray(configurationTransitionPlan.institutionalContinuity)
        ? configurationTransitionPlan.institutionalContinuity as Record<string, unknown>
        : null;
    const transitionContinuityHome = transitionContinuity?.homeIdentity
        && typeof transitionContinuity.homeIdentity === 'object'
        && !Array.isArray(transitionContinuity.homeIdentity)
        ? transitionContinuity.homeIdentity as Record<string, unknown>
        : null;
    const transitionContinuityProfile = transitionContinuity?.profile
        && typeof transitionContinuity.profile === 'object'
        && !Array.isArray(transitionContinuity.profile)
        ? transitionContinuity.profile as Record<string, unknown>
        : null;
    const transitionCompatibilityMatrix = transitionContinuityProfile?.compatibilityMatrix
        && typeof transitionContinuityProfile.compatibilityMatrix === 'object'
        && !Array.isArray(transitionContinuityProfile.compatibilityMatrix)
        ? transitionContinuityProfile.compatibilityMatrix as Record<string, unknown>
        : null;
    const transitionContinuityMandates = transitionContinuity?.mandates
        && typeof transitionContinuity.mandates === 'object'
        && !Array.isArray(transitionContinuity.mandates)
        ? transitionContinuity.mandates as Record<string, unknown>
        : null;
    const transitionMandateSnapshot = Array.isArray(transitionContinuityMandates?.snapshot)
        ? transitionContinuityMandates.snapshot.flatMap((value) => (
            value && typeof value === 'object' && !Array.isArray(value)
                ? [value as Record<string, unknown>]
                : []
        ))
        : [];
    const transitionRetroactivity = transitionContinuity?.retroactivity
        && typeof transitionContinuity.retroactivity === 'object'
        && !Array.isArray(transitionContinuity.retroactivity)
        ? transitionContinuity.retroactivity as Record<string, unknown>
        : null;
    const isMandateDeactivationAction = governanceCase.governedSubject.type === 'circle_governance_binding'
        && requestedActionPayload?.bindingId === governanceCase.governedSubject.ref
        && requestedBindingScope !== null
        && typeof requestedActionPayload?.bindingControlDigest === 'string'
        && /^[a-f0-9]{64}$/.test(requestedActionPayload.bindingControlDigest);
    const inboxHref = `/governance${inboxParams.size > 0 ? `?${inboxParams.toString()}` : ''}`;
    const institutionalResponsibility = governanceCase.template?.institutionalResponsibility ?? null;
    const mandateResponsibility = institutionalResponsibility?.mandate ?? null;
    const frozenAuthorityStages = governanceCase.decisionAuthorityStages.integrity === 'verified'
        ? governanceCase.decisionAuthorityStages.stages
        : [];
    const frozenDecisionStages = new Map(
        governanceCase.decisionStages?.integrity === 'verified'
            ? governanceCase.decisionStages.stages.map((stage) => [stage.stageRef, stage] as const)
            : [],
    );
    const executionResponsibility = governanceCase.workflow.responsibilities.find(
        (item) => item.kind === 'execution',
    ) ?? null;
    const executionAuthorityHeader = governanceCase.executionAuthorityHeader;
    const caseAuthorityMatrix = governanceCase.caseAuthorityMatrix;
    const executionIsNotApplicable = governanceCase.template?.executionProvider === 'not_applicable'
        || (
            governanceCase.decisionOutputArtifacts.length > 0
            && governanceCase.decisionOutputArtifacts.every((artifact) => artifact.executionCapability === 'no_op')
        );
    const exportAudience = governanceCase.readerAudience === 'public'
        || governanceCase.readerAudience === 'operator'
        ? governanceCase.readerAudience
        : null;
    const nextRequiredAction = governanceCase.nextRequiredAction;
    const nextActionLabel = nextRequiredAction?.primaryAction
        ? nextRequiredAction.primaryAction === 'submit_execution_evidence'
            || nextRequiredAction.primaryAction === 'review_execution_evidence'
            ? manualExecutionT(`action.${nextRequiredAction.primaryAction}`)
            : inboxT(`action.${nextRequiredAction.primaryAction}`)
        : null;
    const nextActionReason = nextRequiredAction?.disabledReason
        ? nextRequiredAction.disabledReason === 'manual_execution_approved'
            || nextRequiredAction.disabledReason === 'manual_execution_review_required'
            || nextRequiredAction.disabledReason === 'manual_execution_submission_required'
            ? manualExecutionT(`reason.${nextRequiredAction.disabledReason}`)
            : inboxT(`reason.${nextRequiredAction.disabledReason}`)
        : null;
    const composeScenario = resolveCaseScenarioCompose(nextRequiredAction);
    const composeActive = composeScenario.mode !== 'none'
        && composeScenario.status != null
        && composeScenario.status !== 'completed';
    const composeReviewPortalActive = composeScenario.mode === 'interactive'
        && composeScenario.scenarioKey === 'review_brief'
        && composeScenario.status === 'available'
        && !composeCollapsed;
    // Waiting/blocked: no Action Dock — rail status/body already explains; avoid fake CTAs.
    const composeWaiting = composeScenario.status === 'waiting'
        || composeScenario.status === 'blocked';
    const composeShowDock = composeActive
        && !composeCollapsed
        && (
            composeReviewPortalActive
            || (composeScenario.mode === 'scroll-only' && composeScenario.status === 'available')
        );
    const composePrimaryAction = composeReviewPortalActive
        ? null
        : composeScenario.mode === 'scroll-only' && composeScenario.status === 'available'
            ? {
                label: nextActionLabel ?? t('focus.scrollToWork'),
                onClick: () => scrollToComposeTarget(
                    composeScenario.slotId ?? composeScenario.apiAnchor,
                ),
                disabled: false,
            }
            : null;
    const composeRailTitle = composeWaiting
        ? t('focus.waitingTitle')
        : (nextActionLabel ?? nextActionReason ?? t('focus.unavailable'));
    const composeLookTarget = composeScenario.slotId ?? composeScenario.apiAnchor;

    return (
        <main className={`${styles.page}${composeShowDock ? ` ${styles.composeDockPad}` : ''}`}>
            <div className={styles.topChrome} data-case-top-chrome="">
                {fromMyGovernance ? (
                    <Link href={inboxHref} className={styles.back}>
                        <ArrowLeft size={16} />{inboxT('title')}
                    </Link>
                ) : circleHome ? (
                    <Link href={`/circles/${circleHome}?tab=governance`} className={styles.back}>
                        <ArrowLeft size={16} />{t('backToCircle')}
                    </Link>
                ) : null}
                {composeActive && composeScenario.scenarioKey && composeScenario.status ? (
                    <ScenarioComposeSurface
                        scenarioKey={composeScenario.scenarioKey}
                        title={composeRailTitle}
                        body={nextActionReason ?? undefined}
                        status={composeScenario.status}
                        collapsed={composeCollapsed}
                        onCollapsedChange={setComposeCollapsed}
                        primaryAction={composePrimaryAction}
                        showDock={composeShowDock}
                        dockSlotRef={setComposeDockElement}
                        eyebrow={t('focus.workTitle')}
                        collapseLabel={t('compose.collapse')}
                        expandLabel={t('compose.expand')}
                        detailLabel={t('compose.detail')}
                        statusLabel={nextRequiredAction
                            ? `${inboxT(`status.${nextRequiredAction.status}`)}${
                                nextRequiredAction.category
                                    ? ` · ${inboxT(`category.${nextRequiredAction.category}`)}`
                                    : ''
                            }`
                            : undefined}
                        detail={
                            composeLookTarget
                            && (
                                composeScenario.status === 'available'
                                || composeWaiting
                            )
                                ? (
                                    <p>
                                        <button
                                            type="button"
                                            className={styles.railTextAction}
                                            onClick={() => scrollToComposeTarget(composeLookTarget)}
                                        >
                                            {composeWaiting
                                                ? (
                                                    nextRequiredAction?.disabledReason
                                                        === 'outcome_reviewer_unassigned'
                                                        ? t('focus.goAssign')
                                                        : t('focus.viewWhoActs')
                                                )
                                                : t('focus.scrollToWork')}
                                        </button>
                                    </p>
                                )
                                : undefined
                        }
                    />
                ) : null}
            </div>
            <header id="case-proposal" className={styles.header}>
                <Landmark size={26} />
                <div>
                    <p>{t('detailTitle')}</p>
                    <h1>{governanceCase.title}</h1>
                    <code>{governanceCase.id}</code>
                </div>
                <div className={styles.actions}>
                    <span>{t(`phase.${governanceCase.phase}`)}</span>
                    <button type="button" onClick={() => {
                        const canonicalUrl = new URL(governanceCase.canonicalUrl, window.location.origin).toString();
                        void navigator.clipboard.writeText(canonicalUrl).then(() => {
                            setCopied('link');
                            window.setTimeout(() => setCopied(null), 1800);
                        }).catch(() => setCopied(null));
                    }}>
                        {copied === 'link' ? <Check size={15} /> : <Copy size={15} />}
                        {copied === 'link'
                            ? t('copied')
                            : governanceCase.publiclyReadable ? t('copyPublicLink') : t('copyRestrictedLink')}
                    </button>
                    {governanceCase.publiclyReadable ? (
                        <button type="button" onClick={() => {
                            const canonicalUrl = new URL(governanceCase.canonicalUrl, window.location.origin).toString();
                            const summary = buildGovernanceCaseMarkdownSummary({
                                id: governanceCase.id,
                                title: governanceCase.title,
                                requestedDecision: governanceCase.requestedDecision,
                                phase: governanceCase.phase,
                                decisionStatus: governanceCase.primaryRequest?.decisionStatus ?? null,
                                executionStatus: governanceCase.primaryRequest?.executionStatus ?? null,
                                publicUrl: canonicalUrl,
                                publiclyReadable: true,
                            });
                            if (!summary) return;
                            void navigator.clipboard.writeText(summary).then(() => {
                                setCopied('markdown');
                                window.setTimeout(() => setCopied(null), 1800);
                            }).catch(() => setCopied(null));
                        }}>
                            {copied === 'markdown' ? <Check size={15} /> : <FileText size={15} />}
                            {copied === 'markdown' ? t('markdownCopied') : t('copyMarkdown')}
                        </button>
                    ) : null}
                    {exportAudience ? (
                        <button type="button" disabled={exporting} onClick={() => {
                            setExporting(true);
                            void exportGovernanceCaseAudience({
                                caseId: governanceCase.id,
                                audience: exportAudience,
                                purpose: 'Canonical Case audience export',
                                idempotencyKey: `case-export:${crypto.randomUUID()}`,
                            }).then((value) => {
                                const blob = new Blob([JSON.stringify(value, null, 2)], {
                                    type: 'application/json',
                                });
                                const url = URL.createObjectURL(blob);
                                const anchor = document.createElement('a');
                                anchor.href = url;
                                anchor.download = `${governanceCase.id.replace(/[^a-zA-Z0-9._-]+/g, '_')}-${value.audience}.json`;
                                anchor.click();
                                URL.revokeObjectURL(url);
                            }).finally(() => setExporting(false));
                        }}>
                            <Download size={15} />{t('evidenceShare.export')}
                        </button>
                    ) : null}
                </div>
            </header>
            {!composeActive || !composeScenario.scenarioKey || !composeScenario.status ? (
                <section
                    className={styles.focusCard}
                    aria-labelledby="case-focus-title"
                    aria-live="polite"
                    aria-atomic="true"
                    data-case-current-task="unavailable"
                >
                    <p>{t('focus.workTitle')}</p>
                    <h2 id="case-focus-title">{t('focus.unavailable')}</h2>
                </section>
            ) : null}
            <div id="case-focus-work" className={styles.focusWork}>
            <GovernanceCaseBriefPanel
                governanceCase={governanceCase}
                viewerPubkey={viewerPubkey}
                onRefresh={loadCase}
            />
            <GovernanceCaseWorkflowPanel
                governanceCase={governanceCase}
                viewerPubkey={viewerPubkey}
                onRefresh={loadCase}
                composeReviewActive={composeReviewPortalActive}
                composeDockElement={composeDockElement}
            />
            <GovernanceCaseEvidenceSharePanel governanceCase={governanceCase} />
            </div>
            <details className={styles.metaDetails} data-case-meta="search">
                <summary>{t('detailMeta.search')}</summary>
            <section className={styles.caseSearch} aria-labelledby="governance-case-search-title">
                <div className={styles.caseSearchHeading}>
                    <div>
                        <p>{t('caseSearch.eyebrow')}</p>
                        <h2 id="governance-case-search-title">{t('caseSearch.title')}</h2>
                        <span>{t('caseSearch.boundary')}</span>
                    </div>
                    {caseSearchResult ? (
                        <strong>{t('caseSearch.count', { count: caseSearchResult.total })}</strong>
                    ) : null}
                </div>
                <form onSubmit={submitCaseSearch}>
                    <Search size={17} aria-hidden="true" />
                    <input
                        type="search"
                        value={caseSearchQuery}
                        onChange={(event) => setCaseSearchQuery(event.target.value)}
                        minLength={2}
                        maxLength={256}
                        placeholder={t('caseSearch.placeholder')}
                        aria-label={t('caseSearch.query')}
                    />
                    <button type="submit" disabled={caseSearchLoading || caseSearchQuery.trim().length < 2}>
                        {caseSearchLoading ? t('caseSearch.searching') : t('caseSearch.submit')}
                    </button>
                </form>
                {caseSearchError ? <p role="alert">{t('caseSearch.error')}</p> : null}
                {caseSearchResult ? (
                    <div className={styles.caseSearchReadback} data-testid="governance-case-search-readback">
                        <ul className={styles.caseSearchScopes} aria-label={t('caseSearch.scopes')}>
                            {caseSearchResult.scopeCounts.map((scope) => (
                                <li key={scope.scope} data-search-scope={scope.scope}>
                                    {t(`caseSearch.scope.${scope.scope}`)} <span>{scope.count}</span>
                                </li>
                            ))}
                        </ul>
                        {caseSearchResult.results.length > 0 ? (
                            <ol className={styles.caseSearchResults}>
                                {caseSearchResult.results.map((result) => (
                                    <li key={`${result.scope}:${result.id}`}>
                                        <a href={result.canonicalUrl}>
                                            <span>{t(`caseSearch.scope.${result.scope}`)}</span>
                                            <strong>{result.title}</strong>
                                            {result.excerpt ? <small>{result.excerpt}</small> : null}
                                        </a>
                                    </li>
                                ))}
                            </ol>
                        ) : <p>{t('caseSearch.empty')}</p>}
                    </div>
                ) : null}
            </section>
            </details>
            {governanceCase.attentionPreference ? (
                <details className={styles.metaDetails} data-case-meta="attention" open={false}>
                <summary>{t('detailMeta.attention')}</summary>
                <section
                    className={styles.attention}
                    aria-labelledby="governance-case-attention-title"
                    data-case-attention-preference={governanceCase.attentionPreference.level}
                >
                    <div>
                        <h2 id="governance-case-attention-title">{t('attention.title')}</h2>
                        <p>{t('attention.body')}</p>
                        <small>{t('attention.requiredBoundary')}</small>
                    </div>
                    <div className={styles.attentionOptions} role="group" aria-label={t('attention.aria')}>
                        {(['watch', 'track', 'mute'] as const).map((level) => (
                            <button
                                key={level}
                                type="button"
                                aria-pressed={governanceCase.attentionPreference?.level === level}
                                disabled={attentionSaving}
                                onClick={() => changeAttention(level)}
                            >
                                {t(`attention.level.${level}`)}
                            </button>
                        ))}
                    </div>
                    {attentionSaving ? <span>{t('attention.saving')}</span> : null}
                    {attentionError ? <span role="alert">{t('attention.error')}</span> : null}
                </section>
                </details>
            ) : null}
            <details className={styles.metaDetails} data-case-meta="authority">
                <summary>{t('detailMeta.authority')}</summary>
            <section className={styles.authorityHeader} aria-labelledby="governance-case-authority-title">
                <div className={styles.authorityHeading}>
                    <p>{t('authorityHeader.eyebrow')}</p>
                    <h2 id="governance-case-authority-title">{t('authorityHeader.title')}</h2>
                    <span>{t('authorityHeader.boundary')}</span>
                </div>
                <div className={styles.authorityGrid}>
                    <article data-governance-authority-readback="action-authority-snapshot">
                        <h3>{t('authorityHeader.homeSubject')}</h3>
                        <dl>
                            <div>
                                <dt>{t('home')}</dt>
                                <dd>{governanceCase.governanceHome
                                    ? `${governanceCase.governanceHome.type}:${governanceCase.governanceHome.ref}`
                                    : t('authorityHeader.unavailable')}</dd>
                            </div>
                            <div>
                                <dt>{t('subject')}</dt>
                                <dd>{governanceCase.governedSubject.type}:{governanceCase.governedSubject.ref}</dd>
                            </div>
                            <div>
                                <dt>{t('authorityHeader.mandate')}</dt>
                                <dd>{mandateResponsibility
                                    ? t('authorityHeader.mandateValue', {
                                        mandateId: mandateResponsibility.id,
                                        version: mandateResponsibility.version,
                                        purpose: governanceCase.template?.actionAuthority?.purpose
                                            ?? 'collective_decision',
                                    })
                                    : t('authorityHeader.noDelegatedMandate')}</dd>
                            </div>
                            {institutionalResponsibility ? (
                                <>
                                    <div>
                                        <dt>{t('authorityHeader.institutionalResponsibility')}</dt>
                                        <dd>{t('authorityHeader.institutionalResponsibilityValue', {
                                            type: institutionalResponsibility.decisionAuthority.type,
                                            ref: institutionalResponsibility.decisionAuthority.ref,
                                            version: institutionalResponsibility.decisionAuthority.version,
                                        })}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('authorityHeader.institutionHomes')}</dt>
                                        <dd>{t('authorityHeader.homeResponsibilityValue', {
                                            caseHome: `${institutionalResponsibility.caseHome.type}:${institutionalResponsibility.caseHome.ref}`,
                                            decidingHome: `${institutionalResponsibility.decidingCircleHome.type}:${institutionalResponsibility.decidingCircleHome.ref}`,
                                        })}</dd>
                                    </div>
                                    {institutionalResponsibility.systemRole ? (
                                        <div>
                                            <dt>{t('authorityHeader.systemRole')}</dt>
                                            <dd>{t('authorityHeader.systemRoleValue', {
                                                domain: institutionalResponsibility.systemRole.domain,
                                                role: institutionalResponsibility.systemRole.roleKey,
                                                environment: institutionalResponsibility.systemRole.environment,
                                            })}</dd>
                                        </div>
                                    ) : null}
                                    <div>
                                        <dt>{t('authorityHeader.workflowAssignment')}</dt>
                                        <dd>{t('authorityHeader.workflowAssignmentNotAuthority')}</dd>
                                    </div>
                                </>
                            ) : null}
                            {governanceCase.template?.actionAuthority ? (
                                <>
                                    <div>
                                        <dt>{t('authorityHeader.institutionHomes')}</dt>
                                        <dd>{t('authorityHeader.institutionHomesValue', {
                                            target: `${governanceCase.template.actionAuthority.governanceHome.type}:${governanceCase.template.actionAuthority.governanceHome.ref}`,
                                            committee: `${governanceCase.template.actionAuthority.committeeHome.type}:${governanceCase.template.actionAuthority.committeeHome.ref}`,
                                        })}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('authorityHeader.actionScope')}</dt>
                                        <dd>{t('authorityHeader.actionScopeValue', {
                                            action: governanceCase.template.actionAuthority.action.type,
                                            subject: `${governanceCase.template.actionAuthority.subject.type}:${governanceCase.template.actionAuthority.subject.ref}`,
                                        })}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('authorityHeader.environmentNetwork')}</dt>
                                        <dd>{governanceCase.template.actionAuthority.environment} · {governanceCase.template.actionAuthority.network}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('authorityHeader.policyBinding')}</dt>
                                        <dd>{governanceCase.template.actionAuthority.authorityPolicyBinding.id}</dd>
                                        <dd>{governanceCase.template.actionAuthority.authorityPolicyBinding.bindingDigest}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('authorityHeader.operatorSelector')}</dt>
                                        <dd>{governanceCase.template.actionAuthority.operatorSelector.mode} · {t('authorityHeader.operatorNotApplicable')}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('authorityHeader.executionRequirement')}</dt>
                                        <dd>{t('authorityHeader.executionRequirementValue', {
                                            adapter: governanceCase.template.actionAuthority.executionAuthorityRequirement.adapter,
                                            owner: governanceCase.template.actionAuthority.executionAuthorityRequirement.runtimeOwner,
                                        })}</dd>
                                    </div>
                                </>
                            ) : null}
                        </dl>
                    </article>
                    <article>
                        <h3>{t('authorityHeader.decision')}</h3>
                        {frozenAuthorityStages.length > 0 ? (
                            <ul className={styles.authorityStages}>
                                {frozenAuthorityStages.map((stage) => {
                                    const decisionStage = frozenDecisionStages.get(stage.stageRef);
                                    const provider = decisionStage?.order === stage.order
                                        && decisionStage.purpose === stage.purpose
                                        ? decisionStage.provider
                                        : null;
                                    return <li key={stage.stageRef}>
                                        <strong>{t(`workflow.stages.purpose.${stage.purpose}`)}</strong>
                                        <span>{stage.decisionAuthority.authorityClass === 'workflow_stage'
                                            ? t('authorityHeader.workflowAssignment')
                                            : t('authorityHeader.institutionalResponsibility')}</span>
                                        <span>{stage.decisionAuthority.type}:{stage.decisionAuthority.ref}</span>
                                        <span>{t('authorityHeader.version')}: {stage.decisionAuthority.version}</span>
                                        {provider ? (
                                            <span>{t('authorityHeader.provider')}: {provider.type} · {provider.version}</span>
                                        ) : null}
                                    </li>;
                                })}
                            </ul>
                        ) : (
                            <p>{governanceCase.decisionAuthorityStages.integrity === 'invalid'
                                ? t('authorityHeader.stageIntegrityInvalid')
                                : t('authorityHeader.stageNotFrozen', {
                                    provider: governanceCase.template?.decisionProvider || t('authorityHeader.unavailable'),
                                })}</p>
                        )}
                    </article>
                    {caseAuthorityMatrix ? (
                        <article data-case-authority-matrix={caseAuthorityMatrix.integrity}>
                            <h3>{t('authorityHeader.caseAuthorityMatrix')}</h3>
                            <ul className={styles.authorityStages}>
                                {caseAuthorityMatrix.entries.map((entry, index) => (
                                    <li
                                        key={`${entry.phase}:${index}`}
                                        data-case-authority-phase={entry.phase}
                                        data-case-authority-binding={entry.binding}
                                    >
                                        <strong>{t(`authorityHeader.phase.${entry.phase}`)}</strong>
                                        <span>{entry.binding}</span>
                                        {entry.authority ? (
                                            <span>{entry.authority.type}:{entry.authority.ref} · {entry.authority.version}</span>
                                        ) : null}
                                        {entry.reconciledRule ? (
                                            <span>{entry.reconciledRule.owner} · {entry.reconciledRule.rule} · {entry.reconciledRule.reason}</span>
                                        ) : null}
                                        <span>{entry.source}</span>
                                    </li>
                                ))}
                            </ul>
                        </article>
                    ) : null}
                    <article>
                        <h3>{t('authorityHeader.execution')}</h3>
                        <p>{executionIsNotApplicable
                            ? t('authorityHeader.executionNotApplicable')
                            : t('authorityHeader.executionGateway', {
                                adapter: governanceCase.template?.actionContract?.executionAdapter
                                    || t('authorityHeader.unavailable'),
                            })}</p>
                        <p>{executionResponsibility?.status === 'accepted'
                            ? t('authorityHeader.executionTaskAssignee', {
                                assignee: executionResponsibility.assigneePubkey,
                            })
                            : t('authorityHeader.executionTaskUnassigned')}</p>
                        {executionAuthorityHeader ? (
                            <dl>
                                <div data-case-technical-provider={
                                    executionAuthorityHeader.technicalProvider?.module ?? 'unavailable'
                                }>
                                    <dt>{t('authorityHeader.technicalProvider')}</dt>
                                    <dd>{executionAuthorityHeader.technicalProvider
                                        ? [
                                            executionAuthorityHeader.technicalProvider.module,
                                            executionAuthorityHeader.technicalProvider.network,
                                            executionAuthorityHeader.technicalProvider.resourceRef,
                                            `slot ${executionAuthorityHeader.technicalProvider.observedSlot}`,
                                        ].join(' · ')
                                        : t('authorityHeader.technicalProviderUnavailable')}</dd>
                                </div>
                                <div>
                                    <dt>{t('authorityHeader.executionAuthorities')}</dt>
                                    <dd>
                                        {executionAuthorityHeader.executionAuthorities.length > 0 ? (
                                            <ul>
                                                {executionAuthorityHeader.executionAuthorities.map((authority) => (
                                                    <li
                                                        key={`${authority.role}:${authority.publicAuthority ?? authority.custodyProvider}`}
                                                        data-case-execution-authority={authority.source}
                                                    >
                                                        {[
                                                            authority.role,
                                                            authority.publicAuthority ?? t('authorityHeader.publicAuthorityUnavailable'),
                                                            authority.custodyProvider,
                                                            authority.allowedOperations.join(', '),
                                                            `slot ${authority.verifiedSlot}`,
                                                        ].join(' · ')}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : t('authorityHeader.executionAuthoritiesUnavailable')}
                                    </dd>
                                </div>
                                <div data-case-authoritative-execution-state={executionAuthorityHeader.state.providerStatus}>
                                    <dt>{t('authorityHeader.authoritativeState')}</dt>
                                    <dd>{[
                                        executionAuthorityHeader.state.decisionStatus,
                                        executionAuthorityHeader.state.executionStatus,
                                        executionAuthorityHeader.state.providerStatus,
                                        executionAuthorityHeader.state.integrity,
                                    ].join(' · ')}</dd>
                                </div>
                                {executionAuthorityHeader.state.receiptId ? (
                                    <div>
                                        <dt>{t('authorityHeader.providerReceipt')}</dt>
                                        <dd>{executionAuthorityHeader.state.receiptId}</dd>
                                    </div>
                                ) : null}
                                {executionAuthorityHeader.state.blocker ? (
                                    <div>
                                        <dt>{t('authorityHeader.providerBlocker')}</dt>
                                        <dd>{executionAuthorityHeader.state.blocker}</dd>
                                    </div>
                                ) : null}
                                <div>
                                    <dt>{t('authorityHeader.authoritySource')}</dt>
                                    <dd>{executionAuthorityHeader.technicalProvider?.source
                                        ?? t('authorityHeader.technicalProviderUnavailable')}</dd>
                                </div>
                            </dl>
                        ) : null}
                        {governanceCase.caseBlockers.map((blocker) => (
                            <div
                                key={blocker.id}
                                data-case-blocker={blocker.code}
                                data-case-blocker-status={blocker.status}
                                role="status"
                            >
                                <strong>{blocker.code}</strong>
                                <p>
                                    {blocker.status === 'resolved'
                                        ? 'funding amendment accepted · manual same-intent retry ready'
                                        : 'accepted decision preserved · execution paused'}
                                    {' · owner '}{blocker.owner}
                                    {' · resolution '}{blocker.resolutionRequirement}
                                </p>
                                <code>{blocker.evidenceReceiptId}</code>
                                <small>automatic retry: disabled</small>
                                {blocker.status === 'resolved'
                                && governanceCase.readerAudience === 'operator'
                                && governanceCase.primaryRequest ? (
                                    <button
                                        type="button"
                                        data-funding-amendment-manual-retry
                                        disabled={retryingFundingAmendment}
                                        onClick={retryFundingAmendedExecution}
                                    >
                                        {retryingFundingAmendment ? 'Retrying…' : 'Retry exact action with accepted amendment'}
                                    </button>
                                ) : null}
                                {blocker.status === 'resolved' && fundingAmendmentRetryError ? (
                                    <small role="alert">Retry was not started. Recheck authority and amendment state.</small>
                                ) : null}
                            </div>
                        ))}
                        <small>{t('authorityHeader.taskNotAuthority')}</small>
                        <small>{t('authorityHeader.executionAuthorityBoundary')}</small>
                    </article>
                    <article>
                        <h3>{t('authorityHeader.custody')}</h3>
                        <dl>
                            <div>
                                <dt>{t('authorityHeader.record')}</dt>
                                <dd>GovernanceCase:{governanceCase.id}</dd>
                            </div>
                            <div>
                                <dt>{t('authorityHeader.knowledge')}</dt>
                                <dd>{t('authorityHeader.knowledgeNotPublished')}</dd>
                            </div>
                        </dl>
                    </article>
                </div>
            </section>
            </details>
            <details className={styles.metaDetails} data-case-meta="visibility">
                <summary>{t('detailMeta.visibility')}</summary>
            <section className={styles.visibility} aria-labelledby="governance-case-visibility-title">
                <div className={styles.visibilityHeading}>
                    <p>{t('visibility.eyebrow')}</p>
                    <h2 id="governance-case-visibility-title">{t('visibility.title')}</h2>
                    <span>{t('visibility.boundary')}</span>
                </div>
                <ul>
                    {governanceCase.fieldVisibility.map((item) => (
                        <li key={item.fieldGroup}>
                            <strong>{t(`visibility.field.${item.fieldGroup}`)}</strong>
                            <span data-decision={item.decision}>{t(`visibility.decision.${item.decision}`)}</span>
                            <code>{item.reason}</code>
                        </li>
                    ))}
                </ul>
            </section>
            </details>
            <details className={styles.metaDetails} data-case-meta="archive">
                <summary>{t('focus.archiveSummary')}</summary>
            <section className={styles.decision}>
                <h2>{t('requestedDecision')}</h2>
                <p>{governanceCase.requestedDecision}</p>
            </section>
            <section className={styles.grid}>
                <article>
                    <h2>{t('home')}</h2>
                    <p>{governanceCase.governanceHome
                        ? `${governanceCase.governanceHome.type}:${governanceCase.governanceHome.ref}`
                        : '—'}</p>
                </article>
                <article>
                    <h2>{t('subject')}</h2>
                    <p>{governanceCase.governedSubject.type}:{governanceCase.governedSubject.ref}</p>
                </article>
                {authorityHealthReadback ? (
                    <article
                        data-authority-health-readback={authorityHealthReadback.highRiskPlanGate}
                        data-authority-health-source-request={authorityHealthReadback.sourceRequestId}
                    >
                        <h2>{t('authorityHealthReadback.title')}</h2>
                        <p>{t('authorityHealthReadback.currentState', {
                            status: authorityHealthReadback.status,
                            gate: authorityHealthReadback.highRiskPlanGate,
                        })}</p>
                        <p>{t('authorityHealthReadback.binding')}: <code>{authorityHealthReadback.bindingId}</code></p>
                        <p>{t('authorityHealthReadback.evidence')}: <code>{authorityHealthReadback.evidenceDigest}</code></p>
                        {authorityHealthReadback.faultAssessment ? (
                            <>
                                <p>{t('authorityHealthReadback.fault')}: {authorityHealthReadback.faultAssessment.faultClass}</p>
                                <p>{t('authorityHealthReadback.affectedActor')}: <code>{authorityHealthReadback.faultAssessment.affectedActorPubkey}</code></p>
                                <p>{t('authorityHealthReadback.evidenceRef')}: <code>{authorityHealthReadback.faultAssessment.evidenceRef}</code></p>
                                <p>{t('authorityHealthReadback.freezeEndsAt')}: {authorityHealthReadback.faultAssessment.emergencyFreeze.freezeEndsAt}</p>
                                <p>{t('authorityHealthReadback.reviewDueAt')}: {authorityHealthReadback.faultAssessment.emergencyFreeze.reviewDueAt}</p>
                            </>
                        ) : null}
                        {migrationReturnUrl ? (
                            <Link href={migrationReturnUrl}>
                                <ArrowLeft size={16} aria-hidden="true" />
                                {t('authorityHealthReadback.returnToMigration')}
                            </Link>
                        ) : null}
                    </article>
                ) : null}
                {isMandateSupersedeAction && requestedActionPayload ? (
                    <article data-governance-action-readback="mandate-supersede">
                        <h2>{t('requestedAction.title')}</h2>
                        <p>{t('requestedAction.versionTransition', {
                            from: String(requestedActionPayload.supersedesMandateVersion ?? '—'),
                            to: String(requestedActionPayload.mandateVersion ?? '—'),
                        })}</p>
                        <p>{String(requestedActionPayload.actionScope ?? '—')}</p>
                        <p>{String(requestedActionPayload.mandateTermsDigest ?? '—')}</p>
                        {requestedMandateTerms?.effectiveUntil ? (
                            <p>{t('requestedAction.effectiveUntil', {
                                value: String(requestedMandateTerms.effectiveUntil),
                            })}</p>
                        ) : null}
                    </article>
                ) : null}
                {isMandateDeactivationAction && requestedActionPayload ? (
                    <article data-governance-action-readback="mandate-deactivation">
                        <h2>{t('requestedAction.deactivationTitle')}</h2>
                        <p>{t('requestedAction.deactivationScope', {
                            value: String(
                                requestedBindingScope?.actionType
                                ?? requestedBindingScope?.actionPrefix
                                ?? '—',
                            ),
                        })}</p>
                        <p>{String(requestedActionPayload.bindingControlDigest)}</p>
                        <p>{t('requestedAction.deactivationEffect')}</p>
                        {requestedActionPayload.reason ? <p>{String(requestedActionPayload.reason)}</p> : null}
                    </article>
                ) : null}
                {isConfigurationTransition && configurationTransitionPlan ? (
                    <article data-governance-action-readback="configuration-transition">
                        <h2>{t('requestedAction.transitionTitle')}</h2>
                        <p>{t('requestedAction.transitionBundles', {
                            from: String(transitionFromBundle?.version ?? '—'),
                            to: String(transitionToBundle?.version ?? '—'),
                        })}</p>
                        <p>{String(transitionFromBundle?.digest ?? '—')}</p>
                        <p>{String(transitionToBundle?.digest ?? '—')}</p>
                        <p>{t('requestedAction.transitionChangeLevel', {
                            value: String(configurationTransitionPlan.changeLevel ?? '—'),
                        })}</p>
                        <p data-transition-readiness={String(transitionReadiness?.status ?? 'blocked')}>
                            {t('requestedAction.transitionReadiness', {
                                value: String(transitionReadiness?.status ?? 'blocked'),
                            })}
                        </p>
                        <p data-transition-required-checks={transitionRequiredChecks.join(',')}>
                            target checks · {transitionRequiredChecks.join(' · ') || 'unavailable'}
                        </p>
                        <p data-transition-external-signer-status={String(transitionExternalSigner?.status ?? 'blocked')}>
                            external signer · {String(transitionExternalSigner?.status ?? 'blocked')}
                        </p>
                        {configurationTransitionReadback ? (
                            <section
                                data-transition-cutover-status={configurationTransitionReadback.status}
                                data-transition-active-bundle={configurationTransitionReadback.activeBundle?.id ?? ''}
                            >
                                <strong>cutover · {configurationTransitionReadback.status}</strong>
                                <p>
                                    bundle v{configurationTransitionReadback.activeBundle?.version ?? '—'} ·{' '}
                                    <code>{configurationTransitionReadback.activeBundle?.digest ?? '—'}</code>
                                </p>
                                <p>
                                    policy v{configurationTransitionReadback.activePolicy?.version ?? '—'} ·{' '}
                                    <code>{configurationTransitionReadback.activePolicy?.versionId ?? '—'}</code>
                                </p>
                                <div
                                    data-transition-disposition-status={configurationTransitionReadback.disposition.status}
                                    data-transition-artifacts-immutable={configurationTransitionReadback.disposition.acceptedArtifacts.immutable}
                                    data-transition-effects-continuous={configurationTransitionReadback.disposition.existingOperationEffects.continueFrozenLifecycle}
                                    data-transition-new-invocations-target-only={configurationTransitionReadback.disposition.newInvocations.targetBundleOnly}
                                    data-transition-profile-pins-retained={configurationTransitionReadback.disposition.profilePins.retainedFrozenVersion}
                                >
                                    <strong>in-flight disposition · {configurationTransitionReadback.disposition.status}</strong>
                                    <p>
                                        accepted artifacts {configurationTransitionReadback.disposition.acceptedArtifacts.verified}
                                        /{configurationTransitionReadback.disposition.acceptedArtifacts.total} immutable
                                    </p>
                                    <p>
                                        existing effects {configurationTransitionReadback.disposition.existingOperationEffects.verified}
                                        /{configurationTransitionReadback.disposition.existingOperationEffects.total} continue frozen lifecycle
                                    </p>
                                    <p>
                                        new invocations {configurationTransitionReadback.disposition.newInvocations.targetPolicy}
                                        /{configurationTransitionReadback.disposition.newInvocations.total} target policy only
                                    </p>
                                    <p>
                                        frozen Profile pins {configurationTransitionReadback.disposition.profilePins.verified}
                                        /{configurationTransitionReadback.disposition.profilePins.total} retained
                                    </p>
                                    <p>appeal access remains bound to the original receipt policy</p>
                                </div>
                                <div
                                    data-transition-recovery-status={configurationTransitionReadback.recovery.status}
                                    data-transition-irreversible-boundary={configurationTransitionReadback.recovery.irreversibleBoundary}
                                    data-transition-one-click-rollback={configurationTransitionReadback.recovery.oneClickRollback}
                                >
                                    <strong>recovery · {configurationTransitionReadback.recovery.status}</strong>
                                    <p>
                                        verified source bundle v{configurationTransitionReadback.recovery.sourceBundle.version} ·{' '}
                                        <code>{configurationTransitionReadback.recovery.sourceBundle.digest}</code>
                                    </p>
                                    <p>irreversible boundary · {configurationTransitionReadback.recovery.irreversibleBoundary}</p>
                                    <p>one-click rollback · disabled</p>
                                    {configurationTransitionReadback.recovery.rollbackCaseId ? (
                                        <p>rollback Case · <code>{configurationTransitionReadback.recovery.rollbackCaseId}</code></p>
                                    ) : null}
                                    {governanceCase.readerAudience === 'operator'
                                        && viewerPubkey
                                        && circleHome
                                        && configurationTransitionReadback.recovery.canOpenGovernedRollback ? (
                                            <button
                                                type="button"
                                                className={styles.recoveryAction}
                                                data-open-governed-rollback
                                                disabled={openingRollback}
                                                onClick={() => {
                                                    setOpeningRollback(true);
                                                    setRollbackError(null);
                                                    void openGovernanceConfigurationRollback({
                                                        circleId: circleHome,
                                                        bindingId: configurationTransitionReadback.bindingId,
                                                        actorPubkey: viewerPubkey,
                                                        rollbackFromCaseId: governanceCase.id,
                                                    }).then((result) => {
                                                        router.push(result.case.canonicalUrl);
                                                    }).catch((error: unknown) => {
                                                        setRollbackError(error instanceof Error
                                                            ? error.message
                                                            : 'governance_configuration_rollback_failed');
                                                    }).finally(() => setOpeningRollback(false));
                                                }}
                                            >
                                                <RefreshCw size={15} className={openingRollback ? styles.spin : undefined} />
                                                {openingRollback ? 'Opening rollback Case…' : 'Open governed rollback Case'}
                                            </button>
                                        ) : null}
                                    {rollbackError ? <p role="alert">{rollbackError}</p> : null}
                                </div>
                                <div
                                    data-deadlock-recovery-status={configurationTransitionReadback.deadlockRecovery.status}
                                    data-deadlock-recovery-fail-closed={configurationTransitionReadback.deadlockRecovery.failClosed}
                                    data-governance-authority-continuity-status={configurationTransitionReadback.deadlockRecovery.authorityContinuity.status}
                                >
                                    <strong>deadlock recovery · {configurationTransitionReadback.deadlockRecovery.status}</strong>
                                    <p>{configurationTransitionReadback.deadlockRecovery.warning}</p>
                                    <p>
                                        Recovery Circle · {configurationTransitionReadback.deadlockRecovery.recoveryCircleId ?? 'not configured'}
                                        {' · '}frozen actors {configurationTransitionReadback.deadlockRecovery.frozenActorCount}
                                        {' · '}unanimity required
                                    </p>
                                    <p>single use · 1 hour · zero cost · no asset authority</p>
                                    <p>target-electorate ratification · 24 hours</p>
                                    <p>
                                        governance authority · {configurationTransitionReadback.deadlockRecovery.authorityContinuity.status}
                                        {' · '}fallback none
                                        {' · '}evidence {configurationTransitionReadback.deadlockRecovery.authorityContinuity.evidenceIntegrity}
                                    </p>
                                    <p>{configurationTransitionReadback.deadlockRecovery.authorityContinuity.warning}</p>
                                    <p>
                                        external signer authority · {configurationTransitionReadback.deadlockRecovery.authorityContinuity.externalAuthorityStatus}
                                    </p>
                                    {configurationTransitionReadback.deadlockRecovery.ratificationCaseId ? (
                                        <p>
                                            ratification Case ·{' '}
                                            <a href={`/governance/cases/${encodeURIComponent(configurationTransitionReadback.deadlockRecovery.ratificationCaseId)}`}>
                                                {configurationTransitionReadback.deadlockRecovery.ratificationCaseId}
                                            </a>
                                        </p>
                                    ) : null}
                                </div>
                            </section>
                        ) : null}
                        <p>{t('requestedAction.transitionRights', {
                            gained: Array.isArray(transitionImpact?.gainedVoteActors)
                                ? transitionImpact.gainedVoteActors.length
                                : 0,
                            lost: Array.isArray(transitionImpact?.lostVoteActors)
                                ? transitionImpact.lostVoteActors.length
                                : 0,
                        })}</p>
                        <section
                            id="configuration-transition-impact"
                            data-transition-impact-digest={String(transitionNotificationPlan?.impactDigest ?? '')}
                            data-transition-notification-recipients={String(transitionNotificationPlan?.recipientCount ?? 0)}
                        >
                            <h3>Frozen transition impact</h3>
                            <p>
                                proposal rights · +{Array.isArray(transitionImpact?.gainedProposalActors) ? transitionImpact.gainedProposalActors.length : 0}
                                {' / -'}{Array.isArray(transitionImpact?.lostProposalActors) ? transitionImpact.lostProposalActors.length : 0}
                                {' · '}vote rights · +{Array.isArray(transitionImpact?.gainedVoteActors) ? transitionImpact.gainedVoteActors.length : 0}
                                {' / -'}{Array.isArray(transitionImpact?.lostVoteActors) ? transitionImpact.lostVoteActors.length : 0}
                                {' · '}operator rights · +{Array.isArray(transitionImpact?.gainedOperatorActors) ? transitionImpact.gainedOperatorActors.length : 0}
                                {' / -'}{Array.isArray(transitionImpact?.lostOperatorActors) ? transitionImpact.lostOperatorActors.length : 0}
                            </p>
                            <p>
                                payer · {String(transitionImpact?.payerChange ?? 'unknown')}
                                {' · '}visibility · {String(transitionImpact?.visibilityChange ?? 'unknown')}
                                {' · '}signer · {String((transitionImpact?.signerImpact as Record<string, unknown> | undefined)?.status ?? 'unknown')}
                            </p>
                            <p data-transition-resource-impact={String(transitionResourceImpact?.status ?? 'unknown')}>
                                resources · {String(transitionResourceImpact?.status ?? 'unknown')}
                                {' · '}affected {String(transitionResourceImpact?.affectedResourceCount ?? 0)}
                            </p>
                            <p data-transition-pending-task-count={String(transitionTaskImpact?.pendingTaskCount ?? 0)}>
                                pending tasks · {String(transitionTaskImpact?.pendingTaskCount ?? 0)}
                                {' · '}{String(transitionTaskImpact?.disposition ?? 'unknown')}
                                {' · '}digest <code>{String(transitionTaskImpact?.taskSnapshotDigest ?? '—')}</code>
                            </p>
                            <p data-transition-exit-window={String(transitionExitWindow?.status ?? 'unknown')}>
                                exit window · {String(transitionExitWindow?.status ?? 'unknown')}
                                {transitionExitWindow?.deadline ? ` · ${String(transitionExitWindow.deadline)}` : ''}
                            </p>
                            <p>
                                notifications · {String(transitionNotificationPlan?.recipientCount ?? 0)} recipients
                                {' · '}digest <code>{String(transitionNotificationPlan?.impactDigest ?? '—')}</code>
                            </p>
                        </section>
                        <section
                            data-transition-home-disposition={String(transitionContinuityHome?.disposition ?? 'unavailable')}
                            data-transition-profile-version={String(transitionContinuityProfile?.versionRef ?? '')}
                            data-transition-retroactivity={String(transitionRetroactivity?.mode ?? 'unavailable')}
                        >
                            <h3>Institutional continuity</h3>
                            <p>
                                Governance Home · {String(transitionContinuityHome?.disposition ?? 'unavailable')}
                                {' · '}Profile {String(transitionContinuityProfile?.versionRef ?? 'unavailable')}
                                {' · '}{String(transitionContinuityProfile?.disposition ?? 'unavailable')}
                            </p>
                            <p data-transition-compatibility-matrix>
                                capability · {String((transitionCompatibilityMatrix?.capability as Record<string, unknown> | undefined)?.status ?? 'unavailable')}
                                {' · '}schema · {String((transitionCompatibilityMatrix?.schema as Record<string, unknown> | undefined)?.status ?? 'unavailable')}
                                {' · '}provider · {String((transitionCompatibilityMatrix?.provider as Record<string, unknown> | undefined)?.status ?? 'unavailable')}
                                {' · '}UI metadata · {String((transitionCompatibilityMatrix?.uiMetadata as Record<string, unknown> | undefined)?.status ?? 'unavailable')}
                            </p>
                            <ul data-transition-mandate-dispositions={transitionMandateSnapshot.length}>
                                {transitionMandateSnapshot.map((mandate) => (
                                    <li key={String(mandate.id)}>
                                        <code>{String(mandate.id)}</code>
                                        {' · '}{String(mandate.status)} → {String(mandate.disposition)}
                                        {' · '}appeal {String(mandate.appealAccess)}
                                    </li>
                                ))}
                            </ul>
                            <p>
                                retroactivity · {String(transitionRetroactivity?.mode ?? 'unavailable')}
                                {' · '}existing content unchanged
                                {' · '}member sanctions and governance eligibility are not retroactive
                            </p>
                            <p>Historical review requires a new Invocation and Receipt; the original record remains immutable.</p>
                        </section>
                        <p>{t('requestedAction.transitionAudience', {
                            authorized: String(transitionAudience?.plan ?? '—'),
                            public: String(transitionAudience?.publicSummary ?? '—'),
                        })}</p>
                        {transitionDiffs.length > 0 ? (
                            <section data-transition-structured-diff>
                                <h3>{t('requestedAction.transitionDiff')}</h3>
                                <ul>{transitionDiffs.map((diff) => {
                                    const from = diff.from && typeof diff.from === 'object' && !Array.isArray(diff.from)
                                        ? diff.from as Record<string, unknown>
                                        : null;
                                    const to = diff.to && typeof diff.to === 'object' && !Array.isArray(diff.to)
                                        ? diff.to as Record<string, unknown>
                                        : null;
                                    return (
                                        <li key={String(diff.path)}>
                                            <strong>{String(diff.path)}</strong>
                                            {' · '}{String(from?.ref ?? '—')} → {String(to?.ref ?? '—')}
                                            {' · '}{String(from?.digest ?? '—')} → {String(to?.digest ?? '—')}
                                        </li>
                                    );
                                })}</ul>
                            </section>
                        ) : null}
                        {transitionBlockers.length > 0 ? (
                            <ul>{transitionBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                        ) : null}
                        <code>{String(configurationTransitionPlan.planDigest ?? '—')}</code>
                    </article>
                ) : null}
                {configurationTransitionAuditRecord ? (
                    <article
                        data-transition-audit-visibility={configurationTransitionAuditRecord.visibility}
                        data-transition-audit-status={configurationTransitionAuditRecord.status}
                        data-transition-audit-record-digest={configurationTransitionAuditRecord.recordDigest}
                    >
                        <h2>Permanent transition record</h2>
                        <p>
                            {configurationTransitionAuditRecord.visibility}
                            {' · '}{configurationTransitionAuditRecord.status}
                            {' · '}historical Case recalculation disabled
                        </p>
                        {configurationTransitionAuditRecord.fromBundle ? (
                            <p>
                                bundle v{configurationTransitionAuditRecord.fromBundle.version}
                                {' → '}v{configurationTransitionAuditRecord.toBundle?.version ?? '—'}
                                {' · '}diff <code>{configurationTransitionAuditRecord.structuredDiffDigest ?? '—'}</code>
                            </p>
                        ) : (
                            <p>
                                bundle digests · {configurationTransitionAuditRecord.fromBundleDigest ?? 'restricted'}
                                {' → '}{configurationTransitionAuditRecord.toBundleDigest ?? 'restricted'}
                            </p>
                        )}
                        {configurationTransitionAuditRecord.handoffReceipts ? (
                            <p data-transition-handoff-receipts={configurationTransitionAuditRecord.handoffReceipts.length}>
                                handoff receipts · {configurationTransitionAuditRecord.handoffReceipts.length}
                            </p>
                        ) : null}
                        <code>{configurationTransitionAuditRecord.recordDigest}</code>
                    </article>
                ) : null}
                <article>
                    <h2>{t('template.detail')}</h2>
                    {governanceCase.template ? (
                        <>
                            <p>{t(`template.name.${governanceCase.template.templateId}`)}</p>
                            <p>{governanceCase.template.readinessState} · {governanceCase.template.profile?.versionRef}</p>
                            {governanceCase.template.actionContract ? (
                                <p>{governanceCase.template.actionContract.actionType}</p>
                            ) : null}
                        </>
                    ) : <p>{t('template.legacy')}</p>}
                </article>
                <article>
                    <h2>{governanceCase.primaryRequest ? t('request') : t('originLabel')}</h2>
                    {governanceCase.primaryRequest ? (
                        <>
                            <p>{governanceCase.primaryRequest.id}</p>
                            <GovernanceDecisionExecutionStatus
                                decisionStatus={governanceCase.primaryRequest.decisionStatus}
                                executionStatus={governanceCase.primaryRequest.executionStatus}
                                decisionText={t('status.decision', {
                                    status: governanceCase.primaryRequest.decisionStatus,
                                })}
                                executionText={t('status.execution', {
                                    status: governanceCase.primaryRequest.executionStatus,
                                })}
                            />
                            {governanceCase.primaryRequest.providerExecutionStatus ? (
                                <div
                                    role={governanceCase.primaryRequest.providerExecutionStatus.status === 'executed'
                                        ? 'status'
                                        : 'alert'}
                                    data-public-provider-execution-status={governanceCase.primaryRequest.providerExecutionStatus.status}
                                    data-public-provider-execution-integrity={governanceCase.primaryRequest.providerExecutionStatus.integrity}
                                    data-governance-decision-preserved={governanceCase.primaryRequest.providerExecutionStatus.acceptedDecisionPreserved}
                                >
                                    <p>
                                        {t(`workflow.providerExecution.state.${governanceCase.primaryRequest.providerExecutionStatus.status}`)}
                                        {' · '}{t(`workflow.providerExecution.integrityState.${governanceCase.primaryRequest.providerExecutionStatus.integrity}`)}
                                    </p>
                                    {governanceCase.primaryRequest.providerExecutionStatus.recovery ? (
                                        <GovernanceExecutionRecoveryStatus
                                            recovery={{
                                                blocker: governanceCase.primaryRequest.providerExecutionStatus.blocker,
                                                ...governanceCase.primaryRequest.providerExecutionStatus.recovery,
                                            }}
                                            boundaryText={t('recovery.boundary')}
                                            blockerText={governanceCase.primaryRequest.providerExecutionStatus.blocker
                                                ? t('recovery.blocker', {
                                                    value: governanceCase.primaryRequest.providerExecutionStatus.blocker,
                                                })
                                                : null}
                                        />
                                    ) : governanceCase.primaryRequest.providerExecutionStatus.blocker ? (
                                        <p>{t('recovery.blocker', {
                                            value: governanceCase.primaryRequest.providerExecutionStatus.blocker,
                                        })}</p>
                                    ) : null}
                                    {governanceCase.primaryRequest.providerExecutionStatus.incident ? (
                                        <GovernanceProviderIncidentStatus
                                            incident={{
                                                id: governanceCase.primaryRequest.providerExecutionStatus.incident.incidentId,
                                                state: governanceCase.primaryRequest.providerExecutionStatus.incident.lifecycleState,
                                                evidenceDigest: governanceCase.primaryRequest.providerExecutionStatus.incident.eventDigest,
                                                occurredAt: governanceCase.primaryRequest.providerExecutionStatus.incident.occurredAt,
                                                pendingExecution: governanceCase.primaryRequest.providerExecutionStatus.incident.pendingExecution,
                                                originalDecisionAndReceipt: governanceCase.primaryRequest.providerExecutionStatus.incident.originalDecisionAndReceipt,
                                            }}
                                        />
                                    ) : null}
                                    {governanceCase.primaryRequest.providerExecution?.reconciliation?.reconciliationFallback ? (
                                        <p
                                            data-provider-reconciliation-fallback={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.sourceState}
                                            data-provider-fallback-mode={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.mode}
                                            data-provider-questioned-self-adjudication={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.questionedProviderMayAdjudicate}
                                            data-provider-operator-selects-fallback={governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.operatorMaySelectProvider}
                                        >
                                            reconciliation fallback · {governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.sourceState}
                                            {' · '}{governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.fallbackMechanism.activation}
                                            {' · superseding required '}{String(governanceCase.primaryRequest.providerExecution.reconciliation.reconciliationFallback.superseding.required)}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.preExecutionCost?.automaticExecutionAvailability ? (
                                <div
                                    role="status"
                                    data-provider-automatic-execution-availability={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.state}
                                    data-provider-readiness-state={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.readinessState}
                                    data-provider-risk-maturity={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.riskMaturity}
                                    data-provider-stage-open-gate={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.openStage}
                                    data-provider-execute-gate={governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.execute}
                                >
                                    <p>
                                        provider readiness {governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.readinessState}
                                        {' · risk '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.riskMaturity}
                                    </p>
                                    <p>
                                        stage {governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.openStage}
                                        {' · execute '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.execute}
                                        {' · risk confirmation '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.stageGate.riskConfirmation}
                                        {' · blockers '}{governanceCase.primaryRequest.preExecutionCost.automaticExecutionAvailability.blockers.join(', ') || 'none'}
                                    </p>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecution?.provider?.providerResourceLifecycle ? (
                                <div
                                    role="status"
                                    data-provider-resource-lifecycle={governanceCase.primaryRequest.providerExecution.provider.providerResourceLifecycle.state}
                                    data-provider-resource-lifecycle-phases={governanceCase.primaryRequest.providerExecution.provider.providerResourceLifecycle.phases.map((phase) => phase.phase).join('>')}
                                >
                                    <p>
                                        resource lifecycle · {governanceCase.primaryRequest.providerExecution.provider.providerResourceLifecycle.resourceBindingId}
                                    </p>
                                    <p>
                                        {governanceCase.primaryRequest.providerExecution.provider.providerResourceLifecycle.phases.map((phase) => phase.phase).join(' → ')}
                                        {' · fallback authority '}
                                        {governanceCase.primaryRequest.providerExecution.provider.providerResourceLifecycle.permissionResidue.fallbackAuthority}
                                        {' · temp wallet '}
                                        {governanceCase.primaryRequest.providerExecution.provider.providerResourceLifecycle.permissionResidue.temporaryWalletAuthority}
                                    </p>
                                </div>
                            ) : null}
                            {governanceCase.primaryRequest.providerExecutionReference ? (
                                <div data-provider-execution-reference={governanceCase.primaryRequest.providerExecutionReference.ref}>
                                    <code>{governanceCase.primaryRequest.providerExecutionReference.ref}</code>
                                    <p>
                                        {governanceCase.primaryRequest.providerExecutionReference.provider}
                                        {' · '}{governanceCase.primaryRequest.providerExecutionReference.network}
                                        {' · '}{governanceCase.primaryRequest.providerExecutionReference.resourceRef}
                                        {' · '}{governanceCase.primaryRequest.providerExecutionReference.finality}
                                    </p>
                                    <code>{governanceCase.primaryRequest.providerExecutionReference.receiptEvidenceDigest}</code>
                                    <span
                                        data-public-provider-residual-bypass-risk={governanceCase.primaryRequest.providerExecutionReference.residualBypassRisk.risk}
                                    >
                                        enforcement {governanceCase.primaryRequest.providerExecutionReference.residualBypassRisk.enforcementMode}
                                        {' · external authority bypass risk '}{governanceCase.primaryRequest.providerExecutionReference.residualBypassRisk.risk}
                                        {' · bypass prevented: no'}
                                    </span>
                                    <div
                                        data-public-provider-native-receipt="finalized"
                                        data-public-provider-transaction-count={governanceCase.primaryRequest.providerExecutionReference.providerNative.transactionCount}
                                    >
                                        <p>
                                            owner program {governanceCase.primaryRequest.providerExecutionReference.providerNative.ownerProgramRef}
                                            {' · proposal '}{governanceCase.primaryRequest.providerExecutionReference.providerNative.proposalRef ?? 'not applicable'}
                                            {' · proposal transaction '}{governanceCase.primaryRequest.providerExecutionReference.providerNative.proposalTransactionRef ?? 'not applicable'}
                                        </p>
                                        <ol>
                                            {governanceCase.primaryRequest.providerExecutionReference.providerNative.transactions.map((transaction) => (
                                                <li key={`${transaction.stepId}:${transaction.signature}`}>
                                                    {transaction.stepId}
                                                    {' · signature '}{transaction.signature}
                                                    {' · slot '}{transaction.slot}
                                                    {' · '}{transaction.commitment}
                                                </li>
                                            ))}
                                        </ol>
                                        <p>raw transaction exposed: no · signer key ref exposed: no</p>
                                    </div>
                                    <dl data-public-provider-business-state="independent_provider_readback">
                                        {Object.entries(governanceCase.primaryRequest.providerExecutionReference.businessState).map(([key, value]) => (
                                            <div key={key}>
                                                <dt>{key}</dt>
                                                <dd>{value}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                    {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt ? (
                                    <div
                                        data-provider-execution-authorization-receipt={governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.receiptRole}
                                        data-provider-truth-authority={governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.providerTruth.authority}
                                        data-db-receipt-is-provider-truth={governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.providerTruth.dbReceiptIsProviderTruth}
                                    >
                                        <strong>ExecutionAuthorizationReceipt design input</strong>
                                        <p>
                                            request {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.requestId}
                                            {' · decision '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.normalizedDecision.decision}
                                            {' · authorization '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.authorizationStatus}
                                        </p>
                                        <p>
                                            provider truth {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.providerTruth.providerNativeEvidenceDigest}
                                            {' · DB receipt is provider truth: no'}
                                        </p>
                                        <p>
                                            issuer trust {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.issuerTrust.issuerRef}
                                            {' · JWS '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.issuerTrust.jwsIngestion}
                                            {' · revocation '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.issuerTrust.revocationIngestion}
                                        </p>
                                        <p>
                                            target {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.operationPayloadTarget.targetResourceRef}
                                            {' · owner '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.operationPayloadTarget.ownerProgramRef}
                                            {' · live slot '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.operationPayloadTarget.liveState.observedSlot}
                                        </p>
                                        <p>
                                            consumed {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.oneTimeConsumption.preflightId}
                                            {' · '}{governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.oneTimeConsumption.atomicConsumption}
                                        </p>
                                        <ol>
                                            {governanceCase.primaryRequest.providerExecutionReference.executionAuthorizationReceipt.operationPayloadTarget.operations.map((operation) => (
                                                <li key={operation}>{operation}</li>
                                            ))}
                                        </ol>
                                    </div>
                                    ) : null}
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <>
                            <p>{t(`origin.${governanceCase.originKind}`)}</p>
                            {governanceCase.origin.sourceUrl ? (
                                <a href={governanceCase.origin.sourceUrl} target="_blank" rel="noreferrer">{governanceCase.origin.sourceUrl}</a>
                            ) : null}
                            {governanceCase.origin.snapshot ? (
                                <section data-testid="governance-case-origin-snapshot">
                                    <h3>{t('originSnapshot.title')}</h3>
                                    <p>{t('originSnapshot.summary', {
                                        count: governanceCase.origin.snapshot.sources.length,
                                        circleType: governanceCase.origin.snapshot.visibility.circleType,
                                    })}</p>
                                    <code>{governanceCase.origin.snapshot.sourceSetDigest}</code>
                                    <ul>
                                        {governanceCase.origin.snapshot.sources.map((source) => (
                                            <li key={source.ref}>
                                                <code>{source.ref}</code>
                                                <span>{t('originSnapshot.source', {
                                                    author: source.authorPubkey,
                                                    version: source.lamport,
                                                })}</span>
                                                <code>{source.payloadDigest}</code>
                                            </li>
                                        ))}
                                    </ul>
                                    <p>{t('originSnapshot.boundary')}</p>
                                </section>
                            ) : governanceCase.originKind === 'plaza_selection' ? (
                                <p role="status" data-origin-integrity={governanceCase.origin.snapshotIntegrity}>
                                    {t(`originSnapshot.integrity.${governanceCase.origin.snapshotIntegrity}`)}
                                </p>
                            ) : null}
                        </>
                    )}
                </article>
                {governanceCase.relationship ? (
                    <article>
                        <h2>{t('lineage.title')}</h2>
                        <p>{t(`lineage.kind.${governanceCase.relationship.kind}`)}</p>
                        {governanceCase.relationship.reason ? (
                            <p>{governanceCase.relationship.reason}</p>
                        ) : null}
                        <p>{t('lineage.recordedBy', {
                            home: `${governanceCase.relationship.recordedBy.homeType}:${governanceCase.relationship.recordedBy.homeRef}`,
                        })}</p>
                        {governanceCase.relationship.recordedAt ? (
                            <time dateTime={governanceCase.relationship.recordedAt}>
                                {t('lineage.recordedAt', {
                                    time: new Date(governanceCase.relationship.recordedAt).toLocaleString(),
                                })}
                            </time>
                        ) : null}
                        <code>{governanceCase.relationship.caseId}</code>
                        <p>
                            <Link href={governanceCase.relationship.canonicalUrl}>
                                {t('lineage.openPredecessor')}
                            </Link>
                        </p>
                    </article>
                ) : null}
                {governanceCase.corrections.length > 0 ? (
                    <article>
                        <h2>{t('lineage.correctionsTitle')}</h2>
                        {governanceCase.corrections.map((correction) => (
                            <div key={correction.caseId}>
                                <p>{correction.reason}</p>
                                <p>{t('lineage.recordedBy', {
                                    home: `${correction.recordedBy.homeType}:${correction.recordedBy.homeRef}`,
                                })}</p>
                                {correction.recordedAt ? (
                                    <time dateTime={correction.recordedAt}>
                                        {t('lineage.recordedAt', {
                                            time: new Date(correction.recordedAt).toLocaleString(),
                                        })}
                                    </time>
                                ) : null}
                                <p><Link href={correction.canonicalUrl}>{t('lineage.openCorrection')}</Link></p>
                            </div>
                        ))}
                    </article>
                ) : null}
            </section>
            </details>
        </main>
    );
}
