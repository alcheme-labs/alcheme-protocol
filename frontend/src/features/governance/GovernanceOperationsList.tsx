'use client';

import Link from 'next/link';
import { ArrowRight, Clock3 } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { GovernanceOperationInboxItem } from '@/lib/api/governance';
import styles from './GovernanceOperationsList.module.css';

const OPERATION_GROUPS: GovernanceOperationInboxItem['group'][] = [
    'awaiting_action',
    'active',
    'expiring',
    'appealed',
    'closed',
];

export default function GovernanceOperationsList({
    operations,
}: {
    operations: GovernanceOperationInboxItem[];
}) {
    const t = useI18n('MyGovernance');
    const operationsT = useI18n('MyGovernanceOperations');
    const grouped = OPERATION_GROUPS.map((group) => ({
        group,
        operations: operations.filter((operation) => operation.group === group),
    }));

    return (
        <section className={styles.root} aria-labelledby="governance-operation-queue-title">
            <div className={styles.header}>
                <div>
                    <p>{operationsT('eyebrow')}</p>
                    <h2 id="governance-operation-queue-title">{operationsT('title')}</h2>
                </div>
                <span>{operationsT('canonical')}</span>
            </div>
            <p className={styles.boundary}>{operationsT('boundary')}</p>
            <div className={styles.groups}>
                {grouped.map(({ group, operations: groupOperations }) => (
                    <section
                        key={group}
                        className={styles.group}
                        data-testid={`governance-operation-group-${group}`}
                        aria-labelledby={`governance-operation-group-title-${group}`}
                    >
                        <header>
                            <h3 id={`governance-operation-group-title-${group}`}>
                                {operationsT(`group.${group}`)}
                            </h3>
                            <span>{groupOperations.length}</span>
                        </header>
                        {groupOperations.length === 0 ? (
                            <p className={styles.empty}>{operationsT('groupEmpty')}</p>
                        ) : (
                            <div className={styles.list}>
                                {groupOperations.map((operation) => (
                                    <article key={operation.id} className={styles.card}>
                                        <div className={styles.topline}>
                                            <span>{operationsT(`kind.${operation.task.kind}`)}</span>
                                            <span data-status={operation.task.status}>
                                                {t(`status.${operation.task.status}`)}
                                            </span>
                                        </div>
                                        <h4>{operation.actionType}</h4>
                                        <p>{operationsT('subject', {
                                            type: operation.subject.type,
                                            ref: operation.subject.ref,
                                        })}</p>
                                        <dl>
                                            <div><dt>{operationsT('target')}</dt><dd>{operation.circleId}</dd></div>
                                            <div><dt>{operationsT('risk')}</dt><dd>{operationsT(`riskLevel.${operation.risk}`)}</dd></div>
                                            <div><dt>{operationsT('effect')}</dt><dd>{operation.effect.state}</dd></div>
                                            <div><dt>{operationsT('appeal')}</dt><dd>{operation.appeal.status}</dd></div>
                                        </dl>
                                        {operation.identities.length > 0 ? (
                                            <div className={styles.identities}>
                                                <strong>{operationsT('identityLabel')}</strong>
                                                <div>
                                                    {operation.identities.map((identity) => (
                                                        <Link
                                                            key={`${identity.role}:${identity.canonicalUrl}`}
                                                            href={identity.canonicalUrl}
                                                            data-operation-identity={identity.role}
                                                        >
                                                            {operationsT(`identity.${identity.role}`)}
                                                            <span>{t(`status.${identity.status}`)}</span>
                                                        </Link>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}
                                        {operation.lifecycle.expiresAt ? (
                                            <p className={styles.deadline}>
                                                <Clock3 size={15} />
                                                {operationsT('expires', {
                                                    value: new Date(operation.lifecycle.expiresAt).toLocaleString(),
                                                })}
                                            </p>
                                        ) : null}
                                        {operation.task.deadline ? (
                                            <p className={styles.deadline}>
                                                <Clock3 size={15} />
                                                {t('deadline', {
                                                    value: new Date(operation.task.deadline).toLocaleString(),
                                                })}
                                            </p>
                                        ) : null}
                                        {operation.task.disabledReason ? (
                                            <p className={styles.reason}>
                                                {operationsT(`reason.${operation.task.disabledReason}`)}
                                            </p>
                                        ) : null}
                                        <Link href={operation.task.canonicalUrl} className={styles.open}>
                                            {operationsT('open')}
                                            <ArrowRight size={17} />
                                        </Link>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                ))}
            </div>
        </section>
    );
}
