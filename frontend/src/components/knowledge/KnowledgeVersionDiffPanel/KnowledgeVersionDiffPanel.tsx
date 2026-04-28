'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';

import { GET_KNOWLEDGE_VERSION_DIFF } from '@/lib/apollo/queries';
import type {
    GQLKnowledgeVersionEvent,
    KnowledgeVersionDiffResponse,
} from '@/lib/apollo/types';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './KnowledgeVersionDiffPanel.module.css';

interface KnowledgeVersionDiffPanelProps {
    knowledgeId: string;
    currentVersion: number;
    versionTimeline: GQLKnowledgeVersionEvent[];
}

function sortVersions(versionTimeline: GQLKnowledgeVersionEvent[], currentVersion: number): number[] {
    const versions = Array.from(new Set(
        versionTimeline
            .map((item) => Number(item.version))
            .filter((value) => Number.isInteger(value) && value > 0),
    )).sort((a, b) => a - b);

    if (versions.length === 0 && currentVersion > 0) {
        return [1, currentVersion].filter((value, index, items) => items.indexOf(value) === index);
    }

    if (currentVersion > 0 && !versions.includes(currentVersion)) {
        versions.push(currentVersion);
        versions.sort((a, b) => a - b);
    }

    return versions;
}

function formatMaybeDate(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

function humanizeFieldName(field: string): string {
    return field
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}

export default function KnowledgeVersionDiffPanel({
    knowledgeId,
    currentVersion,
    versionTimeline,
}: KnowledgeVersionDiffPanelProps) {
    const t = useI18n('KnowledgeVersionDiffPanel');
    const locale = useCurrentLocale();
    const availableVersions = useMemo(
        () => sortVersions(versionTimeline, currentVersion),
        [currentVersion, versionTimeline],
    );

    const [fromVersion, setFromVersion] = useState<number>(availableVersions[0] ?? 1);
    const [toVersion, setToVersion] = useState<number>(availableVersions[availableVersions.length - 1] ?? currentVersion ?? 1);

    const canCompare = Boolean(knowledgeId) && availableVersions.length >= 2 && fromVersion !== toVersion;
    const { data, loading, error } = useQuery<KnowledgeVersionDiffResponse>(GET_KNOWLEDGE_VERSION_DIFF, {
        variables: {
            knowledgeId,
            fromVersion,
            toVersion,
        },
        skip: !canCompare,
    });

    const diff = data?.knowledge?.versionDiff ?? null;
    const formatFieldLabel = (field: string): string => {
        switch (field) {
        case 'eventType':
            return t('fields.eventType');
        case 'actorHandle':
            return t('fields.actorHandle');
        case 'contributorsCount':
            return t('fields.contributorsCount');
        case 'contributorsRoot':
            return t('fields.contributorsRoot');
        case 'sourceEventTimestamp':
            return t('fields.sourceEventTimestamp');
        case 'title':
            return t('fields.title');
        case 'description':
            return t('fields.description');
        case 'ipfsCid':
            return t('fields.ipfsCid');
        case 'contentHash':
            return t('fields.contentHash');
        default:
            return humanizeFieldName(field);
        }
    };
    const formatSummary = (): string => {
        if (!diff) return '';
        if (diff.unavailableFields.length > 0) {
            return t('summary.metadataOnly');
        }
        if (diff.fieldChanges.length > 0) {
            return t('summary.changed', {count: diff.fieldChanges.length});
        }
        return t('summary.noFieldChanges');
    };

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <h2 className={styles.title}>{t('title')}</h2>
                <p className={styles.subtitle}>
                    {t('subtitle')}
                </p>
            </div>

            <div className={styles.controls}>
                <label className={styles.field}>
                    <span className={styles.label}>{t('controls.fromVersion')}</span>
                    <select
                        className={styles.select}
                        value={fromVersion}
                        onChange={(event) => setFromVersion(Number(event.target.value))}
                    >
                        {availableVersions.map((version) => (
                            <option key={`from:${version}`} value={version}>
                                v{version}
                            </option>
                        ))}
                    </select>
                </label>

                <label className={styles.field}>
                    <span className={styles.label}>{t('controls.toVersion')}</span>
                    <select
                        className={styles.select}
                        value={toVersion}
                        onChange={(event) => setToVersion(Number(event.target.value))}
                    >
                        {availableVersions.map((version) => (
                            <option key={`to:${version}`} value={version}>
                                v{version}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {!canCompare && (
                <p className={styles.empty}>{t('states.notEnoughVersions')}</p>
            )}

            {canCompare && (
                <>
                    <div className={styles.note}>
                        {t('notes.metadataOnly')}
                    </div>

                    {loading && <p className={styles.empty}>{t('states.loading')}</p>}
                    {error && <p className={styles.empty}>{t('states.error', {message: error.message})}</p>}
                    {!loading && !error && !diff && <p className={styles.empty}>{t('states.noDiff')}</p>}

                    {diff && (
                        <>
                            <div className={styles.grid}>
                                <div className={styles.snapshot}>
                                    <h3 className={styles.snapshotTitle}>v{diff.fromSnapshot.version}</h3>
                                    <div className={styles.snapshotMeta}>
                                        <span>{t('snapshot.eventType', {value: diff.fromSnapshot.eventType})}</span>
                                        <span>{t('snapshot.actor', {value: diff.fromSnapshot.actorHandle || diff.fromSnapshot.actorPubkey || t('snapshot.system')})}</span>
                                        <span>{t('snapshot.eventAt', {value: formatMaybeDate(diff.fromSnapshot.eventAt, locale)})}</span>
                                        <span>{t('snapshot.contentSnapshot', {value: diff.fromSnapshot.hasContentSnapshot ? t('snapshot.readable') : t('snapshot.unreadable')})}</span>
                                    </div>
                                </div>
                                <div className={styles.snapshot}>
                                    <h3 className={styles.snapshotTitle}>v{diff.toSnapshot.version}</h3>
                                    <div className={styles.snapshotMeta}>
                                        <span>{t('snapshot.eventType', {value: diff.toSnapshot.eventType})}</span>
                                        <span>{t('snapshot.actor', {value: diff.toSnapshot.actorHandle || diff.toSnapshot.actorPubkey || t('snapshot.system')})}</span>
                                        <span>{t('snapshot.eventAt', {value: formatMaybeDate(diff.toSnapshot.eventAt, locale)})}</span>
                                        <span>{t('snapshot.contentSnapshot', {value: diff.toSnapshot.hasContentSnapshot ? t('snapshot.readable') : t('snapshot.unreadable')})}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={styles.note}>{formatSummary()}</div>

                            <div className={styles.changes}>
                                {diff.fieldChanges.length === 0 ? (
                                    <p className={styles.empty}>{t('states.noFieldChanges')}</p>
                                ) : (
                                    diff.fieldChanges.map((change) => (
                                        <div key={`${change.field}:${change.fromValue}:${change.toValue}`} className={styles.changeRow}>
                                            <span className={styles.changeLabel}>{formatFieldLabel(change.field)}</span>
                                            <div className={styles.changeValues}>
                                                <div className={styles.changeValue}>
                                                    <span className={styles.changeHint}>{t('labels.from')}</span>
                                                    <span>{change.fromValue}</span>
                                                </div>
                                                <div className={styles.changeValue}>
                                                    <span className={styles.changeHint}>{t('labels.to')}</span>
                                                    <span>{change.toValue}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </>
                    )}
                </>
            )}
        </section>
    );
}
