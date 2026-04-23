'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
    buildSummaryDependencyViewModel,
    createCircleSummaryCopy,
    formatCircleSummaryGeneratedByLabel,
    formatCircleSummaryProviderModeLabel,
    formatSummaryDegradationLabel,
    resolveCircleSummaryPresentation,
    type CircleSummarySnapshot,
    type FrozenSummaryDraftConsumption,
} from '@/features/circle-summary/adapter';
import type { CrystalOutputViewModel } from '@/features/crystal-output/adapter';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import SummaryReadinessPanel from './SummaryReadinessPanel';
import styles from './CircleSummaryScaffold.module.css';

interface CircleSummaryScaffoldProps {
    circleId: number;
    snapshot: CircleSummarySnapshot | null;
    snapshotLoading: boolean;
    snapshotError: string | null;
    draft: FrozenSummaryDraftConsumption | null;
    draftLoading: boolean;
    draftError: string | null;
    outputs: CrystalOutputViewModel[];
    outputsLoading: boolean;
    outputsError: string | null;
}

export function CircleSummaryScaffold({
    circleId,
    snapshot,
    snapshotLoading,
    snapshotError,
    draft,
    draftLoading,
    draftError,
    outputs,
    outputsLoading,
    outputsError,
}: CircleSummaryScaffoldProps) {
    const t = useI18n('CircleSummaryScaffold');
    const adapterT = useI18n('CircleSummaryAdapter');
    const locale = useCurrentLocale();
    const summaryCopy = useMemo(() => createCircleSummaryCopy(adapterT, locale), [adapterT, locale]);
    const primaryOutput = outputs[0] || null;
    const summaryDependency = buildSummaryDependencyViewModel({
        draft,
        outputs,
    });
    const presentation = resolveCircleSummaryPresentation({
        circleId,
        snapshot,
        draft,
        outputs,
        copy: summaryCopy,
    });
    const summaryMap = presentation.summaryMap;
    const snapshotSourceDraftPostId = snapshot
        ? snapshot.viewpointBranches
            .map((branch) => {
                if (!branch || typeof branch !== 'object' || Array.isArray(branch)) return null;
                const parsed = Number((branch as Record<string, unknown>).sourceDraftPostId);
                return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
            })
            .find((value): value is number => value !== null) ?? null
        : null;
    const sourceDraftPostId = draft?.document.draftPostId ?? snapshotSourceDraftPostId ?? primaryOutput?.sourceDraftPostId ?? null;
    const hasOutputWarning = Boolean(outputsError && outputs.length > 0);
    const hasBlockingError = Boolean(draftError || snapshotError || (outputsError && outputs.length === 0));
    const [focusedBranchId, setFocusedBranchId] = useState<string | null>(summaryMap?.defaultFocusBranchId ?? null);

    useEffect(() => {
        setFocusedBranchId(summaryMap?.defaultFocusBranchId ?? null);
    }, [summaryMap?.defaultFocusBranchId]);

    const focusedBranch = useMemo(
        () => summaryMap
            ? summaryMap.branches.find((branch) => branch.knowledgeId === focusedBranchId) || summaryMap.branches[0] || null
            : null,
        [focusedBranchId, summaryMap],
    );

    if (!summaryMap) {
        return (
            <main className={styles.page}>
                <div className={styles.hero}>
                    <div className={styles.heroCopy}>
                        <div className={styles.eyebrow}>{summaryCopy.hero.eyebrow}</div>
                        <h1 className={styles.title}>{summaryCopy.hero.title(circleId)}</h1>
                        <p className={styles.lead}>{t('pending.heroLead')}</p>
                    </div>
                    <div className={styles.heroActions}>
                        <Link href={`/circles/${circleId}`} className={styles.backLink}>
                            {t('common.backToCircle')}
                        </Link>
                    </div>
                </div>

                <section className={styles.outputsSection}>
                    <article className={styles.card}>
                        <p className={styles.cardBody}>
                            {snapshotLoading
                                ? t('pending.snapshotLoading')
                                : snapshotError
                                    ? snapshotError
                                    : t('pending.snapshotEmpty')}
                        </p>
                    </article>
                </section>

                <SummaryReadinessPanel
                    sourceDraftPostId={sourceDraftPostId}
                    missingTeam03Inputs={summaryDependency.missingTeam03Inputs}
                    snapshotDiagnostics={presentation.diagnostics}
                    summarySource={presentation.source}
                />

                {(draftLoading || outputsLoading || hasBlockingError || hasOutputWarning || sourceDraftPostId !== null || summaryDependency.missingTeam03Inputs.length > 0) && (
                    <section className={styles.appendix}>
                        <div className={styles.sectionHead}>
                            <h2 className={styles.sectionTitle}>{t('appendix.title')}</h2>
                            <span className={styles.sectionMeta}>{t('appendix.meta')}</span>
                        </div>
                        <div className={styles.appendixBody}>
                            {draftLoading && (
                                <p className={styles.cardBody}>{t('appendix.loadingDraft')}</p>
                            )}
                            {outputsLoading && (
                                <p className={styles.cardBody}>{t('appendix.loadingOutputs')}</p>
                            )}
                            {sourceDraftPostId !== null && (
                                <p className={styles.cardBody}>{t('appendix.sourceDraftReady', {draftPostId: sourceDraftPostId})}</p>
                            )}
                            <p className={styles.cardBody}>
                                {t('appendix.forkLineageNote')}
                            </p>
                            {summaryDependency.missingTeam03Inputs.length > 0 && (
                                <div className={styles.degradationWrap}>
                                    {summaryDependency.missingTeam03Inputs.map((item) => (
                                        <span key={item} className={styles.degradationChip}>
                                            {t('appendix.degradationPrefix', {
                                                label: formatSummaryDegradationLabel(item, summaryCopy),
                                            })}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {(hasBlockingError || hasOutputWarning) && (
                                <div className={styles.appendixErrors}>
                                    {snapshotError && <p className={styles.cardBody}>{snapshotError}</p>}
                                    {draftError && <p className={styles.cardBody}>{draftError}</p>}
                                    {outputsError && <p className={styles.cardBody}>{outputsError}</p>}
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <div className={styles.hero}>
                <div className={styles.heroCopy}>
                    <div className={styles.eyebrow}>{summaryMap.hero.eyebrow}</div>
                    <h1 className={styles.title}>{summaryMap.hero.title}</h1>
                    <p className={styles.lead}>{summaryMap.hero.lead}</p>
                </div>
                <div className={styles.heroActions}>
                    <Link href={`/circles/${circleId}`} className={styles.backLink}>
                        {t('common.backToCircle')}
                    </Link>
                </div>
            </div>

            <section className={styles.outputsSection}>
                <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>{t('sections.primaryRoutes.title')}</h2>
                    <span className={styles.sectionMeta}>{t('sections.primaryRoutes.meta')}</span>
                </div>

                {outputsLoading ? (
                    <article className={styles.card}>
                        <p className={styles.cardBody}>{t('sections.primaryRoutes.loading')}</p>
                    </article>
                ) : outputs.length === 0 && outputsError ? (
                    <article className={styles.card}>
                        <p className={styles.cardBody}>{outputsError}</p>
                    </article>
                ) : outputs.length === 0 ? (
                    <div className={styles.routeStage}>
                        <div className={styles.routeMap}>
                            <div className={styles.routeStop}>
                                <div className={styles.routeRail} aria-hidden="true">
                                    <span className={styles.routeDot} data-active="true" />
                                </div>
                                <div className={styles.routeCardButton} data-active="true" aria-disabled="true">
                                    <span className={styles.branchRouteLabel}>{t('sections.primaryRoutes.empty.routeLabel')}</span>
                                    <strong className={styles.routeCardTitle}>{t('sections.primaryRoutes.empty.title')}</strong>
                                    <span className={styles.routeCardHint}>{t('sections.primaryRoutes.empty.hint')}</span>
                                </div>
                            </div>
                        </div>

                        <article className={styles.branchCard}>
                            <div className={styles.branchHeader}>
                                <div>
                                    <div className={styles.branchRouteLabel}>{t('sections.primaryRoutes.empty.currentStartingPoint')}</div>
                                    <h3 className={styles.branchTitle}>{t('sections.primaryRoutes.empty.cardTitle')}</h3>
                                    <p className={styles.branchRouteHint}>{t('sections.primaryRoutes.empty.cardHint')}</p>
                                </div>
                            </div>

                            <div className={styles.branchSummaryRow}>
                                <span className={styles.branchStatus}>{t('sections.primaryRoutes.empty.status')}</span>
                                <p className={styles.branchBody}>
                                    {summaryMap.issueMap[0]?.body || t('sections.primaryRoutes.empty.bodyFallback')}
                                </p>
                            </div>

                            <div className={styles.branchFacts}>
                                <div className={styles.branchFact}>
                                    <span className={styles.branchFactLabel}>{t('sections.primaryRoutes.empty.facts.missingLabel')}</span>
                                    <span className={styles.branchFactValue}>{t('sections.primaryRoutes.empty.facts.missingValue')}</span>
                                </div>
                                <div className={styles.branchFact}>
                                    <span className={styles.branchFactLabel}>{t('sections.primaryRoutes.empty.facts.draftBaselineLabel')}</span>
                                    <span className={styles.branchFactValue}>
                                        {sourceDraftPostId !== null
                                            ? t('sections.primaryRoutes.empty.facts.draftBaselineValueWithDraft', {draftPostId: sourceDraftPostId})
                                            : t('sections.primaryRoutes.empty.facts.draftBaselineValueWithoutDraft')}
                                    </span>
                                </div>
                                <div className={styles.branchFact}>
                                    <span className={styles.branchFactLabel}>{t('sections.primaryRoutes.empty.facts.nextStepLabel')}</span>
                                    <span className={styles.branchFactValue}>{t('sections.primaryRoutes.empty.facts.nextStepValue')}</span>
                                </div>
                            </div>
                        </article>
                    </div>
                ) : (
                    <div className={styles.routeStage}>
                        <div className={styles.routeMap}>
                            {summaryMap.branches.map((branch, index) => {
                                const isActive = focusedBranch?.knowledgeId === branch.knowledgeId;
                                return (
                                    <div key={branch.knowledgeId} className={styles.routeStop}>
                                        <div className={styles.routeRail} aria-hidden="true">
                                            <span className={styles.routeDot} data-active={isActive ? 'true' : 'false'} />
                                            {index < summaryMap.branches.length - 1 && (
                                                <span className={styles.routeLine} />
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.routeCardButton}
                                            data-active={isActive ? 'true' : 'false'}
                                            onClick={() => setFocusedBranchId(branch.knowledgeId)}
                                        >
                                            <span className={styles.branchRouteLabel}>{branch.routeLabel}</span>
                                            <strong className={styles.routeCardTitle}>{branch.title}</strong>
                                            <span className={styles.routeCardHint}>{branch.routeHint}</span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {focusedBranch && (
                            <article className={styles.branchCard}>
                                <div className={styles.branchHeader}>
                                    <div>
                                        <div className={styles.branchRouteLabel}>{focusedBranch.routeLabel}</div>
                                        <h3 className={styles.branchTitle}>{focusedBranch.title}</h3>
                                        <p className={styles.branchRouteHint}>{focusedBranch.routeHint}</p>
                                    </div>
                                    <div className={styles.branchMetaStack}>
                                        <span className={styles.branchBadge}>{focusedBranch.evidenceLabel}</span>
                                        <span className={styles.branchVersion}>{focusedBranch.versionLabel}</span>
                                    </div>
                                </div>

                                <div className={styles.branchSummaryRow}>
                                    <span className={styles.branchStatus}>{focusedBranch.statusLabel}</span>
                                    <p className={styles.branchBody}>{focusedBranch.evidenceSummary}</p>
                                </div>

                                <div className={styles.branchFacts}>
                                    <div className={styles.branchFact}>
                                        <span className={styles.branchFactLabel}>{t('sections.primaryRoutes.facts.source')}</span>
                                        <span className={styles.branchFactValue}>{focusedBranch.bindingLabel}</span>
                                    </div>
                                    <div className={styles.branchFact}>
                                        <span className={styles.branchFactLabel}>{t('sections.primaryRoutes.facts.impact')}</span>
                                        <span className={styles.branchFactValue}>{focusedBranch.citationSummary}</span>
                                    </div>
                                    <div className={styles.branchFact}>
                                        <span className={styles.branchFactLabel}>{t('sections.primaryRoutes.facts.stabilizedAt')}</span>
                                        <span className={styles.branchFactValue}>{focusedBranch.createdAtLabel}</span>
                                    </div>
                                </div>

                                {focusedBranch.degradationLabels.length > 0 && (
                                    <div className={styles.degradationWrap}>
                                        {focusedBranch.degradationLabels.map((label) => (
                                            <span key={label} className={styles.degradationChip}>
                                                {t('sections.primaryRoutes.degradationPrefix', {label})}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </article>
                        )}
                    </div>
                )}
            </section>

            <section className={styles.mapSection}>
                <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>{t('sections.issueMap.title')}</h2>
                    <span className={styles.sectionMeta}>{t('sections.issueMap.meta')}</span>
                </div>

                <div className={styles.issueGrid}>
                    {summaryMap.issueMap.map((card) => (
                        <article key={card.title} className={styles.issueCard} data-emphasis={card.emphasis}>
                            <h3 className={styles.cardTitle}>{card.title}</h3>
                            <p className={styles.cardBody}>{card.body}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className={styles.stateSection}>
                <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>{t('sections.situation.title')}</h2>
                    <span className={styles.sectionMeta}>{t('sections.situation.meta')}</span>
                </div>
                <div className={styles.situationGrid}>
                    {summaryMap.situation.map((item) => (
                        <article key={item.label} className={styles.situationCard} data-tone={item.tone}>
                            <span className={styles.situationLabel}>{item.label}</span>
                            <strong className={styles.situationValue}>{item.value}</strong>
                            <p className={styles.situationDescription}>{item.description}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className={styles.lowerGrid}>
                <article className={styles.card}>
                    <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>{t('sections.coverage.title')}</h2>
                        <span className={styles.sectionMeta}>{t('sections.coverage.meta')}</span>
                    </div>
                    <div className={styles.coverageGrid}>
                        {summaryMap.coverage.map((item) => (
                            <div key={item.label} className={styles.coverageCard}>
                                <span className={styles.coverageLabel}>{item.label}</span>
                                <strong className={styles.coverageValue}>{item.value}</strong>
                                <p className={styles.coverageBody}>{item.description}</p>
                            </div>
                        ))}
                    </div>
                </article>

                <article className={styles.card}>
                    <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>{t('sections.timeline.title')}</h2>
                        <span className={styles.sectionMeta}>{t('sections.timeline.meta')}</span>
                    </div>
                    <div className={styles.timeline}>
                        {summaryMap.timeline.length === 0 ? (
                            <p className={styles.cardBody}>{t('sections.timeline.empty')}</p>
                        ) : (
                            summaryMap.timeline.map((item) => (
                                <div key={item.key} className={styles.timelineItem}>
                                    <span className={styles.timelineDot} aria-hidden="true" />
                                    <div className={styles.timelineContent}>
                                        <div className={styles.timelineHead}>
                                            <h3 className={styles.timelineTitle}>{item.title}</h3>
                                            <span className={styles.timelineTime}>{item.timeLabel}</span>
                                        </div>
                                        <p className={styles.timelineSummary}>{item.summary}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </article>
            </section>

            <section className={styles.lowerGrid}>
                <article className={styles.card}>
                    <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>{t('sections.questions.title')}</h2>
                        <span className={styles.sectionMeta}>{t('sections.questions.meta')}</span>
                    </div>
                    <div className={styles.questions}>
                        {summaryMap.openQuestions.length === 0 ? (
                            <p className={styles.cardBody}>
                                {t('sections.questions.empty')}
                            </p>
                        ) : (
                            summaryMap.openQuestions.map((item) => (
                                <article key={item.title} className={styles.questionCard}>
                                    <h3 className={styles.cardTitle}>{item.title}</h3>
                                    <p className={styles.cardBody}>{item.body}</p>
                                </article>
                            ))
                        )}
                    </div>
                </article>

                <article className={styles.card}>
                    <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>{t('sections.entry.title')}</h2>
                        <span className={styles.sectionMeta}>{t('sections.entry.meta')}</span>
                    </div>
                    <div className={styles.entryList}>
                        <div className={styles.entryCard}>
                            <span className={styles.entryRole}>{t('sections.entry.newcomer.role')}</span>
                            <p className={styles.cardBody}>
                                {t('sections.entry.newcomer.body')}
                            </p>
                        </div>
                        <div className={styles.entryCard}>
                            <span className={styles.entryRole}>{t('sections.entry.participant.role')}</span>
                            <p className={styles.cardBody}>
                                {t('sections.entry.participant.body')}
                            </p>
                        </div>
                    </div>
                </article>
            </section>

            <SummaryReadinessPanel
                sourceDraftPostId={sourceDraftPostId}
                missingTeam03Inputs={summaryDependency.missingTeam03Inputs}
                snapshotDiagnostics={presentation.diagnostics}
                summarySource={presentation.source}
            />

            {(draftLoading || hasBlockingError || hasOutputWarning || sourceDraftPostId !== null || summaryDependency.missingTeam03Inputs.length > 0) && (
                <section className={styles.appendix}>
                    <div className={styles.sectionHead}>
                        <h2 className={styles.sectionTitle}>{t('appendix.title')}</h2>
                        <span className={styles.sectionMeta}>{t('appendix.meta')}</span>
                    </div>
                    <div className={styles.appendixBody}>
                        {snapshotLoading && (
                            <p className={styles.cardBody}>{t('appendix.loadingSnapshot')}</p>
                        )}
                        {presentation.diagnostics && (
                            <p className={styles.cardBody}>
                                {t('appendix.snapshotPriorityLead', {version: presentation.diagnostics.version})}
                                {' '}
                                {formatCircleSummaryGeneratedByLabel(presentation.diagnostics.generatedBy, summaryCopy)}
                                {presentation.diagnostics.generationMetadata
                                    ? t('appendix.snapshotPriorityWithMode', {
                                        providerMode: formatCircleSummaryProviderModeLabel(
                                            presentation.diagnostics.generationMetadata.providerMode,
                                            summaryCopy,
                                        ),
                                    })
                                    : t('appendix.snapshotPriorityWithoutMode')}
                            </p>
                        )}
                        {draftLoading && (
                            <p className={styles.cardBody}>{t('appendix.loadingDraft')}</p>
                        )}
                        {sourceDraftPostId !== null && (
                            <p className={styles.cardBody}>{t('appendix.sourceDraftReady', {draftPostId: sourceDraftPostId})}</p>
                        )}
                        <p className={styles.cardBody}>
                            {t('appendix.forkLineageNote')}
                        </p>
                        {summaryDependency.missingTeam03Inputs.length > 0 && (
                            <div className={styles.degradationWrap}>
                                {summaryDependency.missingTeam03Inputs.map((item) => (
                                    <span key={item} className={styles.degradationChip}>
                                        {t('appendix.degradationPrefix', {
                                            label: formatSummaryDegradationLabel(item, summaryCopy),
                                        })}
                                    </span>
                                ))}
                            </div>
                        )}
                        {(hasBlockingError || hasOutputWarning) && (
                            <div className={styles.appendixErrors}>
                                {snapshotError && <p className={styles.cardBody}>{snapshotError}</p>}
                                {draftError && <p className={styles.cardBody}>{draftError}</p>}
                                {outputsError && <p className={styles.cardBody}>{outputsError}</p>}
                            </div>
                        )}
                    </div>
                </section>
            )}
        </main>
    );
}

export default CircleSummaryScaffold;
