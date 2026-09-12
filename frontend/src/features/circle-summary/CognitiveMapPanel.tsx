import { useState } from 'react';

import type { CircleCognitiveMapViewModel } from './adapter';
import { useI18n } from '@/i18n/useI18n';
import CognitiveMapCanvas, { type CognitiveMapCanvasMode } from './CognitiveMapCanvas';
import CognitiveMapNodeDetail from './CognitiveMapNodeDetail';
import styles from './CircleSummaryScaffold.module.css';

interface CognitiveMapPanelProps {
    map: CircleCognitiveMapViewModel;
    focusedNodeId: string | null;
    onFocusNode: (nodeId: string | null) => void;
}

export default function CognitiveMapPanel({
    map,
    focusedNodeId,
    onFocusNode,
}: CognitiveMapPanelProps) {
    const t = useI18n('CircleSummaryCognitiveMap');
    const [mapMode, setMapMode] = useState<CognitiveMapCanvasMode>('position');
    const focusedNode = map.topology.nodes.find((node) => node.id === focusedNodeId)
        || map.topology.nodes.find((node) => node.relationToCurrent === 'current')
        || map.topology.nodes[0]
        || null;
    const recommendedRoute = map.routes.find((route) => route.role === 'recommended_start')
        || map.routes[0]
        || null;
    const canvasFocusedNodeId = focusedNode?.id ?? null;

    return (
        <section className={styles.mapOverview}>
            <div className={styles.mapHeader}>
                <div>
                    <span className={styles.eyebrow}>{t('eyebrow')}</span>
                    <h2 className={styles.sectionTitle}>{map.title}</h2>
                    <p className={styles.cardBody}>{map.visibleFocus}</p>
                </div>
                <div className={styles.mapNextAction}>
                    <span className={styles.branchRouteLabel}>{t('recommendedStart')}</span>
                    <strong>{recommendedRoute?.title || focusedNode?.title || map.title}</strong>
                    <small>{recommendedRoute?.evidenceLabel || map.ai.fallbackReason}</small>
                </div>
            </div>

            <div className={styles.mapSignals}>
                <div className={styles.mapSignal}>
                    <span>{map.mapStatus.stableConclusionCount}</span>
                    <small>{t('signals.stableRoutes')}</small>
                </div>
                <div className={styles.mapSignal}>
                    <span>{map.mapStatus.pendingQuestionCount}</span>
                    <small>{t('signals.openQuestions')}</small>
                </div>
                <div className={styles.mapSignal}>
                    <span>{map.mapStatus.evidenceGapCount}</span>
                    <small>{t('signals.evidenceGaps')}</small>
                </div>
                <div className={styles.mapSignal}>
                    <span>{map.mapStatus.hasDraftBaseline ? t('signals.yes') : t('signals.no')}</span>
                    <small>{t('signals.draftBaseline')}</small>
                </div>
            </div>

            <div className={styles.topologyStage}>
                <div className={styles.mapCanvasColumn}>
                    <div className={styles.mapModeTabs} role="tablist" aria-label={t('modes.label')}>
                        {(['position', 'routes'] as const).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                role="tab"
                                aria-selected={mapMode === mode}
                                className={styles.mapModeTab}
                                data-active={mapMode === mode ? 'true' : 'false'}
                                onClick={() => setMapMode(mode)}
                            >
                                {t(`modes.${mode}`)}
                            </button>
                        ))}
                    </div>
                    <CognitiveMapCanvas
                        map={map}
                        mode={mapMode}
                        focusedNodeId={canvasFocusedNodeId}
                        onFocusNode={onFocusNode}
                    />
                    {map.topology.collapsedGroups.length > 0 && (
                        <div className={styles.collapsedGroupRow}>
                            {map.topology.collapsedGroups.map((group) => (
                                <button
                                    key={group.id}
                                    type="button"
                                    className={styles.collapsedGroupButton}
                                    onClick={() => onFocusNode(null)}
                                >
                                    <span>{t(`collapsed.${group.kind}`, {count: group.count})}</span>
                                    <small>{t(`collapsedReason.${group.kind}`)}</small>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {focusedNode && (
                    <CognitiveMapNodeDetail node={focusedNode} />
                )}
            </div>
        </section>
    );
}
