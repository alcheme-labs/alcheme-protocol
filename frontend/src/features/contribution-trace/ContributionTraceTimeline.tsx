'use client';

import { AlertTriangle, GitBranch, ShieldCheck, UserRound } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import {
    buildContributionTraceViewModel,
    formatContributionWeight,
    type ContributionTraceDecision,
    type ContributionTraceEvent,
    type ContributionTraceEvidenceRef,
    type ContributionTraceRoleFact,
    type ContributionTraceResponse,
} from './adapter';
import styles from './ContributionTraceTimeline.module.css';

interface ContributionTraceTimelineProps {
    trace: ContributionTraceResponse;
}

function shortenPubkey(value: string): string {
    if (value.length <= 16) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function lookupLabel(labels: Record<string, string>, value: string | null | undefined, fallback: string): string {
    if (!value) return fallback;
    return labels[value] ?? value;
}

function joinLabels(values: string[], labels: Record<string, string>, fallback: string): string {
    if (values.length === 0) return fallback;
    return values.map((value) => labels[value] ?? value).join(' / ');
}

export default function ContributionTraceTimeline({ trace }: ContributionTraceTimelineProps) {
    const t = useI18n('ContributionTrace');
    const warningLabels: Record<string, string> = {
        assessment_artifact_unreadable: t('warnings.assessmentArtifactUnreadable'),
        legacy_trace: t('warnings.legacyTrace'),
        assessment_not_prepared: t('warnings.assessmentNotPrepared'),
        mock_provider_conservative: t('warnings.mockProviderConservative'),
        high_penetration_review_required: t('warnings.highPenetrationReviewRequired'),
        provider_disabled_fallback: t('warnings.providerDisabledFallback'),
        provider_output_fallback: t('warnings.providerOutputFallback'),
        assessment_unavailable: t('warnings.assessmentUnavailable'),
        unreviewed_fallback_trace: t('warnings.unreviewedFallbackTrace'),
    };
    const roleLabels: Record<string, string> = {
        Author: t('roles.Author'),
        Discussant: t('roles.Discussant'),
    };
    const stageLabels: Record<string, string> = {
        source_discussion: t('stages.sourceDiscussion'),
        direct_author: t('stages.directAuthor'),
        source_selection: t('stages.sourceSelection'),
        draft_modification: t('stages.draftModification'),
        review_correction: t('stages.reviewCorrection'),
    };
    const sourceTypeLabels: Record<string, string> = {
        source_discussion: t('sourceTypes.sourceDiscussion'),
        direct_authoring: t('sourceTypes.directAuthoring'),
        curation: t('sourceTypes.curation'),
        semantic_edit: t('sourceTypes.semanticEdit'),
        style_edit: t('sourceTypes.styleEdit'),
        review_issue: t('sourceTypes.reviewIssue'),
        review_solution: t('sourceTypes.reviewSolution'),
    };
    const evidenceTypeLabels: Record<string, string> = {
        source_message: t('evidenceTypes.sourceMessage'),
        draft_snapshot: t('evidenceTypes.draftSnapshot'),
        collab_edit: t('evidenceTypes.collabEdit'),
        review_issue: t('evidenceTypes.reviewIssue'),
        review_application: t('evidenceTypes.reviewApplication'),
        source_selection: t('evidenceTypes.sourceSelection'),
        governance_claim: t('evidenceTypes.governanceClaim'),
        governance_execution: t('evidenceTypes.governanceExecution'),
        governance_outcome: t('evidenceTypes.governanceOutcome'),
        governance_vote: t('evidenceTypes.governanceVote'),
        automation_trigger: t('evidenceTypes.automationTrigger'),
    };
    const contributionFunctionLabels: Record<string, string> = {
        material: t('functions.material'),
        claim: t('functions.claim'),
        edit: t('functions.edit'),
        review: t('functions.review'),
        execution: t('functions.execution'),
        outcome: t('functions.outcome'),
    };
    const actorRoleLabels: Record<string, string> = {
        external_author: t('actorRoles.externalAuthor'),
        submitter: t('actorRoles.submitter'),
        proposal_author: t('actorRoles.proposalAuthor'),
        editor: t('actorRoles.editor'),
        reviewer: t('actorRoles.reviewer'),
        voter: t('actorRoles.voter'),
        executor: t('actorRoles.executor'),
        outcome_reviewer: t('actorRoles.outcomeReviewer'),
        ai_worker: t('actorRoles.aiWorker'),
        trigger: t('actorRoles.trigger'),
    };
    const weightTreatmentLabels: Record<string, string> = {
        weighted: t('weightTreatment.weighted'),
        trace_only: t('weightTreatment.traceOnly'),
        excluded: t('weightTreatment.excluded'),
    };
    const roleReasonLabels: Record<string, string> = {
        weighted_by_current_contribution_policy: t('roleReasons.weightedByPolicy'),
        proof_fact_without_current_weight_budget: t('roleReasons.traceOnlyProof'),
        vote_only_excluded: t('roleReasons.voteOnlyExcluded'),
        unproved_automation_excluded: t('roleReasons.unprovedAutomationExcluded'),
        submission_authority_not_proof_contribution: t('roleReasons.submissionAuthorityNotProof'),
        proposal_authorship_without_bound_claim_proof: t('roleReasons.proposalAuthorshipNotProof'),
    };
    const retentionLabels: Record<string, string> = {
        retained: t('retention.retained'),
        trace_only: t('retention.traceOnly'),
        excluded: t('retention.excluded'),
    };
    const eventTypeLabels: Record<string, string> = {
        stage_prior_applied: t('eventTypes.stagePriorApplied'),
        fallback_applied: t('eventTypes.fallbackApplied'),
        high_penetration_review_required: t('eventTypes.highPenetrationReviewRequired'),
        allocation_normalized: t('eventTypes.allocationNormalized'),
        evidence_excluded: t('eventTypes.evidenceExcluded'),
        proof_adapter_built: t('eventTypes.proofAdapterBuilt'),
    };
    const eventReasonLabels: Record<string, string> = {
        deterministic_fallback_stage_prior: t('eventReasons.deterministicFallbackStagePrior'),
        zero_weight_allocation: t('eventReasons.zeroWeightAllocation'),
        high_penetration_rejected: t('eventReasons.highPenetrationRejected'),
        high_penetration_not_confirmed: t('eventReasons.highPenetrationNotConfirmed'),
        allocation_not_retained: t('eventReasons.allocationNotRetained'),
        high_penetration_review_required: t('eventReasons.highPenetrationReviewRequired'),
        legacy_snapshot: t('eventReasons.legacySnapshot'),
        proof_ready: t('eventReasons.proofReady'),
        source_retained: t('eventReasons.sourceRetained'),
        edit_retained: t('eventReasons.editRetained'),
        semantic_rewrite: t('eventReasons.semanticRewrite'),
        core_source_confirmed: t('eventReasons.coreSourceConfirmed'),
        core_rewrite: t('eventReasons.coreRewrite'),
        mock_retained_source_discussion: t('eventReasons.mockRetainedSourceDiscussion'),
        mock_retained_direct_author: t('eventReasons.mockRetainedDirectAuthor'),
        mock_retained_source_selection: t('eventReasons.mockRetainedSourceSelection'),
        mock_retained_draft_modification: t('eventReasons.mockRetainedDraftModification'),
        mock_retained_review_correction: t('eventReasons.mockRetainedReviewCorrection'),
    };
    const decisionTypeLabels: Record<string, string> = {
        review_before_crystallize: t('decisionTypes.reviewBeforeCrystallize'),
        continue_with_fallback: t('decisionTypes.continueWithFallback'),
        confirm_high_penetration: t('decisionTypes.confirmHighPenetration'),
        reject_high_penetration: t('decisionTypes.rejectHighPenetration'),
        request_correction: t('decisionTypes.requestCorrection'),
        supersede_assessment: t('decisionTypes.supersedeAssessment'),
    };
    const decisionReasonLabels: Record<string, string> = {
        operator_note: t('decisionReasons.operatorNote'),
    };
    const view = buildContributionTraceViewModel(trace, {
        titles: {
            draft: t('titles.draft'),
            crystal: t('titles.crystal'),
        },
        subtitles: {
            public: t('subtitles.public'),
            private: t('subtitles.private'),
        },
        statuses: {
            provisional: t('statuses.provisional'),
            needs_review: t('statuses.needsReview'),
            unavailable: t('statuses.unavailable'),
            fallback_applied: t('statuses.fallbackApplied'),
            finalized: t('statuses.finalized'),
            legacy: t('statuses.legacy'),
        },
        proofLabels: {
            proofPackage: t('proof.proofPackage'),
            contributorsRoot: t('proof.contributorsRoot'),
            sourceAnchor: t('proof.sourceAnchor'),
            contributors: t('proof.contributors'),
            allocationHash: t('proof.allocationHash'),
        },
        policyLabels: {
            version: t('policy.version'),
            digest: t('policy.digest'),
            scope: t('policy.scope'),
            eventKey: t('policy.eventKey'),
            aggregation: t('policy.aggregation'),
            decay: t('policy.decay'),
            identity: t('policy.identity'),
            revocation: t('policy.revocation'),
            exclusions: t('policy.exclusions'),
        },
        warningLabels,
        fallbackLabels: {
            warning: t('fallbacks.warning'),
            proofPendingReview: t('fallbacks.proofPendingReview'),
            unavailable: t('fallbacks.unavailable'),
        },
    });
    const formatContributorStage = (stages: string[]) =>
        joinLabels(stages, stageLabels, t('fallbacks.snapshot'));
    const formatContributorReason = (sourceTypes: string[], traceReasons: string[]) => {
        if (sourceTypes.length > 0) return joinLabels(sourceTypes, sourceTypeLabels, t('fallbacks.snapshot'));
        return joinLabels(traceReasons, eventReasonLabels, t('fallbacks.snapshot'));
    };
    const formatTraceEventTitle = (event: ContributionTraceEvent) =>
        eventReasonLabels[event.reasonCode] ?? eventTypeLabels[event.eventType] ?? t('eventTypes.generic');
    const formatTraceEventBody = (event: ContributionTraceEvent) =>
        eventTypeLabels[event.eventType] ?? t('fallbacks.event');
    const formatEvidenceMeta = (ref: ContributionTraceEvidenceRef) => [
        lookupLabel(evidenceTypeLabels, ref.refType, t('fallbacks.unknown')),
        lookupLabel(stageLabels, ref.stage, t('fallbacks.unknown')),
        lookupLabel(retentionLabels, ref.retention, t('fallbacks.unknown')),
    ].join(' · ');
    const formatDecisionReason = (decision: ContributionTraceDecision) =>
        decision.decisionType === 'request_correction' && decision.reason
            ? decision.reason
            : decision.reasonCode
            ? (decisionReasonLabels[decision.reasonCode] ?? t('fallbacks.reasonCode', { code: decision.reasonCode }))
            : t('fallbacks.recorded');
    const formatRoleFactTitle = (fact: ContributionTraceRoleFact) => [
        lookupLabel(actorRoleLabels, fact.actorRole, t('fallbacks.unknown')),
        fact.actorPubkey ? shortenPubkey(fact.actorPubkey) : t('roleFacts.identityHidden'),
    ].join(' · ');
    const formatRoleFactBody = (fact: ContributionTraceRoleFact) => [
        lookupLabel(contributionFunctionLabels, fact.contributionFunction, t('roleFacts.noContributionFunction')),
        lookupLabel(weightTreatmentLabels, fact.weightTreatment, t('fallbacks.unknown')),
        lookupLabel(roleReasonLabels, fact.reasonCode, t('fallbacks.reasonCode', { code: fact.reasonCode })),
        t('roleFacts.institution', {
            role: fact.institutionRole === 'committee'
                ? t('roleFacts.committee')
                : t('roleFacts.target'),
            circleId: fact.institutionCircleId,
        }),
    ].join(' · ');

    return (
        <main className={styles.surface}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>{t('eyebrow')}</p>
                    <h1>{view.title}</h1>
                    <p>{view.subtitle}</p>
                </div>
                <span className={styles.status}>{view.statusLabel}</span>
            </header>

            {view.warnings.length > 0 && (
                <div className={styles.warning} role="status">
                    <AlertTriangle size={16} />
                    <span>{view.warnings[0]}</span>
                </div>
            )}

            <section className={styles.band} aria-labelledby="trace-verification-title">
                <h2 id="trace-verification-title">{t('sections.verification')}</h2>
                <p className={styles.verificationBody}>{t('sections.verificationBody')}</p>
                <details className={styles.technicalDisclosure}>
                    <summary>{t('sections.technicalDetails')}</summary>
                    <h3>{t('sections.proof')}</h3>
                    <dl className={styles.proofGrid}>
                        {view.proofRows.map((row) => (
                            <div key={row.label} className={styles.proofItem}>
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                            </div>
                        ))}
                    </dl>
                    <h3>{t('sections.policy')}</h3>
                    {view.policyRows.length === 0 ? (
                        <p className={styles.empty}>{t('empty.policy')}</p>
                    ) : (
                        <dl className={styles.proofGrid}>
                        {view.policyRows.map((row) => (
                            <div key={row.label} className={styles.proofItem}>
                                <dt>{row.label}</dt>
                                <dd>{row.value}</dd>
                            </div>
                        ))}
                        </dl>
                    )}
                </details>
            </section>

            <section className={styles.band} aria-labelledby="trace-contributors-title">
                <h2 id="trace-contributors-title">{t('sections.contributors')}</h2>
                <div className={styles.contributorList}>
                    {view.contributors.length === 0 && (
                        <p className={styles.empty}>{t('empty.contributors')}</p>
                    )}
                    {view.contributors.map((contributor) => (
                        <article key={contributor.pubkey} className={styles.contributorRow}>
                            <div className={styles.contributorMain}>
                                <span className={styles.avatar}><UserRound size={15} /></span>
                                <div>
                                    <h3>{shortenPubkey(contributor.pubkey)}</h3>
                                    <p>{lookupLabel(roleLabels, contributor.proofRole, t('roles.unknown'))} · {formatContributorStage(contributor.sourceStages)}</p>
                                </div>
                            </div>
                            <div className={styles.weightBlock}>
                                <strong>{formatContributionWeight(contributor.weightBps)}</strong>
                                <span>{formatContributorReason(contributor.sourceTypes, contributor.traceReasons)}</span>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className={styles.band} aria-labelledby="trace-role-facts-title">
                <h2 id="trace-role-facts-title">{t('sections.roleFacts')}</h2>
                <div className={styles.evidenceList}>
                    {view.roleFacts.length === 0 && (
                        <p className={styles.empty}>{t('empty.roleFacts')}</p>
                    )}
                    {view.roleFacts.map((fact) => (
                        <article key={fact.factId} className={styles.evidenceRow}>
                            <div>
                                <h3>{formatRoleFactTitle(fact)}</h3>
                                <p>{formatRoleFactBody(fact)}</p>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className={styles.band} aria-labelledby="trace-events-title">
                <h2 id="trace-events-title">{t('sections.events')}</h2>
                <ol className={styles.timeline}>
                    {view.traceEvents.length === 0 && (
                        <li className={styles.empty}>{t('empty.events')}</li>
                    )}
                    {view.traceEvents.map((event, index) => (
                        <li key={`${event.eventType}:${event.reasonCode}:${index}`} className={styles.timelineItem}>
                            <span className={styles.timelineIcon}><GitBranch size={14} /></span>
                            <div>
                                <h3>{formatTraceEventTitle(event)}</h3>
                                <p>{formatTraceEventBody(event)}</p>
                                {event.evidenceRefs.length > 0 && (
                                    <span>{t('fallbacks.reasonCode', { code: event.reasonCode })} · {event.evidenceRefs.join(', ')}</span>
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            </section>

            <section className={styles.band} aria-labelledby="trace-evidence-title">
                <h2 id="trace-evidence-title">{t('sections.evidence')}</h2>
                <div className={styles.evidenceList}>
                    {view.evidenceRefs.length === 0 && (
                        <p className={styles.empty}>{t('empty.evidence')}</p>
                    )}
                    {view.evidenceRefs.map((ref) => (
                        <article key={ref.refId} className={styles.evidenceRow}>
                            <div>
                                <h3>{lookupLabel(evidenceTypeLabels, ref.refType, t('fallbacks.unknown'))}</h3>
                                <p>{formatEvidenceMeta(ref)}</p>
                            </div>
                            {ref.excerpt && <blockquote>{ref.excerpt}</blockquote>}
                            {!ref.excerpt && view.redacted && <span className={styles.redacted}>{t('redacted')}</span>}
                            <details className={styles.evidenceTechnicalDetails}>
                                <summary>{t('sections.technicalDetails')}</summary>
                                <code>{t('technical.referenceId')}: {ref.refId}</code>
                                {ref.hash && <code>{t('technical.hash')}: {ref.hash}</code>}
                            </details>
                        </article>
                    ))}
                </div>
            </section>

            {view.decisions.length > 0 && (
                <section className={styles.band} aria-labelledby="trace-decisions-title">
                    <h2 id="trace-decisions-title">{t('sections.decisions')}</h2>
                    <div className={styles.decisionList}>
                        {view.decisions.map((decision) => (
                            <article key={decision.id} className={styles.decisionRow}>
                                <ShieldCheck size={15} />
                                <div>
                                    <h3>{lookupLabel(decisionTypeLabels, decision.decisionType, t('decisions.genericTitle'))}</h3>
                                    <p>{formatDecisionReason(decision)} · {decision.createdAt}</p>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}
