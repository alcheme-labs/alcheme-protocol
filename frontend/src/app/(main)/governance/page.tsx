'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Clock3, Inbox, RefreshCw, ShieldCheck } from 'lucide-react';

import GovernanceOperationsList from '@/features/governance/GovernanceOperationsList';
import GovernanceDecisionExecutionStatus from '@/features/governance/GovernanceDecisionExecutionStatus';
import GovernanceExecutionRecoveryStatus from '@/features/governance/GovernanceExecutionRecoveryStatus';
import GovernanceProviderIncidentStatus from '@/features/governance/GovernanceProviderIncidentStatus';
import { useI18n } from '@/i18n/useI18n';
import {
    fetchMyGovernanceInbox,
    GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS,
    retryGovernanceFundingAmendedExecution,
    type GovernanceCaseInboxItem,
    type GovernanceCaseInboxTask,
    type GovernanceInbox,
    type GovernanceInstitutionalDuty,
    type GovernanceOperationInboxItem,
    type GovernanceOperationalInboxFilterKey,
    type GovernanceOperationalInboxFilters,
} from '@/lib/api/governance';
import styles from './page.module.css';

const PAGE_SIZE = 20;

function readLocationState(): { filters: GovernanceOperationalInboxFilters; page: number } {
    if (typeof window === 'undefined') return { filters: {}, page: 1 };
    const params = new URLSearchParams(window.location.search);
    const pageValue = Number(params.get('page'));
    const filters: GovernanceOperationalInboxFilters = {};
    for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
        const value = params.get(key)?.trim();
        if (value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) {
            filters[key] = value;
        }
    }
    return {
        filters,
        page: Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    };
}

function replaceLocationState(filters: GovernanceOperationalInboxFilters, page: number): void {
    const params = new URLSearchParams();
    for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
        if (filters[key]) params.set(key, filters[key]!);
    }
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `/governance${query ? `?${query}` : ''}`);
}

function caseHref(
    canonicalUrl: string,
    filters: GovernanceOperationalInboxFilters,
    page: number,
): string {
    const params = new URLSearchParams({ from: 'my-governance', page: String(page) });
    for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
        if (filters[key]) params.set(key, filters[key]!);
    }
    return `${canonicalUrl}${canonicalUrl.includes('?') ? '&' : '?'}${params.toString()}`;
}

function taskResumeFragment(action: GovernanceCaseInboxTask['primaryAction']): string {
    if (action === 'continue_brief') return 'case-brief-title';
    if (action === 'review_brief') return 'case-review-focus';
    if (action === 'open_approval_stage') return 'case-focus-action';
    if (action === 'cast_vote') return 'case-decision-stages-title';
    if (action === 'open_execution') return 'case-responsibility-execution';
    if (action === 'submit_execution_evidence') return 'case-manual-execution-control';
    if (action === 'review_execution_evidence') return 'case-manual-execution-control';
    if (action === 'record_outcome') return 'case-responsibility-outcome';
    if (action === 'view_record') return 'case-actual-outcome-title';
    return 'case-workflow-title';
}

function taskCaseHref(
    item: GovernanceCaseInboxItem,
    filters: GovernanceOperationalInboxFilters,
    page: number,
): string {
    return `${caseHref(item.case.canonicalUrl, filters, page)}#${taskResumeFragment(item.task.primaryAction)}`;
}

export default function MyGovernancePage() {
    const t = useI18n('MyGovernance');
    const caseT = useI18n('GovernanceCases');
    const manualExecutionT = useI18n('MyGovernanceManualExecution');
    const operationsT = useI18n('MyGovernanceOperations');
    const paginationT = useI18n('MyGovernancePagination');
    const platformSafetyT = useI18n('PlatformSafety');
    const taskActionLabel = (action: GovernanceCaseInboxTask['primaryAction']) => (
        action === 'submit_execution_evidence' || action === 'review_execution_evidence'
            ? manualExecutionT(`action.${action}`)
            : t(`action.${action}`)
    );
    const taskReasonLabel = (reason: string) => (
        reason === 'manual_execution_approved'
        || reason === 'manual_execution_review_required'
        || reason === 'manual_execution_submission_required'
            ? manualExecutionT(`reason.${reason}`)
            : t(`reason.${reason}`)
    );
    const workflowT = useI18n('GovernanceCaseWorkflow');
    const [items, setItems] = useState<GovernanceCaseInboxItem[]>([]);
    const [institutionalDuties, setInstitutionalDuties] = useState<GovernanceInstitutionalDuty[]>([]);
    const [operations, setOperations] = useState<GovernanceOperationInboxItem[]>([]);
    const [continueWorking, setContinueWorking] = useState<GovernanceInbox['continueWorking']>(null);
    const [queue, setQueue] = useState<GovernanceInbox['queue'] | null>(null);
    const [filters, setFilters] = useState<GovernanceOperationalInboxFilters>({});
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryingFundingAmendment, setRetryingFundingAmendment] = useState<string | null>(null);
    const [fundingAmendmentRetryError, setFundingAmendmentRetryError] = useState<string | null>(null);
    const restoredView = useRef<string | null>(null);
    const requestVersion = useRef(0);
    const roleLabel = (
        value: GovernanceCaseInboxTask['role']
            | GovernanceInstitutionalDuty['role']
            | GovernanceOperationInboxItem['identities'][number]['role'],
    ): string => (
        value === 'operational_assignee'
            || value === 'respondent_appellant'
            || value === 'appeal_reviewer'
            ? operationsT(`identity.${value}`)
            : value === 'appellant'
            ? workflowT('memberRights.role.respondent_appellant')
            : value === 'governance_home_manager'
                || value === 'delegated_authority_participant'
                || value === 'system_authority_participant'
                ? t(`systemDuties.participantRole.${value}`)
                : t(`role.${value}`)
    );
    const facetValueLabel = (key: GovernanceOperationalInboxFilterKey, value: string): string => {
        if (key === 'assignee' && value === 'self') return t('queueFilters.value.self');
        if (key === 'age' || key === 'deadline' || key === 'risk') {
            return t(`queueFilters.value.${key}.${value}`);
        }
        if (key === 'identity') {
            const [, roleValue] = value.split(':');
            if (roleValue) return roleLabel(
                roleValue as GovernanceCaseInboxTask['role']
                    | GovernanceInstitutionalDuty['role']
                    | GovernanceOperationInboxItem['identities'][number]['role'],
            );
        }
        return value;
    };

    const loadInbox = useCallback((nextFilters: GovernanceOperationalInboxFilters) => {
        const version = requestVersion.current + 1;
        requestVersion.current = version;
        setLoading(true);
        setError(false);
        void fetchMyGovernanceInbox(nextFilters)
            .then((value) => {
                if (requestVersion.current !== version) return;
                setQueue(value.queue);
                setItems(value.items);
                setInstitutionalDuties(value.institutionalDuties);
                setOperations(value.operations);
                setContinueWorking(value.continueWorking);
            })
            .catch(() => {
                if (requestVersion.current === version) setError(true);
            })
            .finally(() => {
                if (requestVersion.current === version) setLoading(false);
            });
    }, []);

    const retryFundingAmendedExecution = useCallback((item: GovernanceCaseInboxItem) => {
        const requestId = item.case.primaryRequest?.id;
        if (!requestId || retryingFundingAmendment) return;
        if (!window.confirm(
            'Retry the exact accepted Provider action with the governed funding amendment? This may request a fresh quote and signer confirmation.',
        )) return;
        setRetryingFundingAmendment(requestId);
        setFundingAmendmentRetryError(null);
        void retryGovernanceFundingAmendedExecution({
            requestId,
            confirmation: 'retry_same_intent_with_accepted_funding_amendment',
        }).then(() => loadInbox(filters))
            .catch(() => setFundingAmendmentRetryError(requestId))
            .finally(() => setRetryingFundingAmendment(null));
    }, [filters, loadInbox, retryingFundingAmendment]);

    useEffect(() => {
        const locationState = readLocationState();
        setFilters(locationState.filters);
        setPage(locationState.page);
        loadInbox(locationState.filters);
    }, [loadInbox]);

    const filteredItems = items;
    const filteredInstitutionalDuties = institutionalDuties;
    const filteredOperations = operations;
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const visibleItems = useMemo(
        () => filteredItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        [currentPage, filteredItems],
    );
    const filterKey = GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS
        .map((key) => `${key}=${filters[key] ?? ''}`)
        .join('&');
    const viewKey = `my-governance:${filterKey}:${currentPage}`;

    useEffect(() => {
        if (loading || restoredView.current === viewKey) return;
        if (page !== currentPage) {
            setPage(currentPage);
            replaceLocationState(filters, currentPage);
        }
        const saved = Number(window.sessionStorage.getItem(viewKey));
        if (Number.isFinite(saved) && saved > 0) window.scrollTo(0, saved);
        restoredView.current = viewKey;
    }, [currentPage, filters, loading, page, viewKey]);

    const selectFilter = (key: GovernanceOperationalInboxFilterKey, value: string) => {
        const nextFilters = { ...filters };
        if (value) nextFilters[key] = value;
        else delete nextFilters[key];
        setFilters(nextFilters);
        setPage(1);
        replaceLocationState(nextFilters, 1);
        loadInbox(nextFilters);
        window.scrollTo(0, 0);
    };

    const clearFilters = () => {
        setFilters({});
        setPage(1);
        replaceLocationState({}, 1);
        loadInbox({});
        window.scrollTo(0, 0);
    };

    const selectPage = (nextPage: number) => {
        setPage(nextPage);
        replaceLocationState(filters, nextPage);
        window.scrollTo(0, 0);
    };

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <div className={styles.headerIcon}><ShieldCheck size={24} /></div>
                <div>
                    <p>{t('eyebrow')}</p>
                    <h1>{t('title')}</h1>
                    <span>{t('boundary')}</span>
                </div>
            </header>

            <Link className={styles.platformSafetyLink} href="/governance/safety">
                <div>
                    <p>{platformSafetyT('eyebrow')}</p>
                    <strong>{platformSafetyT('title')}</strong>
                    <span>{platformSafetyT('boundary')}</span>
                </div>
                <ArrowRight size={20} aria-hidden="true" />
            </Link>

            {!loading && !error && continueWorking ? (
                <section className={styles.continueWorking} aria-labelledby="continue-governance-work-title">
                    <div>
                        <p>{t('continuity.eyebrow')}</p>
                        <h2 id="continue-governance-work-title">{t('continuity.title')}</h2>
                        <span>{continueWorking.title}</span>
                    </div>
                    <div>
                        <small data-read-status={continueWorking.status}>
                            {t(`continuity.status.${continueWorking.status}`)}
                        </small>
                        <Link href={continueWorking.canonicalUrl}>
                            {t('continuity.action')}
                            <ArrowRight size={17} />
                        </Link>
                    </div>
                </section>
            ) : null}

            {!loading && !error && filteredInstitutionalDuties.length > 0 ? (
                <section className={styles.systemDuties} aria-labelledby="institutional-governance-duties-title">
                    <div className={styles.systemDutiesHeader}>
                        <div>
                            <p>{t('systemDuties.eyebrow')}</p>
                            <h2 id="institutional-governance-duties-title">{t('systemDuties.title')}</h2>
                        </div>
                        <span>{t('systemDuties.readOnly')}</span>
                    </div>
                    <p className={styles.systemDutiesBoundary}>{t('systemDuties.boundary')}</p>
                    <div className={styles.systemDutyGrid}>
                        {filteredInstitutionalDuties.map((duty) => (
                            <article key={duty.id} className={styles.systemDutyCard}>
                                <div className={styles.systemDutyTopline}>
                                    <strong>{roleLabel(duty.role)}</strong>
                                    <span data-status={duty.task.status}>
                                        {t(`systemDuties.taskStatus.${duty.task.status}`)}
                                    </span>
                                </div>
                                <dl>
                                    <div>
                                        <dt>{t('systemDuties.circle')}</dt>
                                        <dd>{duty.circleId}</dd>
                                    </div>
                                    {duty.mandate ? <>
                                        <div>
                                            <dt>{t('systemDuties.mandate')}</dt>
                                            <dd>{duty.mandate.id}</dd>
                                        </div>
                                        <div>
                                            <dt>{t('systemDuties.mandateHealth')}</dt>
                                            <dd data-mandate-health={duty.mandate.health.status}>
                                                {t(`systemDuties.health.${duty.mandate.health.status}`)}
                                            </dd>
                                        </div>
                                    </> : null}
                                    {duty.systemRole ? <>
                                        <div>
                                            <dt>{t('systemDuties.systemRole')}</dt>
                                            <dd>{t(`systemDuties.role.${duty.systemRole.roleKey}`)}</dd>
                                        </div>
                                        <div>
                                            <dt>{t('systemDuties.environmentLabel')}</dt>
                                            <dd>{t(`systemDuties.environment.${duty.systemRole.environment}`)}</dd>
                                        </div>
                                        <div>
                                            <dt>{t('systemDuties.policy')}</dt>
                                            <dd>{duty.systemRole.policy.id} · v{duty.systemRole.policy.version}</dd>
                                        </div>
                                    </> : null}
                                </dl>
                                {duty.systemRole ? (
                                    <div className={styles.provenance} data-status={duty.systemRole.provenance.status}>
                                        <strong>{t(`systemDuties.provenance.${duty.systemRole.provenance.status}`)}</strong>
                                        <span>{t('systemDuties.request')}: {duty.systemRole.provenance.requestId ?? t('unavailable')}</span>
                                        <span>{t('systemDuties.decision')}: {duty.systemRole.provenance.decisionDigest ?? t('unavailable')}</span>
                                        <span>{t('systemDuties.receipt')}: {duty.systemRole.provenance.executionReceiptId ?? t('unavailable')}</span>
                                    </div>
                                ) : null}
                                <Link href={duty.task.canonicalUrl} className={styles.openCase}>
                                    {t(`systemDuties.action.${duty.task.primaryAction}`)}
                                    <ArrowRight size={17} />
                                </Link>
                            </article>
                        ))}
                    </div>
                </section>
            ) : null}

            {!error && queue ? (
                <section className={styles.queueFilters} aria-labelledby="operational-inbox-filters-title">
                    <div className={styles.queueFiltersHeader}>
                        <div>
                            <p>{t('queueFilters.eyebrow')}</p>
                            <h2 id="operational-inbox-filters-title">{t('queueFilters.title')}</h2>
                            <span>{t('queueFilters.count', {
                                matched: queue.matched,
                                total: queue.total,
                            })}</span>
                        </div>
                        <button type="button" onClick={clearFilters} disabled={Object.keys(filters).length === 0}>
                            {t('queueFilters.clear')}
                        </button>
                    </div>
                    <div className={styles.queueFilterGrid}>
                        {GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS.map((key) => (
                            <label key={key}>
                                <span>{t(`queueFilters.field.${key}`)}</span>
                                <select
                                    aria-label={t(`queueFilters.field.${key}`)}
                                    value={filters[key] ?? ''}
                                    onChange={(event) => selectFilter(key, event.target.value)}
                                >
                                    <option value="">{t('queueFilters.all')}</option>
                                    {queue.facets[key].map((facet) => (
                                        <option key={facet.value} value={facet.value}>
                                            {facetValueLabel(key, facet.value)} ({facet.count})
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ))}
                    </div>
                    <p className={styles.queueFilterBoundary}>{t('queueFilters.boundary')}</p>
                </section>
            ) : null}

            {!loading && !error && filteredOperations.length > 0 ? (
                <GovernanceOperationsList operations={filteredOperations} />
            ) : null}

            {loading ? (
                <div className={styles.state}><RefreshCw className={styles.spin} size={20} />{t('loading')}</div>
            ) : error ? (
                <div className={styles.state} role="alert">{t('loadError')}</div>
            ) : filteredItems.length === 0
                && filteredInstitutionalDuties.length === 0
                && filteredOperations.length === 0 ? (
                <div className={styles.empty}>
                    <Inbox size={28} />
                    <strong>{t('empty.title')}</strong>
                    <span>{t('empty.body')}</span>
                </div>
            ) : (
                <>
                    <section className={styles.list} aria-label={t('listAria')}>
                        {visibleItems.map((item) => (
                            <article key={item.case.id} className={styles.card}>
                                <div className={styles.cardTopline}>
                                    <span data-read-status={item.readState.status}>
                                        {t(`continuity.status.${item.readState.status}`)} · {t(`category.${item.task.category}`)}
                                    </span>
                                    <span data-status={item.task.status}>{t(`status.${item.task.status}`)}</span>
                                </div>
                                <h2>{item.case.title}</h2>
                                <p className={styles.decision}>{item.case.requestedDecision}</p>
                                {item.task.decisionExecutionStatus ? (
                                    <div
                                        data-provider-execution-expired={
                                            item.task.decisionExecutionStatus.executionStatus === 'expired'
                                                ? 'authoritative_receipt_and_checkpoint_readback'
                                                : undefined
                                        }
                                    >
                                        <GovernanceDecisionExecutionStatus
                                            className={styles.decision}
                                            decisionStatus={item.task.decisionExecutionStatus.decisionStatus}
                                            executionStatus={item.task.decisionExecutionStatus.executionStatus}
                                            decisionText={caseT('status.decision', {
                                                status: item.task.decisionExecutionStatus.decisionStatus,
                                            })}
                                            executionText={caseT('status.execution', {
                                                status: item.task.decisionExecutionStatus.executionStatus,
                                            })}
                                        />
                                    </div>
                                ) : null}
                                {item.case.caseBlockers.map((blocker) => (
                                    <div
                                        key={blocker.id}
                                        className={styles.providerHealth}
                                        data-case-blocker={blocker.code}
                                        data-case-blocker-status={blocker.status}
                                        role="status"
                                    >
                                        <strong>{blocker.code}</strong>
                                        <span>
                                            {blocker.status === 'resolved'
                                                ? 'funding amendment accepted · manual same-intent retry ready'
                                                : 'accepted decision preserved · execution paused'}
                                            {' · owner '}{blocker.owner}
                                        </span>
                                        <span>
                                            resolution {blocker.resolutionRequirement}
                                            {' · receipt '}{blocker.evidenceReceiptId}
                                        </span>
                                        {blocker.status === 'resolved'
                                        && item.case.readerAudience === 'operator'
                                        && item.case.primaryRequest ? (
                                            <button
                                                type="button"
                                                data-funding-amendment-manual-retry
                                                disabled={retryingFundingAmendment !== null}
                                                onClick={() => retryFundingAmendedExecution(item)}
                                            >
                                                {retryingFundingAmendment === item.case.primaryRequest.id
                                                    ? 'Retrying…'
                                                    : 'Retry exact action with accepted amendment'}
                                            </button>
                                        ) : null}
                                        {fundingAmendmentRetryError === item.case.primaryRequest?.id ? (
                                            <small role="alert">Retry was not started. Recheck authority and amendment state.</small>
                                        ) : null}
                                    </div>
                                ))}
                                <dl>
                                    <div>
                                        <dt>{t('home')}</dt>
                                        <dd>{item.case.governanceHome
                                            ? `${item.case.governanceHome.type}:${item.case.governanceHome.ref}`
                                            : t('unavailable')}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('roleLabel')}</dt>
                                        <dd>{[
                                            roleLabel(item.task.role),
                                            ...item.institutionalIdentities.map(
                                                (identity) => roleLabel(identity.role),
                                            ),
                                        ].filter((label, index, labels) => (
                                            labels.indexOf(label) === index
                                        )).join(' · ')}</dd>
                                    </div>
                                    <div>
                                        <dt>{t('actionLabel')}</dt>
                                        <dd>{taskActionLabel(item.task.primaryAction)}</dd>
                                    </div>
                                </dl>
                                {item.task.resourceExecutionAdmission ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-resource-execution-admission={item.task.resourceExecutionAdmission.state}
                                        role="status"
                                    >
                                        <strong>governed resource admitted for exact provider execution</strong>
                                        <span>
                                            {item.task.resourceExecutionAdmission.binding.cluster}
                                            {' · '}{item.task.resourceExecutionAdmission.binding.provider}
                                            {' · '}{item.task.resourceExecutionAdmission.binding.capability}
                                            {' · resource '}{item.task.resourceExecutionAdmission.binding.resourceRef}
                                            {' · owner '}{item.task.resourceExecutionAdmission.binding.ownerProgramRef}
                                        </span>
                                        <span>
                                            authorities {item.task.resourceExecutionAdmission.controllingAuthorities.length}
                                            {' · slot '}{item.task.resourceExecutionAdmission.binding.verifiedSlot}
                                            {' · title inference: forbidden · key refs exposed: no'}
                                        </span>
                                        {item.task.resourceExecutionAdmission.artifactMapping ? (
                                            <span data-provider-execution-resource-artifact={item.task.resourceExecutionAdmission.artifactMapping.artifactId}>
                                                artifact mapped to {item.task.resourceExecutionAdmission.artifactMapping.resourceBindingId}
                                                {' · '}{item.task.resourceExecutionAdmission.artifactMapping.adapterRef}
                                            </span>
                                        ) : null}
                                    </div>
                                ) : null}
                                {item.task.executionAuthorityPreflight ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-execution-authority-preflight={item.task.executionAuthorityPreflight.state}
                                        role="status"
                                    >
                                        <strong>execution authority preflight verified</strong>
                                        <span>
                                            snapshot {item.task.executionAuthorityPreflight.frozenAuthority.snapshotId}
                                            {' · mandate '}{item.task.executionAuthorityPreflight.mandate.id}
                                            {' · artifact '}{item.task.executionAuthorityPreflight.governedDecision.artifactId}
                                        </span>
                                        <span>
                                            live authority {item.task.executionAuthorityPreflight.liveExecutionAuthority.result}
                                            {' · resource '}{item.task.executionAuthorityPreflight.governedDecision.resourceBindingId}
                                            {' · execution allowed: yes'}
                                        </span>
                                        <span data-provider-execution-enforcement-binding="verified_live">
                                            enforcement {item.task.executionAuthorityPreflight.executionEnforcementBinding.mode}
                                            {' · adapter '}{item.task.executionAuthorityPreflight.executionEnforcementBinding.allowedAdapter}
                                            {' · operations '}{item.task.executionAuthorityPreflight.executionEnforcementBinding.allowedOperations.join(', ')}
                                            {' · bypass prevented: no'}
                                        </span>
                                        <span>next gate {item.task.executionAuthorityPreflight.nextGate}</span>
                                    </div>
                                ) : null}
                                {item.task.executionPreview ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-execution-preview="canonical_cost_preflight_pre_sign_state_and_active_binding"
                                        role="status"
                                    >
                                        <strong>provider execution preview: ready to sign</strong>
                                        <span>
                                            {item.task.executionPreview.instruction.summary}
                                            {' · provider '}{item.task.executionPreview.provider}
                                            {' · network '}{item.task.executionPreview.network}
                                            {' · asset change '}{item.task.executionPreview.instruction.assetChange}
                                        </span>
                                        <span>
                                            programs {item.task.executionPreview.instruction.programIds.join(', ')}
                                            {' · accounts '}{item.task.executionPreview.instruction.accountScope.map((account) => account.role).join(', ')}
                                            {' · simulation '}{item.task.executionPreview.instruction.simulation}
                                            {' · raw instruction exposed: no'}
                                        </span>
                                        <span>
                                            signer {item.task.executionPreview.signingAuthority.publicAuthority}
                                            {' · key ref exposed: no · payer '}{item.task.executionPreview.feePayer.policyId}
                                            {' · bearer '}{item.task.executionPreview.feePayer.economicBearer}
                                            {' · next gate '}{item.task.executionPreview.nextGate}
                                        </span>
                                    </div>
                                ) : null}
                                {item.task.executionProgress ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-partial-execution={item.task.executionProgress.state}
                                        role="status"
                                    >
                                        <strong>provider execution is partial, not complete</strong>
                                        <span>
                                            completed {item.task.executionProgress.completed.map((step) => (
                                                `${step.stepId}@${step.actionReceipt.observedSlot}:${step.actionReceipt.providerReference}`
                                            )).join(', ')}
                                            {' · remaining '}{item.task.executionProgress.remaining.join(', ')}
                                        </span>
                                        <span>
                                            irreversible changes {item.task.executionProgress.completed.length}
                                            {' · compensation '}{item.task.executionProgress.compensation.state}
                                            {' · owner '}{typeof item.task.executionProgress.compensation.owner === 'string'
                                                ? item.task.executionProgress.compensation.owner
                                                : `${item.task.executionProgress.compensation.owner.pubkey} via ${item.task.executionProgress.compensation.owner.caseId}`}
                                            {' · next gate '}{item.task.executionProgress.nextGate}
                                        </span>
                                    </div>
                                ) : null}
                                {item.task.automaticExecutionAvailability ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-automatic-execution-availability={item.task.automaticExecutionAvailability.state}
                                        data-provider-readiness-state={item.task.automaticExecutionAvailability.readinessState}
                                        data-provider-risk-maturity={item.task.automaticExecutionAvailability.riskMaturity}
                                        data-provider-stage-open-gate={item.task.automaticExecutionAvailability.stageGate.openStage}
                                        data-provider-execute-gate={item.task.automaticExecutionAvailability.stageGate.execute}
                                        data-provider-enforcement-mode={item.task.automaticExecutionAvailability.mode}
                                        role="status"
                                    >
                                        <strong>
                                            automatic provider execution {item.task.automaticExecutionAvailability.state}
                                            {' · readiness '}{item.task.automaticExecutionAvailability.readinessState}
                                            {' · risk '}{item.task.automaticExecutionAvailability.riskMaturity}
                                        </strong>
                                        <span>
                                            {item.task.automaticExecutionAvailability.providerModule}
                                            {' · blockers '}{item.task.automaticExecutionAvailability.blockers.join(', ') || 'none'}
                                            {' · completion claim allowed: no'}
                                        </span>
                                        <span>
                                            wallet manual {item.task.automaticExecutionAvailability.walletManual}
                                            {' · advisory '}{item.task.automaticExecutionAvailability.advisoryOnly}
                                            {' · stage '}{item.task.automaticExecutionAvailability.stageGate.openStage}
                                            {' · execute '}{item.task.automaticExecutionAvailability.stageGate.execute}
                                            {' · risk confirmation '}{item.task.automaticExecutionAvailability.stageGate.riskConfirmation}
                                        </span>
                                    </div>
                                ) : null}
                                {item.task.manualExecutionControl ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-manual-execution-control={item.task.manualExecutionControl.state}
                                        role="status"
                                    >
                                        <strong>manual execution control</strong>
                                        <span>
                                            assignee {item.task.manualExecutionControl.stageAssignee?.pubkey ?? 'missing'}
                                            {' · deadline '}{item.task.manualExecutionControl.stageAssignee?.deadlineAt ?? 'missing'}
                                            {' · reviewer '}{item.task.manualExecutionControl.reviewer?.pubkey ?? 'missing'}
                                        </span>
                                        <span>
                                            {item.task.manualExecutionControl.completionSource}
                                            {' · direct mark executed: forbidden'}
                                            {' · assignment grants signer authority: no'}
                                        </span>
                                        {item.task.manualExecutionControl.completionEvidence ? (
                                            <span data-manual-execution-completion-evidence={item.task.manualExecutionControl.completionEvidence.receiptId}>
                                                receipt {item.task.manualExecutionControl.completionEvidence.receiptId}
                                                {' · slot '}{item.task.manualExecutionControl.completionEvidence.observedSlot}
                                                {' · reviewer action required'}
                                            </span>
                                        ) : null}
                                        {item.task.manualExecutionControl.manualSubmission ? (
                                            <span data-manual-execution-submission={item.task.manualExecutionControl.manualSubmission.status}>
                                                submission v{item.task.manualExecutionControl.manualSubmission.version}
                                                {' · evidence '}{item.task.manualExecutionControl.manualSubmission.evidenceCount}
                                                {' · digest '}{item.task.manualExecutionControl.manualSubmission.evidenceDigest}
                                                {item.task.manualExecutionControl.manualSubmission.receiptId
                                                    ? ` · receipt ${item.task.manualExecutionControl.manualSubmission.receiptId}`
                                                    : ''}
                                            </span>
                                        ) : null}
                                    </div>
                                ) : null}
                                {item.task.executionParticipantBoundary ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-execution-participant={item.task.executionParticipantBoundary.participantRole}
                                        data-provider-execution-task-source={item.task.executionParticipantBoundary.actorTaskSource}
                                        role="status"
                                    >
                                        <strong>
                                            provider execution participant: {item.task.executionParticipantBoundary.pendingWork}
                                        </strong>
                                        <span>
                                            {item.task.executionParticipantBoundary.provider}
                                            {' · resource '}{item.task.executionParticipantBoundary.resourceRef}
                                            {' · request '}{item.task.executionParticipantBoundary.requestId}
                                            {' · decision '}{item.task.executionParticipantBoundary.decisionDigest.slice(0, 12)}…
                                        </span>
                                        <span>
                                            authority roles {item.task.executionParticipantBoundary.authorityRoles.join(', ')}
                                            {' · actor authority roles '}{item.task.executionParticipantBoundary.actorAuthorityRoles.join(', ') || 'none'}
                                            {' · operations '}{item.task.executionParticipantBoundary.allowedOperations.join(', ')}
                                        </span>
                                        <span>
                                            assignment grants signer authority: no
                                            {' · assignment grants payer authority: no'}
                                            {' · signer authority source '}{item.task.executionParticipantBoundary.signerAuthoritySource}
                                            {' · payer policy '}{item.task.executionParticipantBoundary.payerPolicyId}
                                        </span>
                                    </div>
                                ) : null}
                                {item.task.providerHealth ? (
                                    <div
                                        className={styles.providerHealth}
                                        data-provider-health={item.task.providerHealth.status}
                                    >
                                        <strong>
                                            {workflowT('providerExecution.status')}: {item.task.providerHealth.status}
                                        </strong>
                                        <span
                                            data-provider-readiness={item.task.providerHealth.readiness.readinessState}
                                            data-provider-risk-maturity={item.task.providerHealth.readiness.riskMaturity}
                                            data-provider-execution-open={item.task.providerHealth.readiness.executionOpenAllowed ? 'true' : 'false'}
                                        >
                                            readiness {item.task.providerHealth.readiness.readinessState}
                                            {' · risk '}{item.task.providerHealth.readiness.riskMaturity}
                                            {' · stage open '}{item.task.providerHealth.readiness.stageOpenAllowed ? 'yes' : 'no'}
                                            {' · execution open '}{item.task.providerHealth.readiness.executionOpenAllowed ? 'yes' : 'no'}
                                            {item.task.providerHealth.readiness.riskConfirmationRequired
                                                ? ' · risk confirmation required'
                                                : ''}
                                            {item.task.providerHealth.readiness.blockers.length > 0
                                                ? ` · blockers ${item.task.providerHealth.readiness.blockers.join(', ')}`
                                                : ''}
                                        </span>
                                        <span>
                                            {t('queueFilters.field.provider')}: {item.task.providerHealth.provider}
                                            {item.task.providerHealth.profileRef
                                                ? ` · ${item.task.providerHealth.profileRef}@${item.task.providerHealth.profileVersion ?? '?'}`
                                                : ''}
                                        </span>
                                        <span>
                                            {workflowT('providerExecution.resource')}: {item.task.providerHealth.resourceRef ?? t('unavailable')}
                                            {' · '}{workflowT('providerExecution.finality')}: {item.task.providerHealth.observedSlot ?? t('unavailable')}
                                        </span>
                                        {item.task.providerHealth.observedAt ? (
                                            <span>{new Date(item.task.providerHealth.observedAt).toLocaleString()}</span>
                                        ) : null}
                                        {item.task.providerHealth.profileDigest ? (
                                            <span data-provider-profile-revalidation="verified_current">
                                                {item.task.providerHealth.decoderConformance ?? t('unavailable')}
                                                {' · '}{item.task.providerHealth.profileDigest.slice(0, 12)}…
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.revalidation ? (
                                            <span data-provider-revalidation-required="true" role="status">
                                                {item.task.providerHealth.revalidation.triggers.join(', ')}
                                                {' · '}{item.task.providerHealth.revalidation.currentProfileRef}
                                                @{item.task.providerHealth.revalidation.currentProfileVersion}
                                                {' → '}{item.task.providerHealth.revalidation.targetProfileRef}
                                                @{item.task.providerHealth.revalidation.targetProfileVersion}
                                                {' · '}{item.task.providerHealth.revalidation.targetProfileDigest.slice(0, 12)}…
                                            </span>
                                        ) : null}
                                        <span data-provider-sync={item.task.providerHealth.sync.state}>
                                            {item.task.providerHealth.sync.source}
                                            {' · '}{item.task.providerHealth.sync.state}
                                            {' · '}{item.task.providerHealth.sync.lastSyncedAt
                                                ? new Date(item.task.providerHealth.sync.lastSyncedAt).toLocaleString()
                                                : t('unavailable')}
                                            {item.task.providerHealth.sync.failure
                                                ? ` · ${item.task.providerHealth.sync.failure}`
                                                : ''}
                                        </span>
                                        <span data-provider-rpc-health={item.task.providerHealth.sources.rpc.state}>
                                            RPC · {item.task.providerHealth.sources.rpc.state}
                                            {' · slot '}{item.task.providerHealth.sources.rpc.observedSlot ?? t('unavailable')}
                                            {item.task.providerHealth.sources.rpc.failure
                                                ? ` · ${item.task.providerHealth.sources.rpc.failure}`
                                                : ''}
                                        </span>
                                        <span data-provider-indexer-health={item.task.providerHealth.sources.indexer.state}>
                                            Indexer · {item.task.providerHealth.sources.indexer.state}
                                            {' · '}{item.task.providerHealth.sources.indexer.programId}
                                            {' · slot '}{item.task.providerHealth.sources.indexer.indexedSlot ?? t('unavailable')}
                                            {' · lag '}{item.task.providerHealth.sources.indexer.lagSlots ?? t('unavailable')}
                                            {' · '}{item.task.providerHealth.sources.indexer.lastSyncedAt
                                                ? new Date(item.task.providerHealth.sources.indexer.lastSyncedAt).toLocaleString()
                                                : t('unavailable')}
                                            {item.task.providerHealth.sources.indexer.failure
                                                ? ` · ${item.task.providerHealth.sources.indexer.failure}`
                                                : ''}
                                        </span>
                                        <span data-provider-webhook-health={item.task.providerHealth.sources.webhook.state}>
                                            Webhook · {item.task.providerHealth.sources.webhook.state}
                                            {' · '}{item.task.providerHealth.sources.webhook.reason}
                                        </span>
                                        {item.task.providerHealth.trust ? (
                                            <span data-provider-trust-profile="verified">
                                                {item.task.providerHealth.trust.programId}
                                                {' · loader '}{item.task.providerHealth.trust.loaderProgramId}
                                                {' · programData '}{item.task.providerHealth.trust.programDataAddress}
                                                {' · '}{item.task.providerHealth.trust.upgradeAuthority}
                                                {' · bytes '}{item.task.providerHealth.trust.deployedProgramBytesSha256.slice(0, 12)}…
                                                {' · '}{item.task.providerHealth.trust.decoderPackage}
                                                @{item.task.providerHealth.trust.decoderVersion}
                                                {' · '}{item.task.providerHealth.trust.decoderArtifactSha256.slice(0, 12)}…
                                                {' · observation slot '}{item.task.providerHealth.trust.observationSlot}
                                                {' · blockhash '}{item.task.providerHealth.trust.observationBlockhash}
                                                {' · '}{item.task.providerHealth.trust.rpcIndexerCrossCheck}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.authorities?.map((authority) => (
                                            <span
                                                key={`${authority.role}:${authority.publicAuthority ?? authority.verifiedSlot}`}
                                                data-provider-execution-authority={authority.role}
                                                data-custody-status={authority.custodyStatus}
                                            >
                                                {authority.role} · {authority.publicAuthority ?? t('unavailable')}
                                                {' · '}{authority.custodyProvider}/{authority.custodyStatus}
                                                {' · slot '}{authority.verifiedSlot}
                                                {' · '}{authority.allowedOperations.join(', ')}
                                            </span>
                                        ))}
                                        {item.task.providerHealth.providerResourceLifecycle ? (
                                            <span
                                                data-provider-resource-lifecycle={item.task.providerHealth.providerResourceLifecycle.state}
                                                data-provider-resource-lifecycle-phases={item.task.providerHealth.providerResourceLifecycle.phases.map((phase) => phase.phase).join('>')}
                                                role="status"
                                            >
                                                lifecycle {item.task.providerHealth.providerResourceLifecycle.resourceBindingId}
                                                {' · '}{item.task.providerHealth.providerResourceLifecycle.phases.map((phase) => phase.phase).join(' → ')}
                                                {' · fallback authority '}{item.task.providerHealth.providerResourceLifecycle.permissionResidue.fallbackAuthority}
                                                {' · temp wallet '}{item.task.providerHealth.providerResourceLifecycle.permissionResidue.temporaryWalletAuthority}
                                                {' · service key '}{item.task.providerHealth.providerResourceLifecycle.permissionResidue.serviceKeyAuthority}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.reconciliationFallback ? (
                                            <span
                                                data-provider-reconciliation-fallback={item.task.providerHealth.reconciliationFallback.sourceState}
                                                data-provider-reconciliation-fallback-mode={item.task.providerHealth.reconciliationFallback.fallbackMechanism.mode}
                                                data-provider-questioned-self-adjudication={item.task.providerHealth.reconciliationFallback.fallbackMechanism.questionedProviderMayAdjudicate}
                                                data-provider-operator-selects-fallback={item.task.providerHealth.reconciliationFallback.fallbackMechanism.operatorMaySelectProvider}
                                                role="status"
                                            >
                                                reconciliation fallback {item.task.providerHealth.reconciliationFallback.reconciliationAuthorityRef}
                                                {' · decision '}{item.task.providerHealth.reconciliationFallback.decisionAuthorityRef}
                                                {' · resource '}{item.task.providerHealth.reconciliationFallback.affectedObjects.resourceRef}
                                                {' · owner '}{item.task.providerHealth.reconciliationFallback.affectedObjects.ownerProgramRef}
                                                {' · profile '}{item.task.providerHealth.reconciliationFallback.affectedObjects.providerProfileRef ?? 'not asserted'}
                                                @{item.task.providerHealth.reconciliationFallback.affectedObjects.providerProfileVersion ?? 'not asserted'}
                                                {' · corrected '}{item.task.providerHealth.reconciliationFallback.correctedState.source}
                                                {' · superseding '}{item.task.providerHealth.reconciliationFallback.superseding.artifactOwner}
                                                /{item.task.providerHealth.reconciliationFallback.superseding.receiptOwner}
                                                {' · operator provider select '}{item.task.providerHealth.reconciliationFallback.fallbackMechanism.operatorMaySelectProvider ? 'allowed' : 'blocked'}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.authorityPaymentBoundary ? (
                                            <span
                                                data-provider-authority-payment-boundary={item.task.providerHealth.authorityPaymentBoundary.separation}
                                                role="status"
                                            >
                                                authority roles {item.task.providerHealth.authorityPaymentBoundary.executionAuthorityRoles.join(', ')}
                                                {' · payer policy '}{item.task.providerHealth.authorityPaymentBoundary.payerPolicyId}
                                                {' · economic bearer '}{item.task.providerHealth.authorityPaymentBoundary.economicBearer}
                                                {' · sponsor '}{item.task.providerHealth.authorityPaymentBoundary.sponsorRole}
                                                {' · fee payer only · sponsor authority gain: none'}
                                                {' · private key exposure: none'}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.mandateCostPolicy ? (
                                            <span
                                                data-provider-mandate-cost-policy={item.task.providerHealth.mandateCostPolicy.mandateTermsDigest}
                                                role="status"
                                            >
                                                mandate cost policy {item.task.providerHealth.mandateCostPolicy.mandateId}
                                                {' @v'}{item.task.providerHealth.mandateCostPolicy.mandateVersion}
                                                {' · classes '}{item.task.providerHealth.mandateCostPolicy.costClasses.map((cost) => `${cost.costClass}:${cost.economicBearer}`).join(', ')}
                                                {' · special budget '}{item.task.providerHealth.mandateCostPolicy.specialBudget.mode}
                                                {' · payer authority '}{item.task.providerHealth.mandateCostPolicy.payerAuthority}
                                                {' · silent transfer allowed: no'}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.fundingSourceFeePayerBoundary ? (
                                            <span
                                                data-provider-funding-source-fee-payer={item.task.providerHealth.fundingSourceFeePayerBoundary.fundingSourceRole}
                                                role="status"
                                            >
                                                funding source {item.task.providerHealth.fundingSourceFeePayerBoundary.fundingSourceRef}
                                                {' · payer policy '}{item.task.providerHealth.fundingSourceFeePayerBoundary.payerPolicyId}
                                                {' · fee payer '}{item.task.providerHealth.fundingSourceFeePayerBoundary.actualFeePayer}
                                                {' · funding source may sign fees: no'}
                                                {' · approved payment path '}{item.task.providerHealth.fundingSourceFeePayerBoundary.approvedPaymentPath}
                                                {' · reimbursement '}{item.task.providerHealth.fundingSourceFeePayerBoundary.reimbursementPolicy}
                                                {' · executor cash-flow responsibility: forbidden'}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.enforcement ? (
                                            <span
                                                data-provider-residual-bypass-risk={item.task.providerHealth.enforcement.residualBypassRisk}
                                                role="status"
                                            >
                                                {item.task.providerHealth.enforcement.mode}
                                                {' · '}{item.task.providerHealth.enforcement.proofScope}
                                                {' · '}{item.task.providerHealth.enforcement.residualBypassRisk}
                                                {' · '}{item.task.providerHealth.enforcement.allowedOperations.join(', ')}
                                                {' · decision '}{item.task.providerHealth.enforcement.decisionLinkage.decisionDigest.slice(0, 12)}…
                                                {' · bypass prevented: no'}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.costReconciliation ? (
                                            <span data-provider-cost-reconciliation={item.task.providerHealth.costReconciliation.reconciliation}>
                                                payer {item.task.providerHealth.costReconciliation.payerPolicyId}
                                                {' · bearer '}{item.task.providerHealth.costReconciliation.economicBearer}
                                                {' · sponsor '}{item.task.providerHealth.costReconciliation.sponsorRole}
                                                {' · funding '}{item.task.providerHealth.costReconciliation.fundingSource}
                                                {' · rent '}{item.task.providerHealth.costReconciliation.totalDirectRentLamports === null
                                                    ? 'not itemized'
                                                    : `${item.task.providerHealth.costReconciliation.totalDirectRentLamports} lamports`}
                                                {' · total '}{item.task.providerHealth.costReconciliation.totalSpendLamports} lamports
                                                {' · balance '}{item.task.providerHealth.costReconciliation.finalBalanceLamports} lamports
                                                {' · refund '}{item.task.providerHealth.costReconciliation.refund}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.providerCostControlBoundary ? (
                                            <span
                                                data-provider-cost-control-boundary={item.task.providerHealth.providerCostControlBoundary.authority}
                                            >
                                                cost controls {item.task.providerHealth.providerCostControlBoundary.payerPolicyId}
                                                {' · action '}{item.task.providerHealth.providerCostControlBoundary.scope.actionType}
                                                {' · network '}{item.task.providerHealth.providerCostControlBoundary.scope.network}
                                                {' · window '}{item.task.providerHealth.providerCostControlBoundary.timeWindow.scope}
                                                {' · single '}{item.task.providerHealth.providerCostControlBoundary.limits.singleTransactionLamports}
                                                {' · period '}{item.task.providerHealth.providerCostControlBoundary.limits.periodLamports}
                                                {' · balance '}{item.task.providerHealth.providerCostControlBoundary.balance.finalBalanceLamports}
                                                {' · spend ok '}{String(item.task.providerHealth.providerCostControlBoundary.alerts.spendWithinSingleLimit)}
                                                {' · receipt '}{item.task.providerHealth.providerCostControlBoundary.sponsorReceipt.receiptDigest.slice(0, 12)}…
                                                {' · sponsor '}{item.task.providerHealth.providerCostControlBoundary.sponsorReceipt.sponsorRole}
                                                {' · refund '}{item.task.providerHealth.providerCostControlBoundary.sponsorReceipt.refund}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.transactionAttempts ? (
                                            <span data-provider-attempt-context="canonical_provider_attempt_inventory_and_terminal_receipt">
                                                {item.task.providerHealth.transactionAttempts.length} attempts
                                                {' · attempt #'}{item.task.providerHealth.transactionAttempts[0]?.attemptOrdinal}
                                                {' · digest '}{item.task.providerHealth.transactionAttempts[0]?.transactionAttemptDigest}
                                                {' · blockhash '}{item.task.providerHealth.transactionAttempts[0]?.recentBlockhash}
                                                {' · payer policy '}{item.task.providerHealth.transactionAttempts[0]?.feePayerPolicyId}
                                                {' · priority fee '}{item.task.providerHealth.transactionAttempts[0]?.priorityFeeLamports} lamports
                                                {' · priority proof '}{item.task.providerHealth.transactionAttempts[0]?.priorityFeeState}
                                                {' · quote slot '}{item.task.providerHealth.transactionAttempts[0]?.quoteSlot}
                                                {' @ '}{item.task.providerHealth.transactionAttempts[0]?.quotedAt}
                                                {' · resimulation '}{item.task.providerHealth.transactionAttempts[0]?.resimulationTrigger}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.attemptOwner ? (
                                            <span data-provider-attempt-owner="canonical_cost_preflight">
                                                preflight {item.task.providerHealth.attemptOwner.preflightId}
                                                {' · action intent '}{item.task.providerHealth.attemptOwner.actionIntentDigest.slice(0, 12)}…
                                                {' · transaction attempt '}{item.task.providerHealth.attemptOwner.transactionAttemptDigest.slice(0, 12)}…
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.retryBoundary ? (
                                            <span data-provider-retry-boundary="canonical_action_intent_and_transaction_attempt">
                                                same-intent retry {item.task.providerHealth.retryBoundary.sameIntentRetry.allowedChanges.join(', ')}
                                                {' · action set '}{item.task.providerHealth.retryBoundary.actionSetDigest.slice(0, 12)}…
                                                {' · material change '}{item.task.providerHealth.retryBoundary.materialChangesRequire}
                                                {' · automatic material mutation: no'}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.humanReadableActions ? (
                                            <span
                                                data-provider-human-readable-action={item.task.providerHealth.humanReadableActions[0]?.operation}
                                                data-provider-asset-change={item.task.providerHealth.humanReadableActions[0]?.assetChange}
                                            >
                                                {item.task.providerHealth.humanReadableActions.length} verified actions
                                                {' · '}{item.task.providerHealth.humanReadableActions[0]?.summary}
                                                {' · asset change '}{item.task.providerHealth.humanReadableActions[0]?.assetChange}
                                                {' · simulation '}{item.task.providerHealth.humanReadableActions[0]?.simulation}
                                                {' · enforcement '}{item.task.providerHealth.humanReadableActions[0]?.enforcement}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.executionPlanReadback ? (
                                            <div
                                                data-provider-execution-plan="canonical_request_cost_preflight_provider_plan_and_terminal_receipt"
                                                data-provider-execution-mode={item.task.providerHealth.executionPlanReadback.executionMode}
                                                role="status"
                                            >
                                                <strong>provider execution plan</strong>
                                                <span>
                                                    {item.task.providerHealth.executionPlanReadback.actions.length} ordered actions
                                                    {' · request '}{item.task.providerHealth.executionPlanReadback.requestId}
                                                    {' · decision '}{item.task.providerHealth.executionPlanReadback.decisionDigest.slice(0, 12)}…
                                                    {' · intent '}{item.task.providerHealth.executionPlanReadback.actionIntentDigest.slice(0, 12)}…
                                                    {' · plan '}{item.task.providerHealth.executionPlanReadback.planDigest.slice(0, 12)}…
                                                </span>
                                                <span>
                                                    first action {item.task.providerHealth.executionPlanReadback.actions[0]?.humanSummary}
                                                    {' · attempt '}{item.task.providerHealth.executionPlanReadback.actions[0]?.attempts[0]?.status}
                                                    {' @ slot '}{item.task.providerHealth.executionPlanReadback.actions[0]?.attempts[0]?.slot}
                                                    {' · blockhash retry-only'}
                                                </span>
                                                <span
                                                    data-provider-duplicate-prevention={item.task.providerHealth.executionPlanReadback.duplicatePrevention.state}
                                                >
                                                    duplicate action observed: no
                                                    {' · idempotency keys '}{item.task.providerHealth.executionPlanReadback.duplicatePrevention.actionIdempotencyKeys.length}
                                                    {' · provider references '}{item.task.providerHealth.executionPlanReadback.duplicatePrevention.providerReferences.length}
                                                    {' · duplicate payment '}{item.task.providerHealth.executionPlanReadback.duplicatePrevention.duplicatePaymentObserved}
                                                </span>
                                            </div>
                                        ) : null}
                                        {item.task.providerHealth.providerActionSafetyBoundary ? (
                                            <div
                                                data-provider-action-safety="reviewed_provider_adapter_instruction_safety"
                                                data-provider-opaque-auto-execution="false"
                                                role="status"
                                            >
                                                <strong>provider action safety boundary</strong>
                                                <span>
                                                    reviewed adapter {item.task.providerHealth.providerActionSafetyBoundary.reviewedAdapter}
                                                    {' · actions '}{item.task.providerHealth.providerActionSafetyBoundary.actionCount}
                                                    {' · programs '}{item.task.providerHealth.providerActionSafetyBoundary.programAllowlist.join(', ')}
                                                </span>
                                                <span>
                                                    asset conservation {item.task.providerHealth.providerActionSafetyBoundary.checks.assetConservation}
                                                    {' · max outflow '}{item.task.providerHealth.providerActionSafetyBoundary.checks.maxOutflowLamports}
                                                    {' · simulation required: yes'}
                                                    {' · material changes require '}{item.task.providerHealth.providerActionSafetyBoundary.retryMaterialChangeGate}
                                                </span>
                                            </div>
                                        ) : null}
                                        {item.task.providerHealth.servicePayerAuthorityBoundary ? (
                                            <div
                                                data-provider-service-payer-boundary={item.task.providerHealth.servicePayerAuthorityBoundary.authority}
                                                role="status"
                                            >
                                                <strong>service payer authority boundary</strong>
                                                <span>
                                                    fee scope {item.task.providerHealth.servicePayerAuthorityBoundary.feeScope}
                                                    {' · payer policy '}{item.task.providerHealth.servicePayerAuthorityBoundary.payerPolicyId}
                                                    {' · sponsor authority gain '}{item.task.providerHealth.servicePayerAuthorityBoundary.sponsorAuthorityGain}
                                                    {' · actual payer '}{item.task.providerHealth.servicePayerAuthorityBoundary.actualFeePayer}
                                                </span>
                                                <span>
                                                    controls token/metadata/program/governance authority: no
                                                    {' · mint/freeze/update source '}{item.task.providerHealth.servicePayerAuthorityBoundary.mintFreezeUpdateAuthoritySource}
                                                    {' · restricted mint op '}{item.task.providerHealth.servicePayerAuthorityBoundary.restrictedMintOperation}
                                                    {' · universal key allowed '}{String(item.task.providerHealth.servicePayerAuthorityBoundary.longLivedUniversalKeyAllowed)}
                                                    {' · material authority change '}{item.task.providerHealth.servicePayerAuthorityBoundary.materialAuthorityChangeRequires}
                                                </span>
                                                <span>
                                                    cost readback {item.task.providerHealth.servicePayerAuthorityBoundary.costReadback.totalSpendLamports} lamports
                                                    {' · direct rent '}{item.task.providerHealth.servicePayerAuthorityBoundary.costReadback.totalDirectRentLamports === null
                                                        ? 'not itemized'
                                                        : `${item.task.providerHealth.servicePayerAuthorityBoundary.costReadback.totalDirectRentLamports} lamports`}
                                                    {' · refund '}{item.task.providerHealth.servicePayerAuthorityBoundary.costReadback.refund}
                                                </span>
                                            </div>
                                        ) : null}
                                        {item.task.providerHealth.assetAuthoritySponsorBoundary ? (
                                            <span
                                                data-provider-asset-authority-sponsor-boundary={item.task.providerHealth.assetAuthoritySponsorBoundary.authority}
                                            >
                                                asset authority {item.task.providerHealth.assetAuthoritySponsorBoundary.assetAuthority.ownerIssuerMintFreezeUpdateSource}
                                                {' · sponsor '}{item.task.providerHealth.assetAuthoritySponsorBoundary.sponsorRole}
                                                {' · authority gain '}{item.task.providerHealth.assetAuthoritySponsorBoundary.sponsorSeparation.sponsorAuthorityGain}
                                                {' · controls token/metadata/program/governance: no'}
                                                {' · signer exposed '}{String(item.task.providerHealth.assetAuthoritySponsorBoundary.sponsorSeparation.feePayerSignerRefExposed)}
                                                {' · outflow '}{item.task.providerHealth.assetAuthoritySponsorBoundary.assetAuthority.currentActionAssetOutflow}
                                                {' · receipt '}{item.task.providerHealth.assetAuthoritySponsorBoundary.sponsorReceiptDigest.slice(0, 12)}…
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.proposalTransactionReadback ? (
                                            <div
                                                data-provider-proposal-transaction-readback="provider_receipt_and_independent_finalized_readback"
                                                data-provider-proposal-execution-status={item.task.providerHealth.proposalTransactionReadback.executionStatus}
                                                role="status"
                                            >
                                                <strong>provider proposal transaction readback</strong>
                                                <span>
                                                    proposal {item.task.providerHealth.proposalTransactionReadback.proposalRef}
                                                    {' · transaction '}{item.task.providerHealth.proposalTransactionReadback.proposalTransactionRef}
                                                    {' · commitment '}{item.task.providerHealth.proposalTransactionReadback.commitment}
                                                </span>
                                                <span>
                                                    {item.task.providerHealth.proposalTransactionReadback.instructions.length} instructions
                                                    {' · signature '}{item.task.providerHealth.proposalTransactionReadback.instructions[0]?.signature}
                                                    {' · slot '}{item.task.providerHealth.proposalTransactionReadback.instructions[0]?.slot}
                                                    {' · status '}{item.task.providerHealth.proposalTransactionReadback.instructions[0]?.executionStatus}
                                                </span>
                                            </div>
                                        ) : null}
                                        {item.task.providerHealth.actionContexts ? (
                                            <span
                                                data-provider-action-context="provider_plan_and_attempt_checkpoint"
                                                data-provider-action-count={item.task.providerHealth.actionContexts.length}
                                            >
                                                {item.task.providerHealth.actionContexts.length} ordered actions
                                                {' · aggregate '}{item.task.providerHealth.actionContexts[0]?.aggregateRule}
                                                {' · next deadline block height '}{item.task.providerHealth.actionContexts[0]?.deadline.value}
                                                {' · atomic '}{item.task.providerHealth.actionContexts[0]?.atomicity}
                                            </span>
                                        ) : null}
                                        {item.task.providerHealth.blocker ? (
                                            <span role="status">{item.task.providerHealth.blocker}</span>
                                        ) : null}
                                        {item.task.providerHealth.incident ? (
                                            <GovernanceProviderIncidentStatus
                                                incident={item.task.providerHealth.incident}
                                            />
                                        ) : null}
                                        {item.task.providerHealth.expiredAttempts?.length ? (
                                            <ol data-provider-expired-attempt-history="canonical_cost_preflight_checkpoint">
                                                {item.task.providerHealth.expiredAttempts.map((attempt) => (
                                                    <li key={attempt.messageDigest}>
                                                        <code>{attempt.stepId} · {attempt.messageDigest.slice(0, 12)}…</code>
                                                        {' · '}{attempt.lastValidBlockHeight} → {attempt.expiredAtBlockHeight}
                                                        {' · '}{attempt.disposition}
                                                    </li>
                                                ))}
                                            </ol>
                                        ) : null}
                                        {item.task.providerHealth.preSignStatePreconditions?.length ? (
                                            <ol data-provider-pre-sign-state="independent_provider_readback_before_transit_sign">
                                                {item.task.providerHealth.preSignStatePreconditions.map((precondition) => (
                                                    <li key={precondition.digest}>
                                                        <code>{precondition.stepId} · {precondition.providerStateDigest.slice(0, 12)}…</code>
                                                        {' · slot '}{precondition.observedSlot}
                                                        {' · payer '}{precondition.feePayerBalanceLamports} lamports
                                                        {' · owners '}{precondition.canonicalOwnerState.stateDigest.slice(0, 12)}…
                                                        {' · freeze '}{precondition.canonicalOwnerState.emergencyFreeze}
                                                        <span
                                                            data-provider-instruction-safety={precondition.instructionSafety.simulation}
                                                            data-provider-opaque-instructions={precondition.instructionSafety.opaqueInstructions}
                                                        >
                                                            {' · program '}{precondition.instructionSafety.programIds.join(', ')}
                                                            {' · outflow '}{precondition.instructionSafety.assetOutflowLamports}
                                                        </span>
                                                        {' · '}{precondition.digest.slice(0, 12)}…
                                                    </li>
                                                ))}
                                            </ol>
                                        ) : null}
                                    </div>
                                ) : null}
                                {item.task.providerRecovery ? (
                                    <GovernanceExecutionRecoveryStatus
                                        recovery={{
                                            blocker: null,
                                            ...item.task.providerRecovery,
                                        }}
                                        boundaryText={caseT('recovery.boundary')}
                                        blockerText={null}
                                    />
                                ) : null}
                                {item.task.deadline ? (
                                    <p className={styles.deadline}>
                                        <Clock3 size={15} />
                                        {t('deadline', { value: new Date(item.task.deadline).toLocaleString() })}
                                    </p>
                                ) : null}
                                {item.task.disabledReason ? (
                                    <p className={styles.reason}>{taskReasonLabel(item.task.disabledReason)}</p>
                                ) : null}
                                <Link
                                    href={taskCaseHref(item, filters, currentPage)}
                                    className={styles.openCase}
                                    onClick={() => window.sessionStorage.setItem(viewKey, String(window.scrollY))}
                                >
                                    {taskActionLabel(item.task.primaryAction)}
                                    <ArrowRight size={17} />
                                </Link>
                            </article>
                        ))}
                    </section>
                    {totalPages > 1 ? (
                        <nav className={styles.pagination} aria-label={paginationT('aria')}>
                            <button
                                type="button"
                                disabled={currentPage === 1}
                                onClick={() => selectPage(currentPage - 1)}
                            >{paginationT('previous')}</button>
                            <span>{paginationT('page', { page: currentPage, total: totalPages })}</span>
                            <button
                                type="button"
                                disabled={currentPage === totalPages}
                                onClick={() => selectPage(currentPage + 1)}
                            >{paginationT('next')}</button>
                        </nav>
                    ) : null}
                </>
            )}
        </main>
    );
}
