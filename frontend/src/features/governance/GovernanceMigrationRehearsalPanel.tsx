'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, ShieldCheck } from 'lucide-react';

import {
    exportCircleGovernanceMigrationAudit,
    fetchCircleGovernanceMigrationReport,
    finalizeCircleGovernanceMigration,
    prepareCircleGovernanceMigrationDryRun,
    type GovernanceLegacyMigrationReport,
} from '@/lib/api/governance';
import { useI18n } from '@/i18n/useI18n';
import styles from './GovernanceMigrationRehearsalPanel.module.css';

const MIGRATION_REDLINE_KEYS = [
    'programGuardLockComplete',
    'residualLegacyBypassZero',
    'compatibilityBlockersCleared',
    'historicalAutomaticReexecutionForbidden',
    'activeRecoveryFactsClear',
] as const;

export default function GovernanceMigrationRehearsalPanel({
    circleId,
    canRun,
    autoRead,
    executeOwnerLock,
}: {
    circleId: number;
    canRun: boolean;
    autoRead: boolean;
    executeOwnerLock: ((
        intent: NonNullable<GovernanceLegacyMigrationReport['ownerLockIntent']>,
    ) => Promise<string>) | null;
}) {
    const t = useI18n('GovernanceCases');
    const [report, setReport] = useState<GovernanceLegacyMigrationReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [cutoverError, setCutoverError] = useState(false);
    const [cuttingOver, setCuttingOver] = useState(false);
    const [pendingSignature, setPendingSignature] = useState<string | null>(null);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(false);
    const autoReadCircle = useRef<number | null>(null);

    const load = useCallback(async (mode: 'prepare' | 'read') => {
        if (loading) return;
        setLoading(true);
        setError(false);
        setCutoverError(false);
        try {
            setReport(mode === 'prepare'
                ? await prepareCircleGovernanceMigrationDryRun(circleId)
                : await fetchCircleGovernanceMigrationReport(circleId));
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [circleId, loading]);

    useEffect(() => {
        if (!autoRead || !canRun || autoReadCircle.current === circleId) return;
        autoReadCircle.current = circleId;
        void load('read');
    }, [autoRead, canRun, circleId, load]);

    if (!canRun) return null;

    const cutover = async () => {
        if (
            report?.state !== 'compatibility_ready'
            || !report.ownerLockIntent
            || !report.cutoverAction.walletSignatureAllowed
            || !executeOwnerLock
            || cuttingOver
        ) return;
        setCuttingOver(true);
        setCutoverError(false);
        try {
            const transactionSignature = pendingSignature
                ?? await executeOwnerLock(report.ownerLockIntent);
            setPendingSignature(transactionSignature);
            const finalized = await finalizeCircleGovernanceMigration({
                circleId,
                compatibilityBundleId: report.compatibilityBundleId,
                transactionSignature,
            });
            setReport(finalized);
            setPendingSignature(null);
        } catch {
            setCutoverError(true);
        } finally {
            setCuttingOver(false);
        }
    };

    const downloadMigrationAudit = async () => {
        if (!report || exporting) return;
        setExporting(true);
        setExportError(false);
        try {
            const value = await exportCircleGovernanceMigrationAudit(circleId);
            const objectUrl = URL.createObjectURL(new Blob(
                [JSON.stringify(value, null, 2)],
                { type: 'application/json' },
            ));
            try {
                const anchor = document.createElement('a');
                anchor.href = objectUrl;
                anchor.download = `circle-${circleId}-governance-migration-audit.json`;
                anchor.click();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch {
            setExportError(true);
        } finally {
            setExporting(false);
        }
    };

    return (
        <section className={styles.root} aria-labelledby="governance-migration-rehearsal-title">
            <header className={styles.header}>
                <div>
                    <p>{t('migration.eyebrow')}</p>
                    <h2 id="governance-migration-rehearsal-title">{t('migration.title')}</h2>
                </div>
                <ShieldCheck size={22} aria-hidden="true" />
            </header>
            <p className={styles.boundary}>{t('migration.boundary')}</p>
            <div className={styles.actions}>
                <button type="button" disabled={loading} onClick={() => void load('prepare')}>
                    <RefreshCw size={17} className={loading ? styles.spin : undefined} aria-hidden="true" />
                    {loading ? t('migration.running') : t('migration.run')}
                </button>
                {report ? (
                    <>
                        <button type="button" disabled={loading} onClick={() => void load('read')}>
                            {t('migration.refresh')}
                        </button>
                        <button
                            type="button"
                            data-migration-audit-export="circle_manager"
                            disabled={loading || exporting}
                            onClick={() => void downloadMigrationAudit()}
                        >
                            <Download size={17} aria-hidden="true" />
                            {exporting ? t('migration.exporting') : t('migration.export')}
                        </button>
                    </>
                ) : null}
                {report?.state === 'compatibility_ready'
                    && report.cutoverAction.walletSignatureAllowed
                    && report.ownerLockIntent ? (
                    <button
                        type="button"
                        disabled={loading || cuttingOver || !executeOwnerLock}
                        onClick={() => void cutover()}
                    >
                        <ShieldCheck size={17} aria-hidden="true" />
                        {cuttingOver
                            ? t('migrationCutover.cuttingOver')
                            : pendingSignature
                                ? t('migrationCutover.retryFinalize')
                                : t('migrationCutover.cutover')}
                    </button>
                ) : null}
            </div>
            {error ? <p className={styles.error} role="alert">{t('migration.error')}</p> : null}
            {exportError ? <p className={styles.error} role="alert">{t('migration.exportError')}</p> : null}
            {cutoverError ? (
                <p className={styles.error} role="alert">
                    {pendingSignature
                        ? t('migrationCutover.finalizeError')
                        : t('migrationCutover.cutoverError')}
                </p>
            ) : null}
            {report ? (
                <div className={styles.report} data-migration-state={report.state}>
                    <dl className={styles.summary}>
                        <div><dt>{t('migration.state')}</dt><dd>{t(`migration.states.${report.state}`)}</dd></div>
                        <div><dt>{t('migration.bundle')}</dt><dd title={report.compatibilityBundleDigest}>{shortDigest(report.compatibilityBundleDigest)}</dd></div>
                        <div><dt>{t('migration.historyAudit')}</dt><dd title={report.historicalExecutionBoundary.auditDigest}>{shortDigest(report.historicalExecutionBoundary.auditDigest)}</dd></div>
                        <div>
                            <dt>{t('migrationCutover.actionState')}</dt>
                            <dd data-cutover-action={report.cutoverAction.status}>
                                {t(`migrationCutover.actionStates.${report.cutoverAction.status}`)}
                            </dd>
                        </div>
                    </dl>
                    <p className={styles.cutoverAction} data-cutover-next-action={report.cutoverAction.nextAction}>
                        {t(`migrationCutover.nextActions.${report.cutoverAction.nextAction}`)}
                    </p>
                    <p className={styles.historyBoundary} data-history-policy={report.historicalExecutionBoundary.policy}>
                        {t('migration.historyBoundary', {
                            requests: report.historicalExecutionBoundary.governanceRequestRefs.length,
                            proposals: report.historicalExecutionBoundary.transferProposalRefs.length,
                            jobs: report.historicalExecutionBoundary.crystalAssetJobRefs.length,
                        })}
                    </p>
                    <section
                        className={styles.readiness}
                        aria-labelledby="governance-migration-readiness-title"
                        data-migration-readiness={report.migrationReadiness.status}
                    >
                        <div className={styles.readinessHeader}>
                            <div>
                                <h3 id="governance-migration-readiness-title">{t('migrationReadiness.title')}</h3>
                                <strong>{t(`migrationReadiness.statuses.${report.migrationReadiness.status}`)}</strong>
                            </div>
                            <span title={report.migrationReadiness.auditDigest}>
                                {shortDigest(report.migrationReadiness.auditDigest)}
                            </span>
                        </div>
                        <dl className={styles.readinessMetrics}>
                            <div>
                                <dt>{t('migrationReadiness.metrics.programGuardsLocked')}</dt>
                                <dd>{report.migrationReadiness.metrics.programGuardsLocked}/{report.migrationReadiness.metrics.actionsTotal}</dd>
                            </div>
                            <div>
                                <dt>{t('migrationReadiness.metrics.residualLegacyBypass')}</dt>
                                <dd>{report.migrationReadiness.metrics.residualLegacyBypass}</dd>
                            </div>
                            <div>
                                <dt>{t('migrationReadiness.metrics.blockingCompatibilityFacts')}</dt>
                                <dd>{report.migrationReadiness.metrics.blockingCompatibilityFacts}</dd>
                            </div>
                            <div>
                                <dt>{t('migrationReadiness.metrics.protectedHistoricalRecords')}</dt>
                                <dd>{report.migrationReadiness.metrics.protectedHistoricalRecords}</dd>
                            </div>
                            <div>
                                <dt>{t('migrationReadiness.metrics.activeRecoveryFacts')}</dt>
                                <dd>{report.migrationReadiness.metrics.activeRecoveryFacts}</dd>
                            </div>
                        </dl>
                        <ul aria-label={t('migrationReadiness.list')}>
                            {MIGRATION_REDLINE_KEYS.map((key) => {
                                const passed = report.migrationReadiness.redlines[key];
                                return (
                                    <li key={key} data-redline-status={passed ? 'pass' : 'hold'}>
                                        <span>{t(`migrationReadiness.redlines.${key}`)}</span>
                                        <strong>{t(`migrationReadiness.${passed ? 'pass' : 'hold'}`)}</strong>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                    <section className={styles.auditTimeline} aria-labelledby="governance-migration-audit-title">
                        <div className={styles.auditHeader}>
                            <h3 id="governance-migration-audit-title">{t('migrationAudit.title')}</h3>
                            <span title={report.auditTimeline.auditDigest}>
                                {shortDigest(report.auditTimeline.auditDigest)}
                            </span>
                        </div>
                        <ol aria-label={t('migrationAudit.list')}>
                            {report.auditTimeline.events.map((entry) => (
                                <li
                                    key={`${entry.eventType}:${entry.occurredAt}`}
                                    data-audit-event={entry.eventType}
                                    data-audit-state={entry.state}
                                >
                                    <strong>{t(`migrationAudit.events.${entry.eventType}`)}</strong>
                                    <time dateTime={entry.occurredAt}>{entry.occurredAt}</time>
                                    <span title={entry.recordRef}>
                                        {t('migrationAudit.record')}: {shortReference(entry.recordRef)}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </section>
                    <section
                        id="governance-migration-recovery"
                        className={styles.recovery}
                        aria-labelledby="governance-migration-recovery-title"
                    >
                        <div className={styles.recoveryHeader}>
                            <h3 id="governance-migration-recovery-title">{t('migrationRecovery.title')}</h3>
                            <span title={report.recoveryRehearsal.auditDigest}>
                                {shortDigest(report.recoveryRehearsal.auditDigest)}
                            </span>
                        </div>
                        <div className={styles.recoveryGrid} role="list" aria-label={t('migrationRecovery.list')}>
                            {report.recoveryRehearsal.scenarios.map((entry) => (
                                <article key={entry.scenario} role="listitem" data-recovery-scenario={entry.scenario}>
                                    <strong>{t(`migrationRecovery.scenarios.${entry.scenario}`)}</strong>
                                    <span>{t('migrationRecovery.blocker')}: {t(`migrationRecovery.blockers.${entry.blocker}`)}</span>
                                    <span>{t('migrationRecovery.action')}: {t(`migrationRecovery.actions.${entry.recoveryAction}`)}</span>
                                    <span>{t(`migrationRecovery.retryModes.${entry.retryMode}`)}</span>
                                </article>
                            ))}
                        </div>
                        <div className={styles.currentFacts}>
                            <h4>{t('migrationRecovery.currentFacts')}</h4>
                            {report.recoveryRehearsal.currentFacts.length === 0 ? (
                                <p data-recovery-current-state="clear">
                                    {t('migrationRecovery.noCurrentFacts')}
                                </p>
                            ) : (
                                <div role="list" aria-label={t('migrationRecovery.currentFacts')}>
                                    {report.recoveryRehearsal.currentFacts.map((fact) => (
                                        <article
                                            key={`${fact.scenario}:${fact.caseId}:${fact.requestId}`}
                                            role="listitem"
                                            data-recovery-current-fact={fact.scenario}
                                            data-recovery-current-state={fact.state}
                                        >
                                            <strong>{t(`migrationRecovery.scenarios.${fact.scenario}`)}</strong>
                                            <span>{t('migrationRecovery.state')}: {t(`migrationRecovery.states.${fact.state}`)}</span>
                                            <Link
                                                className={styles.caseLink}
                                                data-recovery-source-case={fact.caseId}
                                                href={`/governance/cases/${encodeURIComponent(fact.caseId)}`}
                                            >
                                                {t('migrationRecovery.openSourceCase')}: {shortReference(fact.caseId)}
                                            </Link>
                                            <span title={fact.requestId}>{t('migrationRecovery.request')}: {shortReference(fact.requestId)}</span>
                                            <span>{t('migrationRecovery.action')}: {t(`migrationRecovery.actions.${fact.recoveryAction}`)}</span>
                                            {fact.provider ? <span>{t('migrationRecovery.provider')}: {fact.provider}</span> : null}
                                            {fact.authorityBindingId ? (
                                                <span title={fact.authorityBindingId}>
                                                    {t('migrationRecovery.authorityBinding')}: {shortReference(fact.authorityBindingId)}
                                                </span>
                                            ) : null}
                                            {fact.authorityEvidenceDigest ? (
                                                <span title={fact.authorityEvidenceDigest}>
                                                    {t('migrationRecovery.authorityEvidence')}: {shortDigest(fact.authorityEvidenceDigest)}
                                                </span>
                                            ) : null}
                                            {fact.affectedActorPubkey ? (
                                                <span title={fact.affectedActorPubkey}>
                                                    {t('migrationRecovery.affectedActor')}: {shortReference(fact.affectedActorPubkey)}
                                                </span>
                                            ) : null}
                                            {fact.evidenceRef ? (
                                                <span title={fact.evidenceRef}>
                                                    {t('migrationRecovery.evidence')}: {shortReference(fact.evidenceRef)}
                                                </span>
                                            ) : null}
                                            {fact.observedAt ? (
                                                <time dateTime={fact.observedAt}>
                                                    {t('migrationRecovery.observedAt')}: {fact.observedAt}
                                                </time>
                                            ) : null}
                                            {fact.providerObservedSlot !== null ? (
                                                <span>{t('migrationRecovery.providerSlot')}: {fact.providerObservedSlot}</span>
                                            ) : null}
                                            {fact.indexedSlot !== null ? (
                                                <span>{t('migrationRecovery.indexedSlot')}: {fact.indexedSlot}</span>
                                            ) : null}
                                            {fact.completedSteps !== null && fact.remainingSteps !== null ? (
                                                <span>{t('migrationRecovery.progress', {
                                                    completed: fact.completedSteps,
                                                    remaining: fact.remainingSteps,
                                                })}</span>
                                            ) : null}
                                            {fact.freezeEndsAt ? (
                                                <time dateTime={fact.freezeEndsAt}>
                                                    {t('migrationRecovery.freezeEndsAt')}: {fact.freezeEndsAt}
                                                </time>
                                            ) : null}
                                            {fact.reviewDueAt ? (
                                                <time dateTime={fact.reviewDueAt}>
                                                    {t('migrationRecovery.reviewDueAt')}: {fact.reviewDueAt}
                                                </time>
                                            ) : null}
                                            {fact.reviewStatus ? (
                                                <span>
                                                    {t('migrationRecovery.reviewStatus')}: {t(`migrationRecovery.reviewStatuses.${fact.reviewStatus}`)}
                                                </span>
                                            ) : null}
                                            {fact.authorityContinuity ? (
                                                <span
                                                    data-recovery-authority-continuity={fact.authorityContinuity.state}
                                                    data-recovery-signer-wait-exceeded={String(fact.authorityContinuity.signerWaitExceeded)}
                                                    data-recovery-circle-owner-admin-fallback={String(fact.authorityContinuity.circleOwnerAdminFallbackAllowed)}
                                                >
                                                    {t('migrationRecovery.authorityContinuity')}: {t(`migrationRecovery.authorityContinuityStates.${fact.authorityContinuity.state}`)}
                                                    {' · '}
                                                    {t('migrationRecovery.noFallback')}
                                                </span>
                                            ) : null}
                                            <span
                                                data-recovery-authority-disposition={fact.authorityDisposition.recoveryState}
                                                data-recovery-resource-authority={fact.authorityDisposition.resourceAuthority}
                                                data-recovery-provider-readback={fact.authorityDisposition.providerReadback}
                                                data-recovery-fallback-authority={fact.authorityDisposition.fallbackAuthority}
                                            >
                                                authority disposition: {fact.authorityDisposition.recoveryState}
                                            </span>
                                            <span data-recovery-unfulfilled-obligations={fact.authorityDisposition.unfulfilledObligations.join(',')}>
                                                unfulfilled: {fact.authorityDisposition.unfulfilledObligations.join(', ')}
                                            </span>
                                            <span data-recovery-residual-risks={fact.authorityDisposition.residualRisks.join(',')}>
                                                risk: {fact.authorityDisposition.residualRisks.join(', ')}
                                            </span>
                                        </article>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                    <div className={styles.matrix} role="list" aria-label={t('migration.matrix')}>
                        {report.authorityMatrix.map((entry) => (
                            <article key={entry.actionType} role="listitem">
                                <strong>{t(`migration.actions.${entry.actionType}`)}</strong>
                                <span>{t('migration.before')}: {entry.before.disposition}</span>
                                <span>{t('migration.after')}: {entry.after?.disposition ?? t('migration.notCutOver')}</span>
                                <span>{entry.programGuardLocked
                                    ? t('migration.guardLocked')
                                    : t('migration.guardPending')}</span>
                            </article>
                        ))}
                    </div>
                    <p className={styles.rollback} data-rollback-boundary={report.historicalExecutionBoundary.rollback}>
                        {report.historicalExecutionBoundary.rollback === 'pre_cutover_no_effect_history_remains_read_only'
                            ? t('migration.rollbackPreCutover')
                            : t('migration.rollbackPostCutover')}
                    </p>
                    <dl
                        className={styles.readinessMetrics}
                        data-chain-recovery-boundary={report.chainRecoveryBoundary.allowedRecovery}
                        data-chain-recovery-authority={report.chainRecoveryBoundary.authority}
                        data-chain-recovery-verified-rollback={report.chainRecoveryBoundary.verifiedRollbackPath}
                        data-chain-db-rollback-claim={String(report.chainRecoveryBoundary.databaseRollbackMayClaimChainRecovery)}
                    >
                        <div>
                            <dt>Chain recovery</dt>
                            <dd>{report.chainRecoveryBoundary.allowedRecovery}</dd>
                        </div>
                        <div>
                            <dt>Verified rollback path</dt>
                            <dd>{report.chainRecoveryBoundary.verifiedRollbackPath}</dd>
                        </div>
                        <div>
                            <dt>DB rollback may claim chain recovery</dt>
                            <dd>{String(report.chainRecoveryBoundary.databaseRollbackMayClaimChainRecovery)}</dd>
                        </div>
                    </dl>
                    {report.blockers.length > 0 ? (
                        <p className={styles.blockers}>{t('migration.blockers', { count: report.blockers.length })}</p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function shortDigest(value: string): string {
    return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function shortReference(value: string): string {
    return value.length > 30 ? `${value.slice(0, 14)}…${value.slice(-10)}` : value;
}
