'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, History, Landmark, RefreshCw, ShieldCheck } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import {
    fetchGovernedActionOperationDetail,
    type GovernedActionOperationDetail,
} from '@/lib/api/governance';
import styles from './page.module.css';

function dateTime(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—';
}

function shortDigest(value: string): string {
    return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export default function GovernanceOperationDetailPage() {
    const params = useParams();
    const t = useI18n('GovernanceOperations');
    const appealBoundaryT = useI18n('GovernedActionAppealBoundary');
    const circleId = Number(params.circleId);
    const receiptId = decodeURIComponent(String(params.receiptId || ''));
    const [operation, setOperation] = useState<GovernedActionOperationDetail | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        if (!Number.isSafeInteger(circleId) || circleId <= 0 || !receiptId) {
            setLoading(false);
            return () => { active = false; };
        }
        fetchGovernedActionOperationDetail(circleId, receiptId)
            .then((value) => { if (active) setOperation(value); })
            .catch(() => { if (active) setOperation(null); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [circleId, receiptId]);

    if (loading) {
        return <main className={styles.state}><RefreshCw size={20} className={styles.spin} />{t('loading')}</main>;
    }
    if (!operation) {
        return <main className={styles.state} role="alert">{t('notFound')}</main>;
    }
    const appeal = operation.appeal.currentActorAppeal;
    const appealRouting = operation.appeal.routing;

    return (
        <main className={styles.page} data-testid="governance-operation-detail">
            <Link href={`/circles/${circleId}?tab=governance`} className={styles.back}>
                <ArrowLeft size={16} />{t('back')}
            </Link>
            <header className={styles.header}>
                <Landmark size={27} />
                <div>
                    <p>{t('eyebrow')}</p>
                    <h1>{operation.actionType}</h1>
                    <code>{operation.receipt.id}</code>
                </div>
                <div className={styles.badges}>
                    <span>{operation.receipt.executionStatus}</span>
                    <span data-effect-state={operation.effect.state}>{operation.effect.state}</span>
                </div>
            </header>
            <p className={styles.boundary}><ShieldCheck size={17} />{t('integrityBoundary')}</p>

            <section className={styles.panel} data-testid="governance-operation-execution-boundary">
                <h2>{t('executionBoundary')}</h2>
                <p>{t('executionBoundarySummary')}</p>
                <dl>
                    <div><dt>{t('operationAuthority')}</dt><dd>{operation.executionBoundary.operationAuthority}</dd></div>
                    <div><dt>{t('governanceAuthority')}</dt><dd>{operation.executionBoundary.votingAuthority} · {operation.executionBoundary.proposalMutationAuthority} · {operation.executionBoundary.authorshipAuthority} · {operation.executionBoundary.circleAuthority}</dd></div>
                    <div><dt>{t('payerAuthority')}</dt><dd>{operation.executionBoundary.payerAuthority}</dd></div>
                    <div><dt>{t('serviceRoleAuthority')}</dt><dd>{operation.executionBoundary.serviceRoleAuthority}</dd></div>
                    <div><dt>{t('providerBoundary')}</dt><dd>{operation.executionBoundary.provider.adapter} · {operation.executionBoundary.provider.authority} · {operation.executionBoundary.provider.authoritativeFinality}</dd></div>
                </dl>
            </section>

            <section className={styles.grid}>
                <article>
                    <h2>{t('authority')}</h2>
                    <dl>
                        <div><dt>{t('source')}</dt><dd>{operation.authority.sourceType} · {operation.authority.sourceRef}</dd></div>
                        <div><dt>{t('binding')}</dt><dd>{operation.authority.binding.id} · {operation.authority.binding.status}</dd></div>
                        <div><dt>{t('validity')}</dt><dd>{dateTime(operation.authority.validFrom)} — {dateTime(operation.authority.validUntil)}</dd></div>
                        <div><dt>{t('digest')}</dt><dd><code>{shortDigest(operation.authority.snapshotDigest)}</code></dd></div>
                    </dl>
                </article>
                <article>
                    <h2>{t('receipt')}</h2>
                    <dl>
                        <div><dt>{t('subject')}</dt><dd>{operation.invocation.subjectType} · {operation.invocation.subjectRef}</dd></div>
                        <div><dt>{t('policy')}</dt><dd>{operation.receipt.policyVersionRef}</dd></div>
                        <div><dt>{t('execution')}</dt><dd>{operation.contract.executionAdapter} · {operation.contract.executionDomain}</dd></div>
                        <div><dt>{t('completed')}</dt><dd>{dateTime(operation.receipt.completedAt)}</dd></div>
                        <div><dt>{t('digest')}</dt><dd><code>{shortDigest(operation.receipt.receiptDigest)}</code></dd></div>
                    </dl>
                </article>
                <article>
                    <h2>{t('effect')}</h2>
                    <dl>
                        <div><dt>{t('currentState')}</dt><dd>{operation.effect.state} · v{operation.effect.stateVersion}</dd></div>
                        <div><dt>{t('expiry')}</dt><dd>{operation.effect.expiry.status} · {dateTime(operation.effect.expiry.at)}</dd></div>
                        <div><dt>{t('revocation')}</dt><dd>{operation.effect.revocation.status} · {dateTime(operation.effect.revocation.at)}</dd></div>
                        <div><dt>{t('ratification')}</dt><dd>{operation.effect.ratification.status}</dd></div>
                        <div><dt>{t('digest')}</dt><dd><code>{shortDigest(operation.effect.effectDigest)}</code></dd></div>
                    </dl>
                </article>
            </section>

            <section className={styles.panel}>
                <h2><History size={18} />{t('events')}</h2>
                <ol className={styles.timeline}>
                    {operation.effect.events.map((event) => (
                        <li key={event.id}>
                            <span>{event.sequence}</span>
                            <div><strong>{event.fromState ?? '∅'} → {event.toState}</strong><p>{event.reasonCode} · {dateTime(event.occurredAt)}</p></div>
                        </li>
                    ))}
                </ol>
            </section>

            <section className={styles.split}>
                <article className={styles.panel}>
                    <h2>{t('appeal')}</h2>
                    <p className={styles.status}>{operation.appeal.status}</p>
                    <p>{t('windowEnds')}: {dateTime(operation.appeal.windowEndsAt)}</p>
                    <dl data-testid="governed-action-appeal-routing">
                        <div><dt>Selected channel</dt><dd>{appealRouting.selectedChannel ?? 'not_applicable'}</dd></div>
                        <div><dt>Circle policy</dt><dd>{appealRouting.channels.circlePolicy.status} · {appealRouting.channels.circlePolicy.authorityClass} · {appealRouting.channels.circlePolicy.visibility} · {dateTime(appealRouting.channels.circlePolicy.deadline)}</dd></div>
                        <div><dt>Operator misconduct</dt><dd>{appealRouting.channels.operatorMisconduct.status} · {appealRouting.channels.operatorMisconduct.authorityClass} · {appealRouting.channels.operatorMisconduct.visibility} · {dateTime(appealRouting.channels.operatorMisconduct.deadline)}</dd></div>
                        <div><dt>Platform Safety / Legal</dt><dd>{appealRouting.channels.platformSafetyLegal.status} · {appealRouting.channels.platformSafetyLegal.authorityClass} · {appealRouting.channels.platformSafetyLegal.visibility}</dd></div>
                        {appealRouting.selectedChannel === 'circle_policy' && <div><dt>Submission</dt><dd><code>{appealRouting.channels.circlePolicy.submission?.path}</code></dd></div>}
                        {appealRouting.selectedChannel === 'operator_misconduct' && <div><dt>Submission</dt><dd><code>{appealRouting.channels.operatorMisconduct.submission?.path}</code></dd></div>}
                    </dl>
                    <p className={styles.boundary} data-testid="governed-action-appeal-no-aggravation-boundary">
                        {appealBoundaryT('copy')}
                    </p>
                    {appeal ? (
                        <dl>
                            <div><dt>ID</dt><dd><code>{appeal.id}</code></dd></div>
                            <div><dt>{t('currentState')}</dt><dd>{appeal.state}</dd></div>
                            {appeal.resolution && <div><dt>{t('execution')}</dt><dd>{appeal.resolution.outcome} · {appeal.resolution.reasonCode}</dd></div>}
                        </dl>
                    ) : <p>{t('noAppeal')}</p>}
                </article>
                <article className={styles.panel}>
                    <h2>{t('escalation')}</h2>
                    <code>{operation.escalation.ref}</code>
                    {operation.escalation.caseUrl
                        ? <Link href={operation.escalation.caseUrl}>{t('openCase')}</Link>
                        : <p>{t('noEscalationCase')}</p>}
                </article>
            </section>

            <section className={styles.panel}>
                <h2>{t('recurrence')}</h2>
                {operation.recurrence.length === 0 ? <p>{t('noRecurrence')}</p> : (
                    <ul className={styles.related}>
                        {operation.recurrence.map((related) => (
                            <li key={related.receiptId}>
                                <div><strong>{related.actionType}</strong><p>{related.executionStatus} · {related.effectState ?? '—'} · {dateTime(related.completedAt)}</p></div>
                                <Link href={related.canonicalUrl}>{t('openRelated')}</Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}
