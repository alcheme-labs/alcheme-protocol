'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenCheck, Check, CircleAlert, Link2, RefreshCw, WandSparkles } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import { createComposeDraft } from '@/lib/api/discussion';
import {
    bindGovernanceCaseBriefClaimEvidence,
    bindGovernanceCaseBrief,
    fetchGovernanceCase,
    fetchGovernanceCaseBriefCandidates,
    transitionGovernanceCase,
    type GovernanceCase,
    type GovernanceCaseBriefCandidate,
} from '@/lib/api/governance';
import { buildGovernanceBriefTemplateText } from './governanceBriefTemplate';
import { formatWalletDetailWithOptionalSns } from '@/lib/circle/snsIdentityDisplay';
import styles from './GovernanceCaseBriefPanel.module.css';

export default function GovernanceCaseBriefPanel({
    governanceCase,
    viewerPubkey,
    onRefresh,
}: {
    governanceCase: GovernanceCase;
    viewerPubkey: string | null;
    onRefresh: () => Promise<void>;
}) {
    const t = useI18n('GovernanceCases');
    const router = useRouter();
    const [candidates, setCandidates] = useState<GovernanceCaseBriefCandidate[]>([]);
    const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [selectedClaimId, setSelectedClaimId] = useState('');
    const [selectedChunkRef, setSelectedChunkRef] = useState('');
    const bindAttemptRef = useRef<{ candidateKey: string; idempotencyKey: string } | null>(null);
    const coordinator = useMemo(
        () => governanceCase.workflow.responsibilities.find((item) => item.kind === 'coordinator') ?? null,
        [governanceCase.workflow.responsibilities],
    );
    const canBind = Boolean(
        viewerPubkey
        && !governanceCase.workflow.legacy
        && governanceCase.workflow.version
        && ['intake', 'proposal_drafting', 'evidence_review'].includes(governanceCase.phase)
        && (
            governanceCase.workflow.canManage
            || (coordinator?.status === 'accepted' && coordinator.assigneePubkey === viewerPubkey)
        ),
    );
    const circleId = governanceCase.governanceHome?.type === 'circle'
        ? Number(governanceCase.governanceHome.ref)
        : null;
    const readiness = governanceCase.brief?.readiness ?? null;
    const canEnterEvidenceReview = Boolean(
        viewerPubkey
        && governanceCase.workflow.version
        && governanceCase.phase === 'proposal_drafting'
        && coordinator?.status === 'accepted'
        && coordinator.assigneePubkey === viewerPubkey
        && readiness?.readyForEvidenceReview,
    );
    const evidenceChunkOptions = useMemo(
        () => (governanceCase.brief?.sources ?? []).flatMap((source) => source.chunks.map((chunk) => ({
            value: `${source.id}:${chunk.id}`,
            label: `${source.name} · #${chunk.index + 1} · ${shortDigest(chunk.digest)}`,
        }))),
        [governanceCase.brief?.sources],
    );
    const selectedCandidate = candidates.find(
        (candidate) => briefCandidateKey(candidate) === selectedCandidateKey,
    ) ?? null;
    const selectedCandidateAlreadyBound = Boolean(
        selectedCandidate
        && governanceCase.brief
        && governanceCase.brief.draftPostId === selectedCandidate.draftPostId
        && governanceCase.brief.draftVersion === selectedCandidate.draftVersion
        && governanceCase.brief.snapshotDigest === selectedCandidate.snapshotDigest,
    );
    const isReviewCandidate = (candidate: GovernanceCaseBriefCandidate | null | undefined) =>
        candidate?.documentStatus === 'review' || candidate?.documentStatus === 'reviewing';
    const selectedCandidateInReview = isReviewCandidate(selectedCandidate);
    const hasBriefDraft = candidates.length > 0 || Boolean(governanceCase.brief);

    useEffect(() => {
        let active = true;
        if (!canBind) {
            setCandidates([]);
            setSelectedCandidateKey('');
            return () => { active = false; };
        }
        setLoading(true);
        setError(null);
        fetchGovernanceCaseBriefCandidates(governanceCase.id)
            .then((items) => {
                if (!active) return;
                setCandidates(items);
                setSelectedCandidateKey((current) => (
                    items.some((candidate) => briefCandidateKey(candidate) === current)
                        ? current
                        : (items[0] ? briefCandidateKey(items[0]) : '')
                ));
            })
            .catch(() => { if (active) setError(t('brief.loadError')); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [canBind, governanceCase.id, t]);

    async function bindSelectedBrief() {
        if (!canBind || !governanceCase.workflow.version || !selectedCandidate || !selectedCandidateInReview) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const candidateKey = briefCandidateKey(selectedCandidate);
            if (bindAttemptRef.current?.candidateKey !== candidateKey) {
                bindAttemptRef.current = {
                    candidateKey,
                    idempotencyKey: `case-brief:${crypto.randomUUID()}`,
                };
            }
            const result = await bindGovernanceCaseBrief({
                caseId: governanceCase.id,
                draftPostId: selectedCandidate.draftPostId,
                expectedDraftVersion: selectedCandidate.draftVersion,
                expectedSnapshotDigest: selectedCandidate.snapshotDigest,
                idempotencyKey: bindAttemptRef.current.idempotencyKey,
                expectedCaseVersion: governanceCase.workflow.version,
            });
            if (
                result.binding.draftPostId !== selectedCandidate.draftPostId
                || result.binding.draftVersion !== selectedCandidate.draftVersion
                || result.binding.snapshotDigest !== selectedCandidate.snapshotDigest
            ) {
                throw new Error('governance_case_brief_bind_readback_mismatch');
            }
            await onRefresh();
            bindAttemptRef.current = null;
            setNotice(t('brief.bindSuccess', { version: selectedCandidate.draftVersion }));
        } catch {
            try {
                const refreshed = await fetchGovernanceCase(governanceCase.id);
                const exactBindingNowVisible = Boolean(
                    refreshed.brief
                    && refreshed.brief.draftPostId === selectedCandidate.draftPostId
                    && refreshed.brief.draftVersion === selectedCandidate.draftVersion
                    && refreshed.brief.snapshotDigest === selectedCandidate.snapshotDigest,
                );
                await onRefresh();
                if (exactBindingNowVisible) {
                    bindAttemptRef.current = null;
                    setNotice(t('brief.bindSuccess', { version: selectedCandidate.draftVersion }));
                    return;
                }
            } catch {
                // Preserve the original bind failure when authoritative refresh is unavailable.
            }
            setError(t('brief.bindError'));
        } finally {
            setBusy(false);
        }
    }

    async function createCaseBrief() {
        if (!canBind || !circleId) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const created = await createComposeDraft({
                circleId,
                draftTitle: governanceCase.title.trim().slice(0, 160),
                text: buildGovernanceBriefTemplateText(governanceCase, ''),
                clientRequestId: `case-brief:${governanceCase.id}:v1`,
            });
            const draftPostId = Number(created.result.draftPostId);
            if (!Number.isSafeInteger(draftPostId) || draftPostId <= 0) {
                throw new Error('created_case_brief_readback_invalid');
            }
            setNotice(t('brief.createSuccess'));
            router.push(`/circles/${circleId}?tab=crucible&draft=${draftPostId}&returnCase=${encodeURIComponent(governanceCase.id)}`);
        } catch {
            setError(t('brief.createError'));
        } finally {
            setBusy(false);
        }
    }

    async function enterEvidenceReview() {
        if (!canEnterEvidenceReview || !governanceCase.workflow.version) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            await transitionGovernanceCase({
                caseId: governanceCase.id,
                toPhase: 'evidence_review',
                idempotencyKey: `case-evidence-review:${crypto.randomUUID()}`,
                expectedCaseVersion: governanceCase.workflow.version,
            });
            await onRefresh();
        } catch {
            setError(t('brief.reviewError'));
        } finally {
            setBusy(false);
        }
    }

    async function bindClaimEvidence() {
        if (!selectedClaimId || !selectedChunkRef || !governanceCase.workflow.version) return;
        const [sourceMaterialId, sourceMaterialChunkId] = selectedChunkRef.split(':').map(Number);
        if (!Number.isInteger(sourceMaterialId) || !Number.isInteger(sourceMaterialChunkId)) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            await bindGovernanceCaseBriefClaimEvidence({
                caseId: governanceCase.id,
                claimId: selectedClaimId,
                sourceMaterialId,
                sourceMaterialChunkId,
                idempotencyKey: `case-brief-evidence:${crypto.randomUUID()}`,
                expectedCaseVersion: governanceCase.workflow.version,
            });
            setSelectedClaimId('');
            setSelectedChunkRef('');
            await onRefresh();
        } catch {
            setError(t('brief.claims.bindError'));
        } finally {
            setBusy(false);
        }
    }

    if (governanceCase.workflow.legacy) return null;

    return (
        <section className={styles.panel} aria-labelledby="case-brief-title">
            <div className={styles.heading}>
                <BookOpenCheck size={21} />
                <div>
                    <p>{t('brief.eyebrow')}</p>
                    <h2 id="case-brief-title">{t('brief.title')}</h2>
                </div>
            </div>
            <p className={styles.boundary}>{t('brief.boundary')}</p>
            <ol className={styles.flow} aria-label={t('brief.flow.title')}>
                <li data-complete={hasBriefDraft ? 'true' : 'false'}>
                    <span>1</span>
                    <div><strong>{t('brief.flow.create')}</strong><small>{t('brief.flow.createHint')}</small></div>
                </li>
                <li data-complete={selectedCandidateInReview || Boolean(governanceCase.brief) ? 'true' : 'false'}>
                    <span>2</span>
                    <div><strong>{t('brief.flow.review')}</strong><small>{t('brief.flow.reviewHint')}</small></div>
                </li>
                <li data-complete={governanceCase.brief ? 'true' : 'false'}>
                    <span>3</span>
                    <div><strong>{t('brief.flow.bind')}</strong><small>{t('brief.flow.bindHint')}</small></div>
                </li>
            </ol>
            <p className={styles.contractHint}>{t('brief.contractHint')}</p>
            {governanceCase.brief ? (
                <>
                    <article className={styles.binding}>
                        <div>
                            <strong>{t('brief.boundVersion', { version: governanceCase.brief.draftVersion })}</strong>
                            <span>{t('brief.draftId', { id: governanceCase.brief.draftPostId })}</span>
                        </div>
                        <code title={governanceCase.brief.snapshotDigest}>{shortDigest(governanceCase.brief.snapshotDigest)}</code>
                        <small>{t('brief.boundAt', { time: formatDate(governanceCase.brief.boundAt) })}</small>
                    </article>
                    <details className={styles.secondaryFacts}>
                        <summary>{t('brief.actors.title')}</summary>
                        <section className={styles.actors} aria-labelledby="case-brief-actors-title">
                            <div className={styles.sourcesHeading}>
                                <h3 id="case-brief-actors-title">{t('brief.actors.title')}</h3>
                            </div>
                            <p>{t('brief.actors.boundary')}</p>
                            <div className={styles.actorGrid}>
                                <article>
                                    <h4>{t('brief.actors.externalAuthor')}</h4>
                                    {governanceCase.brief.actors.externalAuthors.length > 0 ? (
                                        <ul>{governanceCase.brief.actors.externalAuthors.map((actor) => (
                                            <li key={`${actor.sourceMaterialId}:${actor.label}`}>{actor.label}</li>
                                        ))}</ul>
                                    ) : <span>{t('brief.actors.empty')}</span>}
                                </article>
                                <article>
                                    <h4>{t('brief.actors.materialSubmitter')}</h4>
                                    {governanceCase.brief.actors.materialSubmitters.length > 0 ? (
                                        <ul>{governanceCase.brief.actors.materialSubmitters.map((actor) => {
                                            const walletDetail = formatWalletDetailWithOptionalSns({
                                                pubkey: actor.pubkey,
                                                secondarySnsLabel: actor.secondarySnsLabel,
                                                shortPubkey,
                                            });
                                            return (
                                            <li key={`${actor.sourceMaterialId}:${actor.userId ?? actor.pubkey}`}>
                                                {actor.userId
                                                    ? t('brief.actors.userIdentity', { id: actor.userId })
                                                    : t('brief.actors.walletIdentity', {
                                                        wallet: walletDetail
                                                            ? (walletDetail.secondarySnsLabel
                                                                ? `${walletDetail.shortPubkey} · ${walletDetail.secondarySnsLabel}`
                                                                : walletDetail.shortPubkey)
                                                            : shortPubkey(actor.pubkey),
                                                    })}
                                            </li>
                                            );
                                        })}</ul>
                                    ) : <span>{t('brief.actors.empty')}</span>}
                                </article>
                                <article>
                                    <h4>{t('brief.actors.briefContributor')}</h4>
                                    {governanceCase.brief.actors.briefContributors.length > 0 ? (
                                        <ul>{governanceCase.brief.actors.briefContributors.map((actor) => (
                                            <li key={`${actor.userId}:${actor.draftVersion}`}>
                                                {t('brief.actors.contributorIdentity', { id: actor.userId, version: actor.draftVersion })}
                                            </li>
                                        ))}</ul>
                                    ) : <span>{t('brief.actors.empty')}</span>}
                                </article>
                                <article>
                                    <h4>{t('brief.actors.reviewer')}</h4>
                                    {governanceCase.brief.actors.reviewers.length > 0 ? (
                                        <ul>{governanceCase.brief.actors.reviewers.map((actor) => {
                                            const walletDetail = formatWalletDetailWithOptionalSns({
                                                pubkey: actor.pubkey,
                                                secondarySnsLabel: actor.secondarySnsLabel,
                                                shortPubkey,
                                            });
                                            return (
                                            <li key={`${actor.pubkey}:${actor.status}`}>
                                                {t('brief.actors.reviewerIdentity', {
                                                    wallet: walletDetail
                                                        ? (walletDetail.secondarySnsLabel
                                                            ? `${walletDetail.shortPubkey} · ${walletDetail.secondarySnsLabel}`
                                                            : walletDetail.shortPubkey)
                                                        : shortPubkey(actor.pubkey),
                                                    status: actor.status,
                                                })}
                                            </li>
                                            );
                                        })}</ul>
                                    ) : <span>{t('brief.actors.empty')}</span>}
                                </article>
                            </div>
                        </section>
                    </details>
                    <details className={styles.secondaryFacts}>
                        <summary>{t('brief.contentHistory.title')}</summary>
                        <section className={styles.contentHistory} aria-labelledby="case-brief-content-history-title">
                            <div className={styles.sourcesHeading}>
                                <h3 id="case-brief-content-history-title">{t('brief.contentHistory.title')}</h3>
                                <span>{t('brief.contentHistory.count', { count: governanceCase.brief.contentHistory.length })}</span>
                            </div>
                            <p>{t('brief.contentHistory.boundary')}</p>
                            {governanceCase.brief.contentHistory.length > 0 ? (
                                <ol>
                                    {governanceCase.brief.contentHistory.map((entry) => (
                                        <li key={entry.id}>
                                            <div>
                                                <strong>{t(`brief.contentHistory.kind.${entry.contentKind}`)}</strong>
                                                <span>{t(`brief.contentHistory.snapshot.${entry.snapshotRelation}`)}</span>
                                            </div>
                                            {entry.aiGeneration.summary ? <small>{entry.aiGeneration.summary}</small> : null}
                                            <p>{entry.aiGeneration.content}</p>
                                            <small>{t('brief.contentHistory.aiGenerated', {
                                                model: entry.aiGeneration.model || t('brief.contentHistory.unknownModel'),
                                                time: formatDate(entry.aiGeneration.generatedAt),
                                            })}</small>
                                            <small>{t('brief.contentHistory.humanAccepted', {
                                                userId: entry.humanAcceptance.acceptedByUserId,
                                                time: formatDate(entry.humanAcceptance.acceptedAt),
                                            })}</small>
                                            <code title={entry.humanAcceptance.resultingWorkingCopyHash}>
                                                {t('brief.contentHistory.resultDigest', {
                                                    digest: shortDigest(entry.humanAcceptance.resultingWorkingCopyHash),
                                                })}
                                            </code>
                                        </li>
                                    ))}
                                </ol>
                            ) : <p>{t('brief.contentHistory.empty')}</p>}
                        </section>
                    </details>
                    <section className={styles.sources} aria-labelledby="case-brief-sources-title">
                        <div className={styles.sourcesHeading}>
                            <h3 id="case-brief-sources-title">{t('brief.sourcesTitle')}</h3>
                            <span>{t('brief.sourcesCount', { count: governanceCase.brief.sources.length })}</span>
                        </div>
                        {governanceCase.brief.sources.length > 0 ? (
                            <ul>
                                {governanceCase.brief.sources.map((source) => (
                                    <li key={source.id}>
                                        <a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.name}</a>
                                        <span>{source.externalAuthorLabel}</span>
                                        <small>{t('brief.sourcePublishedAt', { time: formatDate(source.publishedAt) })}</small>
                                        <small>{t('brief.sourceCapturedAt', { time: formatDate(source.capturedAt) })}</small>
                                        <code title={source.contentDigest}>{t('brief.sourceDigest', {
                                            version: source.sourceVersion,
                                            chunks: source.chunkCount,
                                            digest: shortDigest(source.contentDigest),
                                        })}</code>
                                        {source.versionDiff ? (
                                            <small>
                                                v{source.versionDiff.previousVersion} → v{source.sourceVersion}
                                                {' · '}+{source.versionDiff.addedChunks}
                                                {' · '}−{source.versionDiff.removedChunks}
                                                {' · '}={source.versionDiff.unchangedChunks}
                                            </small>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>{t('brief.sourcesEmpty')}</p>
                        )}
                    </section>
                    <section className={styles.claims} aria-labelledby="case-brief-claims-title">
                        <div className={styles.sourcesHeading}>
                            <h3 id="case-brief-claims-title">{t('brief.claims.title')}</h3>
                            <span>{t('brief.claims.count', { count: governanceCase.brief.claims.length })}</span>
                        </div>
                        <div className={styles.coverage} aria-label={t('brief.claims.coverage.title')}>
                            {(['total', 'supported', 'stale', 'redacted', 'unsupported'] as const).map((key) => (
                                <span key={key}>
                                    <strong>{governanceCase.brief!.coverage[key]}</strong>
                                    {t(`brief.claims.coverage.${key}`)}
                                </span>
                            ))}
                        </div>
                        {governanceCase.brief.claims.length > 0 ? (
                            <ul>
                                {governanceCase.brief.claims.map((claim) => (
                                    <li key={claim.id}>
                                        <small>{t(`brief.claims.sections.${claim.sectionKey}`)}</small>
                                        <p>{claim.text}</p>
                                        <small>{t(`brief.claims.coverageStatus.${claim.coverageStatus}`)}</small>
                                        {claim.bindings.map((binding) => (
                                            <code key={binding.id} title={binding.sourceMaterialChunkDigest}>
                                                {t('brief.claims.binding', {
                                                    materialId: binding.sourceMaterialId,
                                                    chunkId: binding.sourceMaterialChunkId,
                                                    digest: shortDigest(binding.sourceMaterialChunkDigest),
                                                })}
                                            </code>
                                        ))}
                                        {canBind && governanceCase.phase === 'proposal_drafting' ? (
                                            <button type="button" onClick={() => setSelectedClaimId(claim.id)} disabled={busy}>
                                                {t('brief.claims.choose')}
                                            </button>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : <p>{t('brief.claims.empty')}</p>}
                        {selectedClaimId ? (
                            <div className={styles.claimBindingForm}>
                                <label>
                                    <span>{t('brief.claims.chunk')}</span>
                                    <select value={selectedChunkRef} onChange={(event) => setSelectedChunkRef(event.target.value)} disabled={busy}>
                                        <option value="">{t('brief.claims.chunkPlaceholder')}</option>
                                        {evidenceChunkOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </label>
                                <button type="button" onClick={bindClaimEvidence} disabled={busy || !selectedChunkRef}>
                                    {t('brief.claims.bind')}
                                </button>
                            </div>
                        ) : null}
                    </section>
                    {readiness ? (
                        <section className={styles.readiness} aria-labelledby="case-brief-readiness-title">
                            <div className={styles.readinessHeading}>
                                <div>
                                    <h3 id="case-brief-readiness-title">{t('brief.readinessTitle')}</h3>
                                    <p>{readiness.readyForEvidenceReview
                                        ? t('brief.readinessReady')
                                        : t('brief.readinessMissing', { count: readiness.missingSectionKeys.length })}</p>
                                </div>
                                {readiness.readyForEvidenceReview ? <Check size={18} /> : <CircleAlert size={18} />}
                            </div>
                            <ul>
                                {readiness.sections.map((section) => (
                                    <li key={section.key} data-complete={section.complete ? 'true' : 'false'}>
                                        <span>{section.complete ? <Check size={14} /> : <CircleAlert size={14} />}{t(`brief.section.${section.key}`)}</span>
                                        <small>{section.complete
                                            ? t('brief.sectionComplete')
                                            : t('brief.sectionOwner', { owner: shortPubkey(section.ownerPubkey) })}</small>
                                    </li>
                                ))}
                            </ul>
                            {!readiness.reviewSnapshotReady ? <p className={styles.reviewHint}>{t('brief.reviewSnapshotRequired')}</p> : null}
                            <div className={styles.readinessActions}>
                                {governanceCase.phase === 'proposal_drafting' && coordinator?.assigneePubkey === viewerPubkey ? (
                                    <button type="button" disabled={busy || !canEnterEvidenceReview} onClick={() => void enterEvidenceReview()}>
                                        {busy ? <RefreshCw size={15} className={styles.spin} /> : <BookOpenCheck size={15} />}
                                        {t('brief.enterReview')}
                                    </button>
                                ) : null}
                            </div>
                        </section>
                    ) : null}
                </>
            ) : (
                <p className={styles.empty}>{t('brief.empty')}</p>
            )}
            {canBind ? (
                <div className={styles.controls}>
                    {!governanceCase.brief && circleId ? (
                        <button type="button" className={styles.createBrief} disabled={busy} onClick={() => void createCaseBrief()}>
                            {busy ? <RefreshCw size={15} className={styles.spin} /> : <WandSparkles size={15} />}
                            {t('brief.create')}
                        </button>
                    ) : null}
                    <span className={styles.controlsLabel}>{t('brief.choose')}</span>
                    <details
                        className={styles.candidatePicker}
                        aria-label={t('brief.choose')}
                    >
                        <summary
                            aria-disabled={loading || busy || candidates.length === 0}
                            onClick={(event) => {
                                if (loading || busy || candidates.length === 0) event.preventDefault();
                            }}
                        >
                            {selectedCandidate ? (
                                <>
                                    <strong>{selectedCandidate.title}</strong>
                                    <span>{t('brief.candidateMeta', {
                                        id: selectedCandidate.draftPostId,
                                        version: selectedCandidate.draftVersion,
                                        status: selectedCandidate.documentStatus,
                                    })}</span>
                                    <span>{selectedCandidate.sectionReady
                                        ? t('brief.candidateReadiness.ready')
                                        : t('brief.candidateReadiness.missing', {
                                            count: selectedCandidate.missingSectionKeys.length,
                                        })}</span>
                                </>
                            ) : <span>{loading ? t('brief.loadingCandidates') : t('brief.noCandidates')}</span>}
                        </summary>
                        {candidates.length > 0 ? (
                            <div className={styles.candidateOptions} role="listbox">
                                {candidates.map((candidate) => {
                                    const key = briefCandidateKey(candidate);
                                    const exactBound = Boolean(
                                        governanceCase.brief
                                        && governanceCase.brief.draftPostId === candidate.draftPostId
                                        && governanceCase.brief.draftVersion === candidate.draftVersion
                                        && governanceCase.brief.snapshotDigest === candidate.snapshotDigest
                                    );
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            role="option"
                                            aria-selected={key === selectedCandidateKey}
                                            onClick={(event) => {
                                                setSelectedCandidateKey(key);
                                                event.currentTarget.closest('details')?.removeAttribute('open');
                                            }}
                                        >
                                            <strong>{candidate.title}</strong>
                                            <span>{t('brief.candidateMeta', {
                                                id: candidate.draftPostId,
                                                version: candidate.draftVersion,
                                                status: candidate.documentStatus,
                                            })}</span>
                                            <span>{candidate.sectionReady
                                                ? t('brief.candidateReadiness.ready')
                                                : t('brief.candidateReadiness.missing', {
                                                    count: candidate.missingSectionKeys.length,
                                                })}</span>
                                            <code>{shortDigest(candidate.snapshotDigest)}</code>
                                            <small>{exactBound
                                                ? t('brief.candidateNext.bound')
                                                : (isReviewCandidate(candidate)
                                                    ? t('brief.candidateNext.bind')
                                                    : t('brief.candidateNext.review'))}</small>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : null}
                    </details>
                    <button
                        type="button"
                        disabled={loading || busy || !selectedCandidateKey || !selectedCandidateInReview || selectedCandidateAlreadyBound}
                        onClick={() => void bindSelectedBrief()}
                    >
                        {loading || busy ? <RefreshCw size={15} className={styles.spin} /> : <Link2 size={15} />}
                        {selectedCandidateAlreadyBound
                            ? t('brief.alreadyBound')
                            : (governanceCase.brief ? t('brief.replace') : t('brief.bind'))}
                    </button>
                </div>
            ) : null}
            {circleId ? (
                <Link
                    href={`/circles/${circleId}?tab=crucible${governanceCase.brief
                        ? `&draft=${governanceCase.brief.draftPostId}&draftVersion=${governanceCase.brief.draftVersion}`
                        : ''}&returnCase=${encodeURIComponent(governanceCase.id)}`}
                    className={styles.draftsLink}
                >
                    {t('brief.openDrafts')}<Link2 size={14} />
                </Link>
            ) : null}
            {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
    );
}

function briefCandidateKey(candidate: GovernanceCaseBriefCandidate): string {
    return `${candidate.draftPostId}:${candidate.draftVersion}:${candidate.snapshotDigest}`;
}

function shortPubkey(value: string | null): string {
    if (!value) return '—';
    return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function shortDigest(value: string): string {
    return `${value.slice(0, 12)}…${value.slice(-10)}`;
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
