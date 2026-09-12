'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleDot, Plus, RefreshCw, Search, X } from 'lucide-react';

import {
    createGovernanceCaseIntake,
    CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS,
    fetchCircleGovernanceBindings,
    fetchCircleGovernanceCases,
    fetchProviderAdmissionCandidates,
    preflightGovernanceCaseIntake,
    STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
    type GovernanceCase,
    type GovernanceCasePhase,
    type GovernanceCaseIntakeSuggestion,
    type GovernanceCaseType,
    type GovernanceCaseIntakeOriginKind,
    type CircleGovernanceBinding,
    type CircleGovernanceSearchFilterKey,
    type CircleGovernanceSearchFilters,
    type CircleGovernanceSearchResponse,
    type PublicSafeProviderAdmissionCandidate,
} from '@/lib/api/governance';
import { authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import { Select } from '@/components/ui/Select';
import { useI18n } from '@/i18n/useI18n';

const EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE = 'external_app_primary_circle_bind';
const EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION_TYPE = 'external_app_primary_circle_change';
const EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION_TYPE = 'external_app_attached_circle_bind';
const EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION_TYPE = 'external_app_attached_circle_revoke';
const EXTERNAL_APP_CIRCLE_BINDING_ACTION_TYPES = new Set([
    EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
    EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION_TYPE,
    EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION_TYPE,
    EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION_TYPE,
]);

type CircleBindingOwnerAction =
    | typeof EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE
    | typeof EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION_TYPE
    | typeof EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION_TYPE
    | typeof EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION_TYPE;

type CircleBindingOwnerApplication = {
    applicationRef: string;
    actionType: CircleBindingOwnerAction;
    externalAppId: string;
    displayName: string;
    rationaleDigest: string;
    applicationEpoch: number;
    requestedAt: string | null;
    environment: string | null;
    bindingKind: 'primary' | 'attached';
};
import GovernanceCaseTemplatePicker, {
    type GovernanceCaseTemplateDraft,
} from './GovernanceCaseTemplatePicker';
import GovernanceDecisionExecutionStatus from './GovernanceDecisionExecutionStatus';
import styles from './GovernanceCasesTab.module.css';

type CaseGroup = 'intake' | 'review' | 'voting' | 'execution' | 'outcome' | 'completed';

const CASE_GROUPS: Array<{ id: CaseGroup; phases: GovernanceCasePhase[] }> = [
    { id: 'intake', phases: ['intake', 'proposal_drafting'] },
    { id: 'review', phases: ['evidence_review', 'ready_for_decision'] },
    { id: 'voting', phases: ['decision_in_progress'] },
    { id: 'execution', phases: ['execution_preparation', 'execution_in_progress'] },
    { id: 'outcome', phases: ['outcome_review'] },
    { id: 'completed', phases: ['closed', 'archived'] },
];

export default function GovernanceCasesTab({
    circleId,
    canCreate = false,
}: {
    circleId: number;
    canCreate?: boolean;
}) {
    const t = useI18n('GovernanceCases');
    const [cases, setCases] = useState<GovernanceCase[]>([]);
    const [targetBindings, setTargetBindings] = useState<CircleGovernanceBinding[]>([]);
    const [committeeBindings, setCommitteeBindings] = useState<CircleGovernanceBinding[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [showIntake, setShowIntake] = useState(false);
    const [intakeStep, setIntakeStep] = useState<1 | 2>(1);
    const [submitting, setSubmitting] = useState(false);
    const [intakeError, setIntakeError] = useState<string | null>(null);
    const [intakeConflictCaseId, setIntakeConflictCaseId] = useState<string | null>(null);
    const [originKind, setOriginKind] = useState<GovernanceCaseIntakeOriginKind>('manual_item');
    const [caseType, setCaseType] = useState<GovernanceCaseType>('signal');
    const [templateDraft, setTemplateDraft] = useState<GovernanceCaseTemplateDraft | null>(null);
    const [title, setTitle] = useState('');
    const [requestedDecision, setRequestedDecision] = useState('');
    const [sourceUrl, setSourceUrl] = useState('');
    const [idempotencyKey, setIdempotencyKey] = useState(createClientIdempotencyKey);
    const [suggestions, setSuggestions] = useState<GovernanceCaseIntakeSuggestion[]>([]);
    const [preflightAcknowledged, setPreflightAcknowledged] = useState(false);
    const [relationship, setRelationship] = useState<{
        kind: 'related' | 'supersedes';
        caseId: string;
    } | null>(null);
    const [relationshipReason, setRelationshipReason] = useState('');
    const [candidatePickerEnabled, setCandidatePickerEnabled] = useState(false);
    const [providerCandidates, setProviderCandidates] = useState<PublicSafeProviderAdmissionCandidate[]>([]);
    const [providerCandidatesNextCursor, setProviderCandidatesNextCursor] = useState<string | null>(null);
    const [selectedCandidateRef, setSelectedCandidateRef] = useState('');
    const [candidatesLoading, setCandidatesLoading] = useState(false);
    const [candidatesLoadingMore, setCandidatesLoadingMore] = useState(false);
    const [candidatesError, setCandidatesError] = useState<string | null>(null);
    const [candidatesPageError, setCandidatesPageError] = useState<string | null>(null);
    const [candidatesReloadVersion, setCandidatesReloadVersion] = useState(0);
    const [circleBindingApplications, setCircleBindingApplications] = useState<CircleBindingOwnerApplication[]>([]);
    const [selectedCircleBindingApplicationRef, setSelectedCircleBindingApplicationRef] = useState('');
    const [confirmOwnerCircleBindingApplication, setConfirmOwnerCircleBindingApplication] = useState(false);
    const [circleBindingApplicationsLoading, setCircleBindingApplicationsLoading] = useState(false);
    const [circleBindingApplicationsError, setCircleBindingApplicationsError] = useState<string | null>(null);
    const [circleBindingApplicationsReloadVersion, setCircleBindingApplicationsReloadVersion] = useState(0);
    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFilters, setSearchFilters] = useState<CircleGovernanceSearchFilters>({});
    const [searchResult, setSearchResult] = useState<CircleGovernanceSearchResponse | null>(null);
    const [searching, setSearching] = useState(false);
    const searchRequestVersion = useRef(0);
    const intakeFormRef = useRef<HTMLFormElement | null>(null);
    const isProviderAdmission = templateDraft?.actionType
        === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE;
    const circleBindingActionType = EXTERNAL_APP_CIRCLE_BINDING_ACTION_TYPES.has(
        String(templateDraft?.actionType),
    ) ? templateDraft?.actionType as CircleBindingOwnerAction : null;
    const isCircleBindingOwnerAction = circleBindingActionType !== null;
    const selectedCandidate = providerCandidates.find(
        (item) => item.candidateRef === selectedCandidateRef,
    ) ?? null;
    const actionSelectionReady = caseType !== 'policy'
        || !templateDraft?.actionUserReadiness
        || templateDraft.actionUserReadiness === 'ready_for_case'
        || templateDraft.actionNextStep === 'select_subject';
    const actionSelectionBlocked = caseType === 'policy'
        && Boolean(templateDraft?.actionType)
        && !actionSelectionReady;
    const actionSelectionBlockerId = 'governance-action-next-step-blocker';
    const providerAdmissionReady = !isProviderAdmission || (
        candidatePickerEnabled
        && selectedCandidate !== null
        && selectedCandidate.statusSummary === 'eligible'
        && !candidatesError
        && (
            !selectedCandidate.expiresAt
            || Date.parse(selectedCandidate.expiresAt) > Date.now()
        )
    );
    const selectedCircleBindingApplication = circleBindingApplications.find(
        (item) => item.applicationRef === selectedCircleBindingApplicationRef,
    ) ?? null;
    const circleBindingApplicationReady = !isCircleBindingOwnerAction
        || (
            selectedCircleBindingApplication !== null
            && selectedCircleBindingApplication.actionType === circleBindingActionType
            && confirmOwnerCircleBindingApplication
            && !circleBindingApplicationsError
        );

    useEffect(() => {
        if (!showIntake) return;
        setIntakeStep(1);
    }, [showIntake]);

    useEffect(() => {
        if (!circleBindingActionType) return;
        // Specialized Owner-application openers freeze origin, subject and intent.
        // Do not leave generic intake relationship/source state visible or actionable.
        setOriginKind('manual_item');
        setSourceUrl('');
        setSuggestions([]);
        setPreflightAcknowledged(false);
        setRelationship(null);
        setRelationshipReason('');
    }, [circleBindingActionType]);

    useEffect(() => {
        if (!showIntake || !isProviderAdmission || intakeStep !== 2) return;
        let active = true;
        setCandidatesLoading(true);
        setCandidatesError(null);
        setCandidatesPageError(null);
        fetchProviderAdmissionCandidates({ circleId, status: 'eligible' })
            .then((page) => {
                if (!active) return;
                setCandidatePickerEnabled(page.candidatePickerEnabled === true);
                setProviderCandidates(page.items);
                setProviderCandidatesNextCursor(page.nextCursor);
                setSelectedCandidateRef((current) => (
                    page.items.some((item) => item.candidateRef === current) ? current : ''
                ));
            })
            .catch((error: unknown) => {
                if (!active) return;
                setCandidatePickerEnabled(false);
                setCandidatesError(classifyProviderCandidatesError(error));
                setProviderCandidates([]);
                setProviderCandidatesNextCursor(null);
            })
            .finally(() => {
                if (active) setCandidatesLoading(false);
            });
        return () => { active = false; };
    }, [showIntake, isProviderAdmission, intakeStep, circleId, candidatesReloadVersion]);

    const retryProviderCandidates = useCallback(() => {
        if (candidatesLoading || candidatesLoadingMore) return;
        setCandidatesReloadVersion((current) => current + 1);
    }, [candidatesLoading, candidatesLoadingMore]);

    const loadMoreProviderCandidates = useCallback(async () => {
        if (!providerCandidatesNextCursor || candidatesLoading || candidatesLoadingMore) return;
        setCandidatesLoadingMore(true);
        setCandidatesPageError(null);
        try {
            const page = await fetchProviderAdmissionCandidates({
                circleId,
                status: 'eligible',
                cursor: providerCandidatesNextCursor,
            });
            setCandidatePickerEnabled(page.candidatePickerEnabled === true);
            setProviderCandidates((current) => {
                const byRef = new Map(current.map((item) => [item.candidateRef, item]));
                for (const item of page.items) byRef.set(item.candidateRef, item);
                return [...byRef.values()];
            });
            setProviderCandidatesNextCursor(page.nextCursor);
        } catch (error) {
            setCandidatesPageError(classifyProviderCandidatesError(error));
        } finally {
            setCandidatesLoadingMore(false);
        }
    }, [circleId, providerCandidatesNextCursor, candidatesLoading, candidatesLoadingMore]);

    useEffect(() => {
        if (!showIntake || !circleBindingActionType || intakeStep !== 2) return;
        let active = true;
        setCircleBindingApplicationsLoading(true);
        setCircleBindingApplicationsError(null);
        void (async () => {
            try {
                const route = await resolveNodeRoute('governance');
                const isPrimaryBind = circleBindingActionType
                    === EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE;
                const response = await authenticatedApiFetch(
                    `${route.urlBase}/api/v1/external-apps/${isPrimaryBind
                        ? 'primary-circle-bind/applications'
                        : 'circle-binding-owner-applications'}?circleId=${circleId}`,
                );
                if (!active) return;
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(String(body?.error || `circle_binding_applications_failed:${response.status}`));
                }
                const body = await response.json() as {
                    applications?: Array<Omit<CircleBindingOwnerApplication, 'actionType' | 'bindingKind'> & {
                        actionType?: CircleBindingOwnerAction;
                        bindingKind?: 'primary' | 'attached';
                    }>;
                };
                const applications = (Array.isArray(body.applications) ? body.applications : [])
                    .map((item): CircleBindingOwnerApplication => ({
                        ...item,
                        actionType: isPrimaryBind
                            ? EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE
                            : item.actionType as CircleBindingOwnerAction,
                        bindingKind: isPrimaryBind ? 'primary' : item.bindingKind as 'primary' | 'attached',
                    }))
                    .filter((item) => item.actionType === circleBindingActionType);
                setCircleBindingApplications(applications);
                setSelectedCircleBindingApplicationRef((current) => (
                    applications.some((item) => item.applicationRef === current) ? current : ''
                ));
                setConfirmOwnerCircleBindingApplication(false);
            } catch {
                if (!active) return;
                setCircleBindingApplications([]);
                setSelectedCircleBindingApplicationRef('');
                setConfirmOwnerCircleBindingApplication(false);
                setCircleBindingApplicationsError('unavailable');
            } finally {
                if (active) setCircleBindingApplicationsLoading(false);
            }
        })();
        return () => { active = false; };
    }, [
        showIntake,
        circleBindingActionType,
        intakeStep,
        circleId,
        circleBindingApplicationsReloadVersion,
    ]);

    const retryCircleBindingApplications = useCallback(() => {
        if (circleBindingApplicationsLoading) return;
        setCircleBindingApplicationsReloadVersion((current) => current + 1);
    }, [circleBindingApplicationsLoading]);

    useEffect(() => {
        if (!showIntake) return;
        const id = intakeStep === 2 ? 'governance-case-intake-form' : 'governance-templates';
        const frame = window.requestAnimationFrame(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [showIntake, intakeStep]);

    const loadCases = useCallback(async (
        q: string,
        filters: CircleGovernanceSearchFilters,
    ) => {
        const version = searchRequestVersion.current + 1;
        searchRequestVersion.current = version;
        setSearching(true);
        setError(false);
        try {
            const result = await fetchCircleGovernanceCases(circleId, { q, filters });
            if (searchRequestVersion.current !== version) return;
            setCases(result.cases);
            setSearchResult(result.search);
        } catch {
            if (searchRequestVersion.current === version) setError(true);
        } finally {
            if (searchRequestVersion.current === version) setSearching(false);
        }
    }, [circleId]);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(false);
        Promise.all([
            fetchCircleGovernanceCases(circleId),
            fetchCircleGovernanceBindings(circleId),
        ])
            .then(([caseResult, bindingResult]) => {
                if (!active) return;
                setCases(caseResult.cases);
                setSearchResult(caseResult.search);
                setTargetBindings(bindingResult.bindings);
                setCommitteeBindings(bindingResult.committeeBindings);
            })
            .catch(() => {
                if (active) setError(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [circleId]);

    const submitSearch = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const q = searchDraft.normalize('NFKC').trim();
        if (q.length === 1 || q.length > 256) return;
        setSearchQuery(q);
        void loadCases(q, searchFilters);
    };

    const selectSearchFilter = (key: CircleGovernanceSearchFilterKey, value: string) => {
        const next = { ...searchFilters };
        if (value) next[key] = value;
        else delete next[key];
        setSearchFilters(next);
        void loadCases(searchQuery, next);
    };

    const clearSearch = () => {
        setSearchDraft('');
        setSearchQuery('');
        setSearchFilters({});
        void loadCases('', {});
    };

    const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;
        if (
            !templateDraft
            || (caseType === 'policy' && !templateDraft.actionType)
            || (caseType === 'policy'
                && templateDraft.decisionMechanismKind === 'quadratic_voice_credits'
                && templateDraft.quadraticVoiceChoices.filter((choice) => choice.trim()).length < 2)
            || (caseType === 'policy'
                && templateDraft?.decisionMechanismKind === 'quadratic_funding'
                && (!templateDraft.quadraticFundingRound.roundRef.trim()
                    || templateDraft.quadraticFundingRound.projects.length < 2))
            || (caseType === 'policy'
                && templateDraft.selectionRanking
                && (templateDraft.selectionRanking.candidates.length < 2
                    || templateDraft.selectionRanking.seatCount < 1
                    || templateDraft.selectionRanking.seatCount > templateDraft.selectionRanking.candidates.length))
            || !providerAdmissionReady
            || !circleBindingApplicationReady
        ) return;
        setSubmitting(true);
        setIntakeError(null);
        setIntakeConflictCaseId(null);
        try {
            if (!preflightAcknowledged && !circleBindingActionType) {
                const matches = await preflightGovernanceCaseIntake({
                    circleId,
                    title,
                    originKind,
                    sourceUrl: originKind === 'manual_item' ? null : sourceUrl,
                });
                if (matches.length > 0) {
                    setSuggestions(matches);
                    return;
                }
            }
            if (circleBindingActionType) {
                if (!selectedCircleBindingApplication || !confirmOwnerCircleBindingApplication) {
                    throw new Error('circle_binding_owner_application_required');
                }
                if (selectedCircleBindingApplication.actionType !== circleBindingActionType) {
                    throw new Error('circle_binding_owner_application_action_mismatch');
                }
                const route = await resolveNodeRoute('governance');
                const isPrimaryBind = circleBindingActionType
                    === EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE;
                const response = await authenticatedApiFetch(
                    `${route.urlBase}/api/v1/external-apps/${encodeURIComponent(selectedCircleBindingApplication.externalAppId)}/${isPrimaryBind
                        ? 'primary-circle-bind/cases'
                        : 'circle-binding-owner-applications/cases'}`,
                    {
                        init: {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                circleId,
                                title,
                                ...(!isPrimaryBind ? { actionType: circleBindingActionType } : {}),
                                applicationRef: selectedCircleBindingApplication.applicationRef,
                                ownerRationaleDigest: selectedCircleBindingApplication.rationaleDigest,
                                confirmOwnerApplication: true,
                                templateId: templateDraft.templateId,
                            }),
                        },
                    },
                );
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(String(body?.error || `circle_binding_case_failed:${response.status}`));
                }
            } else {
                if (isProviderAdmission && (!candidatePickerEnabled || !selectedCandidate)) {
                    throw new Error('provider_admission_candidate_picker_disabled');
                }
                await createGovernanceCaseIntake({
                    circleId,
                    title,
                    requestedDecision,
                    caseType,
                    templateId: templateDraft.templateId,
                    actionType: templateDraft.actionType,
                    ...(isProviderAdmission && selectedCandidate ? {
                        candidateRef: selectedCandidate.candidateRef,
                        expectedSnapshotVersion: selectedCandidate.snapshotVersion,
                        expectedSnapshotDigest: selectedCandidate.snapshotDigest,
                        rationale: requestedDecision,
                    } : {}),
                    decisionMechanismKind: templateDraft.decisionMechanismKind,
                    quadraticVoiceChoices: templateDraft.decisionMechanismKind === 'quadratic_voice_credits'
                        ? templateDraft.quadraticVoiceChoices.map((choice) => choice.trim()).filter(Boolean)
                        : null,
                    quadraticFundingRound: templateDraft.decisionMechanismKind === 'quadratic_funding'
                        ? templateDraft.quadraticFundingRound
                        : null,
                    selectionRanking: templateDraft.selectionRanking,
                    originKind,
                    sourceUrl: originKind === 'manual_item' ? null : sourceUrl,
                    relationshipKind: relationship?.kind ?? null,
                    relatedCaseId: relationship?.caseId ?? null,
                    relationshipReason: relationship?.kind === 'supersedes'
                        ? relationshipReason.trim()
                        : null,
                    idempotencyKey,
                });
            }
            await loadCases(searchQuery, searchFilters);
            setShowIntake(false);
            setIntakeStep(1);
            setTitle('');
            setRequestedDecision('');
            setSourceUrl('');
            setOriginKind('manual_item');
            setCaseType('signal');
            setTemplateDraft(null);
            setCircleBindingApplications([]);
            setSelectedCircleBindingApplicationRef('');
            setConfirmOwnerCircleBindingApplication(false);
            setCircleBindingApplicationsError(null);
            setSelectedCandidateRef('');
            setProviderCandidates([]);
            setCandidatePickerEnabled(false);
            setCandidatesError(null);
            setCandidatesPageError(null);
            setSuggestions([]);
            setPreflightAcknowledged(false);
            setRelationship(null);
            setRelationshipReason('');
            setIdempotencyKey(createClientIdempotencyKey());
        } catch (error) {
            const raw = error && typeof error === 'object' && 'message' in error
                ? String((error as { message?: unknown }).message ?? '')
                : '';
            const code = extractGovernanceIntakeErrorCode(raw);
            const recurrenceConflict = code.match(
                /^external_governed_action_recurrence_conflict(?::(.+))?$/,
            );
            if (recurrenceConflict) {
                const existingCaseId = String(recurrenceConflict[1] || '').trim() || null;
                setIntakeConflictCaseId(existingCaseId);
                setIntakeError(t('create.recurrenceConflict'));
            } else {
                setIntakeConflictCaseId(null);
                const documentAuthorityMissing = templateDraft.actionType === 'circle.policy.document.adopt'
                    && ['governance_case_mandate_authority_required', 'governance_case_mandate_authority_unavailable',
                        'governed_action_contract_runtime_required', 'governed_action_authority_binding_required',
                        'governed_action_exact_binding_required']
                        .includes(code);
                const detail = documentAuthorityMissing
                    ? t('template.documentAdoptionAuthorityRequired')
                    : code && !raw.includes('fetch')
                    ? `${t('create.error')} (${code})`
                    : t('create.error');
                setIntakeError(detail);
            }
        } finally {
            setSubmitting(false);
        }
    };

    const resetPreflight = () => {
        setSuggestions([]);
        setPreflightAcknowledged(false);
        setRelationship(null);
        setRelationshipReason('');
    };

    const groupedCases = useMemo(() => CASE_GROUPS.map((group) => ({
        ...group,
        cases: cases.filter((governanceCase) => group.phases.includes(governanceCase.phase)),
    })), [cases]);
    const activeCaseCount = useMemo(
        () => cases.filter((governanceCase) => governanceCase.phase !== 'closed' && governanceCase.phase !== 'archived').length,
        [cases],
    );
    const pendingExecutionCount = useMemo(
        () => cases.filter((governanceCase) => (
            governanceCase.phase === 'execution_preparation'
            || governanceCase.phase === 'execution_in_progress'
        )).length,
        [cases],
    );
    const suspendedMandateCount = useMemo(
        () => [...targetBindings, ...committeeBindings].filter(
            (binding) => binding.mandate?.health?.status === 'suspended',
        ).length,
        [committeeBindings, targetBindings],
    );

    if (loading) {
        return <div className={styles.state}><RefreshCw size={18} className={styles.spin} />{t('loading')}</div>;
    }
    if (error) {
        return <div className={styles.state} role="alert">{t('loadError')}</div>;
    }
    return (
        <section className={styles.root} aria-labelledby="governance-cases-title">
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>{t('eyebrow')}</p>
                    <h2 id="governance-cases-title">{t('title')}</h2>
                </div>
                <div className={styles.headerActions}>
                    <Link href="/governance" className={styles.inboxLink}>{t('myGovernance')}</Link>
                    <span className={styles.count}>{t('count', { count: cases.length })}</span>
                    {canCreate && (
                        <button type="button" className={styles.createButton} onClick={() => setShowIntake((value) => {
                            const next = !value;
                            if (!next) setIntakeStep(1);
                            return next;
                        })}>
                            {showIntake ? <X size={16} /> : <Plus size={16} />}
                            {showIntake ? t('create.cancel') : t('create.open')}
                        </button>
                    )}
                </div>
            </header>

            {showIntake ? (
                <section className={styles.intakeWizard} aria-labelledby="governance-intake-wizard-title" data-intake-step={intakeStep}>
                    <div className={styles.focusBanner}>
                        <div>
                            <p className={styles.eyebrow}>{t('create.wizardEyebrow')}</p>
                            <h3 id="governance-intake-wizard-title">{t('create.wizardTitle')}</h3>
                            <span>{t('create.wizardStep', { step: intakeStep, total: 2 })}</span>
                        </div>
                        <ol className={styles.stepper} aria-label={t('create.wizardStepsAria')}>
                            <li data-active={intakeStep === 1 || undefined} data-done={intakeStep > 1 || undefined}>{t('create.stepTemplate')}</li>
                            <li data-active={intakeStep === 2 || undefined}>{t('create.stepDetails')}</li>
                        </ol>
                    </div>
                    {intakeStep === 1 ? (
                        <>
                            <TemplatesSection
                                caseType={caseType}
                                setCaseType={setCaseType}
                                templateDraft={templateDraft}
                                setTemplateDraft={setTemplateDraft}
                                circleId={circleId}
                                submitting={submitting}
                                t={t}
                            />
                            {actionSelectionBlocked && templateDraft?.actionUserReadiness ? (
                                <div
                                    id={actionSelectionBlockerId}
                                    className={styles.nextStepBlocker}
                                    role="status"
                                    data-testid="governance-next-step-blocker"
                                >
                                    <div className={styles.nextStepBlockerCopy}>
                                        <strong>{templateDraft.actionType === 'circle.policy.document.adopt'
                                            ? t('template.documentAdoptionNextBlockedTitle')
                                            : t(`template.readinessHint.${templateDraft.actionUserReadiness}`)}</strong>
                                        {templateDraft.actionType === 'circle.policy.document.adopt' ? (
                                            <span>{t('template.documentAdoptionNextBlocked')}</span>
                                        ) : null}
                                    </div>
                                    {templateDraft.actionNextStep === 'configure_governance_binding' ? (
                                        <Link
                                            href="?tab=governance&settings=governance"
                                            className={styles.nextStepBlockerAction}
                                            data-testid="governance-next-step-action"
                                        >
                                            {templateDraft.actionType === 'circle.policy.document.adopt'
                                                ? t('template.documentAdoptionNextAction')
                                                : t('template.readinessNextStep.configureBinding')}
                                            <ArrowRight size={16} aria-hidden="true" />
                                        </Link>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className={styles.wizardActions}>
                                <button
                                    type="button"
                                    className={styles.submitButton}
                                    aria-describedby={actionSelectionBlocked
                                        ? actionSelectionBlockerId
                                        : undefined}
                                    disabled={
                                        !templateDraft
                                        || (caseType === 'policy' && !templateDraft.actionType)
                                        || !actionSelectionReady
                                    }
                                    onClick={() => setIntakeStep(2)}
                                >
                                    {t('create.nextStep')}
                                </button>
                            </div>
                        </>
                    ) : (
                        <form
                            ref={intakeFormRef}
                            id="governance-case-intake-form"
                            className={styles.intakeForm}
                            data-testid="governance-case-intake-form"
                            onSubmit={(event) => void handleCreate(event)}
                        >
                            {!isCircleBindingOwnerAction ? (
                                <label>
                                    <span>{t('create.origin')}</span>
                                    <Select
                                        ariaLabel={t('create.origin')}
                                        value={originKind}
                                        onChange={(next) => {
                                            setOriginKind(next as GovernanceCaseIntakeOriginKind);
                                            resetPreflight();
                                        }}
                                        options={[
                                            { value: 'manual_item', label: t('origin.manual_item') },
                                            { value: 'public_url', label: t('origin.public_url') },
                                            { value: 'external_proposal', label: t('origin.external_proposal') },
                                        ]}
                                    />
                                </label>
                            ) : null}
                            <label>
                                <span>{t('create.title')}</span>
                                <input value={title} onChange={(event) => {
                                    setTitle(event.target.value);
                                    resetPreflight();
                                }} minLength={3} maxLength={160} required />
                            </label>
                            {!isCircleBindingOwnerAction ? (
                                <label className={styles.fullField}>
                                    <span>{t('create.requestedDecision')}</span>
                                    <textarea value={requestedDecision} onChange={(event) => setRequestedDecision(event.target.value)} minLength={10} maxLength={2000} required />
                                </label>
                            ) : null}
                            {isProviderAdmission ? (
                                <section className={styles.fullField} aria-labelledby="pa-intake-subject-title">
                                    <h3 id="pa-intake-subject-title">{t('create.providerAdmission.title')}</h3>
                                    <p>{t('create.providerAdmission.pickerBoundary')}</p>
                                    {candidatesLoading ? (
                                        <p role="status">{t('create.providerAdmission.candidatesLoading')}</p>
                                    ) : null}
                                    {candidatesError || !candidatePickerEnabled ? (
                                        <div role="alert">
                                            <p>{t(providerCandidatesErrorMessageKey(candidatesError))}</p>
                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                disabled={candidatesLoading || candidatesLoadingMore}
                                                onClick={retryProviderCandidates}
                                            >
                                                {t('create.providerAdmission.retryCandidates')}
                                            </button>
                                        </div>
                                    ) : null}
                                    {!candidatesLoading && !candidatesError && candidatePickerEnabled && providerCandidates.length === 0 ? (
                                        <p>{t('create.providerAdmission.candidatesEmpty')}</p>
                                    ) : null}
                                    <label>
                                        <span>{t('create.providerAdmission.providerSelect')}</span>
                                        <Select
                                            ariaLabel={t('create.providerAdmission.providerSelect')}
                                            value={selectedCandidateRef}
                                            onChange={(next) => setSelectedCandidateRef(next)}
                                            options={[
                                                { value: '', label: t('create.providerAdmission.providerSelectPlaceholder') },
                                                ...providerCandidates.map((candidate) => ({
                                                    value: candidate.candidateRef,
                                                    label: `${candidate.displayName} · ${candidate.statusSummary}`,
                                                })),
                                            ]}
                                            disabled={candidatesLoading || !candidatePickerEnabled || providerCandidates.length === 0}
                                        />
                                    </label>
                                    {providerCandidatesNextCursor && candidatePickerEnabled ? (
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            disabled={candidatesLoadingMore}
                                            onClick={() => void loadMoreProviderCandidates()}
                                        >
                                            {candidatesLoadingMore
                                                ? t('create.providerAdmission.loadingMoreCandidates')
                                                : t('create.providerAdmission.loadMoreCandidates')}
                                        </button>
                                    ) : null}
                                    {candidatesPageError ? (
                                        <div role="alert">
                                            <p>{t('create.providerAdmission.moreCandidatesUnavailable')}</p>
                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                disabled={candidatesLoadingMore}
                                                onClick={() => void loadMoreProviderCandidates()}
                                            >
                                                {t('create.providerAdmission.retryMoreCandidates')}
                                            </button>
                                        </div>
                                    ) : null}
                                    {selectedCandidate ? (
                                        <dl>
                                            <div>
                                                <dt>{t('create.providerAdmission.statusSummary')}</dt>
                                                <dd>{selectedCandidate.statusSummary}</dd>
                                            </div>
                                            <div>
                                                <dt>{t('create.providerAdmission.capacitySummary')}</dt>
                                                <dd>{selectedCandidate.capacitySummary}</dd>
                                            </div>
                                            <div>
                                                <dt>{t('create.providerAdmission.policySummary')}</dt>
                                                <dd>{selectedCandidate.policySummary}</dd>
                                            </div>
                                        </dl>
                                    ) : null}
                                </section>
                            ) : null}
                            {circleBindingActionType ? (
                                <section className={styles.fullField} aria-labelledby="circle-binding-intake-title">
                                    <h3 id="circle-binding-intake-title">
                                        {t(`create.circleBinding.action.${circleBindingActionType}`)}
                                    </h3>
                                    <p>{t('create.circleBinding.boundary')}</p>
                                    {circleBindingApplicationsLoading ? (
                                        <p role="status">{t('create.circleBinding.loading')}</p>
                                    ) : null}
                                    {circleBindingApplicationsError ? (
                                        <div role="alert">
                                            <p>{t('create.circleBinding.unavailable')}</p>
                                            <button
                                                type="button"
                                                className={styles.secondaryButton}
                                                disabled={circleBindingApplicationsLoading}
                                                onClick={retryCircleBindingApplications}
                                            >
                                                {t('create.circleBinding.retry')}
                                            </button>
                                        </div>
                                    ) : null}
                                    {!circleBindingApplicationsLoading && !circleBindingApplicationsError ? (
                                        <label>
                                            <span>{t('create.circleBinding.application')}</span>
                                            <Select
                                                ariaLabel={t('create.circleBinding.application')}
                                                value={selectedCircleBindingApplicationRef}
                                                onChange={(next) => {
                                                    setSelectedCircleBindingApplicationRef(next);
                                                    setConfirmOwnerCircleBindingApplication(false);
                                                }}
                                                options={[
                                                    { value: '', label: t('create.circleBinding.placeholder') },
                                                    ...circleBindingApplications.map((item) => ({
                                                        value: item.applicationRef,
                                                        label: `${item.displayName || item.externalAppId} · ${formatApplicationRequestedAt(item.requestedAt)}`,
                                                    })),
                                                ]}
                                            />
                                        </label>
                                    ) : null}
                                    {!circleBindingApplicationsLoading
                                    && !circleBindingApplicationsError
                                    && circleBindingApplications.length === 0 ? (
                                        <p>{t('create.circleBinding.empty')}</p>
                                    ) : null}
                                    {selectedCircleBindingApplication ? (
                                        <>
                                            <dl>
                                                <div>
                                                    <dt>{t('create.circleBinding.externalProgram')}</dt>
                                                    <dd>{selectedCircleBindingApplication.displayName || selectedCircleBindingApplication.externalAppId}</dd>
                                                </div>
                                                <div>
                                                    <dt>{t('create.circleBinding.requestedAt')}</dt>
                                                    <dd>{formatApplicationRequestedAt(selectedCircleBindingApplication.requestedAt)}</dd>
                                                </div>
                                            </dl>
                                            <details>
                                                <summary>{t('create.circleBinding.technicalDetails')}</summary>
                                                <dl>
                                                    <div>
                                                        <dt>{t('create.circleBinding.externalProgramId')}</dt>
                                                        <dd><code>{selectedCircleBindingApplication.externalAppId}</code></dd>
                                                    </div>
                                                    <div>
                                                        <dt>{t('create.circleBinding.applicationEpoch')}</dt>
                                                        <dd>{selectedCircleBindingApplication.applicationEpoch}</dd>
                                                    </div>
                                                    <div>
                                                        <dt>{t('create.circleBinding.rationaleDigest')}</dt>
                                                        <dd><code>{selectedCircleBindingApplication.rationaleDigest}</code></dd>
                                                    </div>
                                                </dl>
                                            </details>
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={confirmOwnerCircleBindingApplication}
                                                    onChange={(event) => setConfirmOwnerCircleBindingApplication(event.target.checked)}
                                                />
                                                <span>{t('create.circleBinding.confirm')}</span>
                                            </label>
                                        </>
                                    ) : null}
                                </section>
                            ) : null}
                            {!isCircleBindingOwnerAction && originKind !== 'manual_item' && (
                                <label className={styles.fullField}>
                                    <span>{t('create.sourceUrl')}</span>
                                    <input type="url" inputMode="url" value={sourceUrl} onChange={(event) => {
                                        setSourceUrl(event.target.value);
                                        resetPreflight();
                                    }} placeholder="https://" required />
                                </label>
                            )}
                            {!isCircleBindingOwnerAction && suggestions.length > 0 && !preflightAcknowledged ? (
                                <section className={styles.suggestions} aria-labelledby="case-intake-suggestions-title">
                                    <h3 id="case-intake-suggestions-title">{t('create.suggestionsTitle')}</h3>
                                    <p>{t('create.suggestionsBody')}</p>
                                    {suggestions.map((suggestion) => (
                                        <article key={suggestion.caseId}>
                                            <div>
                                                <strong>{suggestion.title}</strong>
                                                <span>{suggestion.reasons.map((reason) => t(`create.reason.${reason}`)).join(' · ')}</span>
                                            </div>
                                            <div className={styles.suggestionActions}>
                                                <Link href={suggestion.canonicalUrl}>{t('create.mergeOpen')}</Link>
                                                <button type="button" onClick={() => {
                                                    setRelationship({ kind: 'related', caseId: suggestion.caseId });
                                                    setRelationshipReason('');
                                                    setPreflightAcknowledged(true);
                                                }}>{t('create.createRelated')}</button>
                                                <button type="button" onClick={() => {
                                                    setRelationship({ kind: 'supersedes', caseId: suggestion.caseId });
                                                    setRelationshipReason('');
                                                    setPreflightAcknowledged(true);
                                                }}>{t('create.createSuperseding')}</button>
                                            </div>
                                        </article>
                                    ))}
                                    <button type="button" className={styles.separateButton} onClick={() => {
                                        setRelationship(null);
                                        setRelationshipReason('');
                                        setPreflightAcknowledged(true);
                                    }}>{t('create.createSeparate')}</button>
                                </section>
                            ) : null}
                            {!isCircleBindingOwnerAction && preflightAcknowledged && relationship ? (
                                <p className={styles.relationshipChoice}>
                                    {t(`create.relationship.${relationship.kind}`)}
                                </p>
                            ) : null}
                            {!isCircleBindingOwnerAction
                            && preflightAcknowledged
                            && relationship?.kind === 'supersedes' ? (
                                <label className={styles.fullField}>
                                    <span>{t('create.correctionReason')}</span>
                                    <textarea
                                        value={relationshipReason}
                                        onChange={(event) => setRelationshipReason(event.target.value)}
                                        minLength={10}
                                        maxLength={1000}
                                        required
                                    />
                                    <small>{t('create.correctionReasonBoundary')}</small>
                                </label>
                            ) : null}
                            {intakeError ? (
                                <div className={styles.formError} role="alert">
                                    <p>{intakeError}</p>
                                    {templateDraft?.actionType === 'circle.policy.document.adopt' ? (
                                        <a href="?tab=governance&settings=governance">
                                            {t('template.readinessNextStep.configureBinding')}
                                        </a>
                                    ) : null}
                                    {intakeConflictCaseId ? (
                                        <p>
                                            <Link href={`/governance/cases/${encodeURIComponent(intakeConflictCaseId)}`}>
                                                {t('create.mergeOpen')}
                                            </Link>
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className={styles.wizardActions}>
                                <button type="button" className={styles.secondaryButton} onClick={() => setIntakeStep(1)}>
                                    {t('create.backStep')}
                                </button>
                                <button
                                    className={styles.submitButton}
                                    type="submit"
                                    disabled={
                                        submitting
                                        || !templateDraft
                                        || (caseType === 'policy' && !templateDraft.actionType)
                                        || (!isCircleBindingOwnerAction
                                            && relationship?.kind === 'supersedes'
                                            && relationshipReason.trim().length < 10)
                                        || !providerAdmissionReady
                                        || !circleBindingApplicationReady
                                    }
                                >
                                    {submitting ? t('create.submitting') : t('create.submit')}
                                </button>
                            </div>
                        </form>
                    )}
                </section>
            ) : (
                <p className={styles.focusHint}>{t('focus.listHint', { active: activeCaseCount })}</p>
            )}

            <section id="governance-cases" className={`${styles.cases} ${styles.focusSurface}`} aria-labelledby="governance-case-groups-title">
                <div className={styles.focusHeading}>
                    <h3 id="governance-case-groups-title">{t('navigation.cases')}</h3>
                    <span>{t('focus.activeCount', { count: activeCaseCount })}</span>
                </div>
                {cases.length === 0 ? (
                    <div className={styles.empty}>
                        <CircleDot size={24} />
                        <strong>{t('emptyTitle')}</strong>
                        <span>{t('emptyBody')}</span>
                    </div>
                ) : (
                    <div className={styles.groups}>
                        {groupedCases.filter((group) => group.cases.length > 0).map((group) => (
                            <section key={group.id} className={styles.group} aria-labelledby={`governance-case-group-${group.id}`}>
                                <header>
                                    <h4 id={`governance-case-group-${group.id}`}>{t(`groups.${group.id}`)}</h4>
                                    <span>{group.cases.length}</span>
                                </header>
                                <div className={styles.list}>
                                    {group.cases.map((governanceCase) => (
                                        <Link key={governanceCase.id} href={governanceCase.canonicalUrl} className={styles.card}>
                                            <div className={styles.cardMain}>
                                                <strong>{governanceCase.title}</strong>
                                                <p className={styles.metaLine}>
                                                    <span>{t(`phase.${governanceCase.phase}`)}</span>
                                                    <span aria-hidden="true">·</span>
                                                    <span>{t(`type.${governanceCase.caseType}`)}</span>
                                                </p>
                                                <span className={styles.decisionLine}>{governanceCase.requestedDecision}</span>
                                                <div className={styles.statusRow}>
                                                    <GovernanceDecisionExecutionStatus
                                                        decisionStatus={governanceCase.primaryRequest?.decisionStatus ?? 'not_ready'}
                                                        executionStatus={governanceCase.primaryRequest?.executionStatus ?? 'not_ready'}
                                                        decisionText={t('status.decision', {
                                                            status: governanceCase.primaryRequest?.decisionStatus ?? t('status.notReady'),
                                                        })}
                                                        executionText={t('status.execution', {
                                                            status: governanceCase.primaryRequest?.executionStatus ?? t('status.notReady'),
                                                        })}
                                                        statusClassName={styles.statusChip}
                                                    />
                                                </div>
                                            </div>
                                            <ArrowRight size={18} aria-hidden="true" />
                                        </Link>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </section>

            <details className={styles.secondaryPanel} data-governance-secondary="tools">
                <summary>{t('focus.secondarySummary')}</summary>
                <nav className={styles.navigation} aria-label={t('navigation.aria')}>
                    <div className={styles.navGroup} data-nav-group="on-page">
                        <span className={styles.navGroupLabel}>{t('navigation.onPage')}</span>
                        <a href="#governance-cases">{t('navigation.cases')}</a>
                        <a href="#governance-overview">{t('navigation.overview')}</a>
                        <a href="#governance-mandates">{t('navigation.mandates')}</a>
                        <a href="#governance-templates">{t('navigation.templates')}</a>
                    </div>
                    <div className={styles.navGroup} data-nav-group="leave-page">
                        <span className={styles.navGroupLabel}>{t('navigation.leavePage')}</span>
                        <Link href="/governance">{t('navigation.workQueue')}</Link>
                        <Link href={`/governance/operations/${circleId}`}>
                            {t('navigation.operations')}
                        </Link>
                        <Link href={`/circles/${circleId}?tab=governance&settings=governance`}>
                            {t('navigation.settings')}
                        </Link>
                    </div>
                </nav>

                {searchResult ? (
                    <section className={styles.search} aria-labelledby="circle-governance-search-title">
                        <div className={styles.searchHeading}>
                            <div>
                                <p className={styles.eyebrow}>{t('search.eyebrow')}</p>
                                <h3 id="circle-governance-search-title">{t('search.title')}</h3>
                                <span>{t('search.count', {
                                    matched: searchResult.matched,
                                    total: searchResult.total,
                                })}</span>
                            </div>
                            <button
                                type="button"
                                onClick={clearSearch}
                                disabled={!searchQuery && Object.keys(searchFilters).length === 0}
                            >{t('search.clear')}</button>
                        </div>
                        <form className={styles.searchForm} onSubmit={submitSearch}>
                            <label className={styles.searchQuery}>
                                <span>{t('search.query')}</span>
                                <div>
                                    <Search size={16} aria-hidden="true" />
                                    <input
                                        type="search"
                                        value={searchDraft}
                                        onChange={(event) => setSearchDraft(event.target.value)}
                                        minLength={2}
                                        maxLength={256}
                                        placeholder={t('search.placeholder')}
                                    />
                                    <button type="submit" disabled={searching || searchDraft.trim().length === 1}>
                                        {t('search.submit')}
                                    </button>
                                </div>
                            </label>
                            <div className={styles.searchFilters}>
                                {CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS.map((key) => (
                                    <label key={key}>
                                        <span>{t(`search.field.${key}`)}</span>
                                        <Select
                                            ariaLabel={t(`search.field.${key}`)}
                                            value={searchFilters[key] ?? ''}
                                            disabled={searching}
                                            onChange={(next) => selectSearchFilter(key, next)}
                                            options={[
                                                { value: '', label: t('search.all') },
                                                ...searchResult.facets[key].map((facet) => ({
                                                    value: facet.value,
                                                    label: `${facet.value} (${facet.count})`,
                                                })),
                                            ]}
                                        />
                                    </label>
                                ))}
                            </div>
                        </form>
                        <p className={styles.searchBoundary}>{t('search.boundary')}</p>
                    </section>
                ) : null}

                <section id="governance-overview" className={styles.overview} aria-labelledby="governance-overview-title">
                    <div>
                        <p className={styles.eyebrow}>{t('overview.eyebrow')}</p>
                        <h3 id="governance-overview-title">{t('overview.title')}</h3>
                        <span>{t('overview.boundary')}</span>
                    </div>
                    <dl>
                        <div><dt>{t('overview.active')}</dt><dd>{activeCaseCount}</dd></div>
                        <div>
                            <dt>{t('overview.expiryRisk')}</dt>
                            <dd className={styles.unavailable}>{t('overview.unavailable')}</dd>
                            <small>{t('overview.expiryRiskUnavailable')}</small>
                        </div>
                        <div>
                            <dt>{t('overview.averageReviewAge')}</dt>
                            <dd className={styles.unavailable}>{t('overview.unavailable')}</dd>
                            <small>{t('overview.reviewAgeUnavailable')}</small>
                        </div>
                        <div><dt>{t('overview.pendingExecution')}</dt><dd>{pendingExecutionCount}</dd></div>
                        <div>
                            <dt>{t('overview.mandateSuspended')}</dt>
                            <dd data-mandate-suspended-count={suspendedMandateCount}>{suspendedMandateCount}</dd>
                        </div>
                        {groupedCases.map((group) => (
                            <div key={group.id}>
                                <dt>{t(`groups.${group.id}`)}</dt>
                                <dd>{group.cases.length}</dd>
                            </div>
                        ))}
                    </dl>
                </section>

                <section id="governance-mandates" className={styles.mandates} aria-labelledby="governance-mandates-title">
                    <div>
                        <p className={styles.eyebrow}>{t('navigation.mandates')}</p>
                        <h3 id="governance-mandates-title">{t('mandates.title')}</h3>
                        <span>{t('mandates.boundary')}</span>
                    </div>
                    <MandateDirection
                        direction="target"
                        bindings={targetBindings}
                        t={t}
                    />
                    <MandateDirection
                        direction="committee"
                        bindings={committeeBindings}
                        t={t}
                    />
                </section>

                {!showIntake ? (
                    <TemplatesSection
                        caseType={caseType}
                        setCaseType={setCaseType}
                        templateDraft={templateDraft}
                        setTemplateDraft={setTemplateDraft}
                        circleId={circleId}
                        submitting={submitting}
                        t={t}
                    />
                ) : null}
            </details>
        </section>
    );
}

function TemplatesSection({
    caseType,
    setCaseType,
    templateDraft,
    setTemplateDraft,
    circleId,
    submitting,
    t,
}: {
    caseType: GovernanceCaseType;
    setCaseType: (value: GovernanceCaseType) => void;
    templateDraft: GovernanceCaseTemplateDraft | null;
    setTemplateDraft: (value: GovernanceCaseTemplateDraft | null) => void;
    circleId: number;
    submitting: boolean;
    t: ReturnType<typeof useI18n>;
}) {
    return (
        <section id="governance-templates" className={styles.templates} aria-labelledby="governance-templates-title">
            <div>
                <p className={styles.eyebrow}>{t('navigation.templates')}</p>
                <h3 id="governance-templates-title">{t('templates.title')}</h3>
                <span>{t('templates.boundary')}</span>
            </div>
            <label className={styles.templateCaseType}>
                <span>{t('create.caseType')}</span>
                <Select
                    ariaLabel={t('create.caseType')}
                    value={caseType}
                    onChange={(next) => setCaseType(next as GovernanceCaseType)}
                    options={(['signal', 'policy', 'public_asset', 'program', 'grant', 'external_research'] as const).map((value) => ({
                        value,
                        label: t(`type.${value}`),
                    }))}
                />
            </label>
            <GovernanceCaseTemplatePicker
                circleId={circleId}
                caseType={caseType}
                value={templateDraft}
                onChange={setTemplateDraft}
                disabled={submitting}
            />
        </section>
    );
}

function MandateDirection({
    direction,
    bindings,
    t,
}: {
    direction: 'target' | 'committee';
    bindings: CircleGovernanceBinding[];
    t: ReturnType<typeof useI18n>;
}) {
    const mandates = bindings.filter((binding) => Boolean(binding.mandate));
    return (
        <section className={styles.mandateDirection} aria-labelledby={`governance-mandates-${direction}`}>
            <header>
                <h4 id={`governance-mandates-${direction}`}>{t(`mandates.direction.${direction}`)}</h4>
                <span>{mandates.length}</span>
            </header>
            {mandates.length === 0 ? (
                <p className={styles.mandateEmpty}>{t('mandates.empty')}</p>
            ) : (
                <div className={styles.mandateList}>
                    {mandates.map((binding) => {
                        const mandate = binding.mandate!;
                        const health = mandate.health;
                        return (
                            <article key={`${direction}:${binding.id}`} className={styles.mandateCard}>
                                <div>
                                    <strong>{mandate.id}</strong>
                                    <span>{t(`mandates.health.${health?.status ?? 'unavailable'}`)}</span>
                                </div>
                                <dl>
                                    <div>
                                        <dt>{t('mandates.target')}</dt>
                                        <dd>{binding.targetCircleId}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('mandates.committee')}</dt>
                                        <dd>{binding.committeeCircleId}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('mandates.window')}</dt>
                                        <dd>{health?.effectiveFrom && health.effectiveUntil
                                            ? `${new Date(health.effectiveFrom).toLocaleString()} – ${new Date(health.effectiveUntil).toLocaleString()}`
                                            : t('mandates.unavailable')}</dd>
                                    </div>
                                </dl>
                                {!health || health.status === 'suspended' || health.status === 'unavailable' ? (
                                    <p data-mandate-health-reason={health?.reason ?? 'mandate_owner_facts_unavailable'}>
                                        {t(`mandates.reason.${health?.reason ?? 'mandate_owner_facts_unavailable'}`)}
                                    </p>
                                ) : null}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

function formatApplicationRequestedAt(value: string | null): string {
    if (!value) return 'pending';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'pending';
    return new Date(timestamp).toLocaleString();
}

function extractGovernanceIntakeErrorCode(raw: string): string {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const jsonMatch = trimmed.match(/\{[\s\S]*\}$/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as { error?: unknown };
            if (typeof parsed.error === 'string' && parsed.error.trim()) {
                return parsed.error.trim();
            }
        } catch {
            // fall through
        }
    }
    return trimmed.replace(/^\d{3}\s+/, '').trim();
}

function classifyProviderCandidatesError(error: unknown): string {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('private_sidecar_required')) return 'sidecar_required';
    if (message.startsWith('401 ') || message.startsWith('403 ')) return 'unauthorized';
    if (message.startsWith('429 ')) return 'rate_limited';
    return 'unavailable';
}

function providerCandidatesErrorMessageKey(error: string | null): string {
    if (error === 'sidecar_required') return 'create.providerAdmission.candidatesSidecarRequired';
    if (error === 'unauthorized') return 'create.providerAdmission.candidatesUnauthorized';
    if (error === 'rate_limited') return 'create.providerAdmission.candidatesRateLimited';
    return 'create.providerAdmission.candidatesUnavailable';
}

function createClientIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `case-intake:${crypto.randomUUID()}`;
    }
    return `case-intake:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
