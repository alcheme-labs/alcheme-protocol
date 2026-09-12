'use client';

import { useEffect, useState } from 'react';

import type {
    CircleCognitiveMapViewModel,
    CognitiveEvolutionStep,
} from './adapter';
import { useI18n } from '@/i18n/useI18n';
import CognitiveMapCanvas from './CognitiveMapCanvas';
import styles from './CircleSummaryScaffold.module.css';

interface CognitiveEvolutionRouteProps {
    map: CircleCognitiveMapViewModel;
    steps: CognitiveEvolutionStep[];
    reduceMotion: boolean;
    focusedNodeId: string | null;
    onFocusNode: (nodeId: string | null) => void;
}

export default function CognitiveEvolutionRoute({
    map,
    steps,
    reduceMotion,
    focusedNodeId,
    onFocusNode,
}: CognitiveEvolutionRouteProps) {
    const t = useI18n('CircleSummaryCognitiveMap');
    const [expanded, setExpanded] = useState(false);
    const [activeStepIndex, setActiveStepIndex] = useState(0);
    const [playing, setPlaying] = useState(false);
    const activeStep = steps[Math.min(activeStepIndex, steps.length - 1)] ?? null;
    const evolutionState = steps.length === 0 ? 'empty' : steps.length === 1 ? 'single' : 'timeline';

    useEffect(() => {
        if (activeStepIndex <= steps.length - 1) return;
        setActiveStepIndex(Math.max(0, steps.length - 1));
    }, [activeStepIndex, steps.length]);

    useEffect(() => {
        if (reduceMotion) {
            setPlaying(false);
        }
    }, [reduceMotion]);

    useEffect(() => {
        if (!playing || reduceMotion || steps.length === 0) return;
        const step = steps[activeStepIndex] ?? steps[steps.length - 1];
        const timeout = window.setTimeout(() => {
            setActiveStepIndex((index) => {
                if (index >= steps.length - 1) {
                    setPlaying(false);
                    return index;
                }
                return index + 1;
            });
        }, step.motion.durationMs + (step.motion.pauseAfterMs ?? 650));
        return () => window.clearTimeout(timeout);
    }, [activeStepIndex, playing, reduceMotion, steps]);

    const pause = () => setPlaying(false);
    const play = () => {
        if (steps.length === 0) return;
        setExpanded(true);
        setPlaying(!reduceMotion);
    };
    const replay = () => {
        setExpanded(true);
        setActiveStepIndex(0);
        setPlaying(!reduceMotion);
    };
    const previous = () => {
        pause();
        setActiveStepIndex((index) => Math.max(0, index - 1));
    };
    const next = () => {
        pause();
        setActiveStepIndex((index) => Math.min(steps.length - 1, index + 1));
    };

    if (steps.length === 0) {
        return (
            <section className={styles.evolutionRoute} data-evolution-state="empty">
                <div className={styles.sectionHead}>
                    <h2 className={styles.sectionTitle}>{t('evolution.empty.title')}</h2>
                </div>
                <p className={styles.evolutionEmptyText}>{t('evolution.empty.body')}</p>
            </section>
        );
    }

    if (!expanded) {
        return (
            <section className={styles.evolutionRoute} data-evolution-state={evolutionState}>
                <button
                    type="button"
                    className={styles.evolutionToggle}
                    onClick={() => setExpanded(true)}
                >
                    {t('evolution.toggle')}
                </button>
            </section>
        );
    }

    return (
        <section className={styles.evolutionRoute} data-evolution-state={evolutionState}>
            <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>{t('evolution.title')}</h2>
                <span className={styles.sectionMeta}>
                    {steps.length === 1
                        ? t('evolution.singleStep')
                        : reduceMotion ? t('evolution.staticMode') : t('evolution.motionMode')}
                </span>
            </div>

            <div className={styles.evolutionControls}>
                <button
                    type="button"
                    aria-label={t('evolution.controls.previous')}
                    onClick={previous}
                    disabled={activeStepIndex === 0}
                >
                    {t('evolution.controls.previous')}
                </button>
                <button
                    type="button"
                    aria-label={playing ? t('evolution.controls.pause') : t('evolution.controls.play')}
                    onClick={playing ? pause : play}
                >
                    {playing ? t('evolution.controls.pause') : t('evolution.controls.play')}
                </button>
                <button
                    type="button"
                    aria-label={t('evolution.controls.next')}
                    onClick={next}
                    disabled={activeStepIndex >= steps.length - 1}
                >
                    {t('evolution.controls.next')}
                </button>
                <button
                    type="button"
                    aria-label={t('evolution.controls.replay')}
                    onClick={replay}
                >
                    {t('evolution.controls.replay')}
                </button>
            </div>

            <CognitiveMapCanvas
                map={map}
                mode="routes"
                focusedNodeId={focusedNodeId}
                activeStep={activeStep ? {
                    stepId: activeStep.id,
                    highlightNodeIds: activeStep.highlightNodeIds,
                    highlightEdgeIds: activeStep.highlightEdgeIds,
                } : null}
                onFocusNode={onFocusNode}
                onUserFocusDuringPlayback={pause}
            />

            <label className={styles.evolutionScrubber}>
                <span>{activeStep ? activeStep.title : t('evolution.title')}</span>
                <input
                    type="range"
                    aria-label={t('evolution.controls.scrubber')}
                    min={0}
                    max={Math.max(0, steps.length - 1)}
                    value={activeStepIndex}
                    onChange={(event) => {
                        pause();
                        setActiveStepIndex(Number(event.currentTarget.value));
                    }}
                />
            </label>

            <ol className={styles.evolutionList}>
                {steps.map((step, index) => (
                    <li
                        key={step.id}
                        className={styles.evolutionStep}
                        data-evolution-step
                        data-active={index === activeStepIndex ? 'true' : 'false'}
                        data-intent={reduceMotion ? 'static' : step.motion.intent}
                    >
                        <button
                            type="button"
                            className={styles.evolutionStepButton}
                            onClick={() => {
                                pause();
                                setActiveStepIndex(index);
                                if (step.focusNodeId) {
                                    onFocusNode(step.focusNodeId);
                                }
                            }}
                        >
                            <span className={styles.evolutionIndex}>{index + 1}</span>
                            <span className={styles.evolutionStepBody}>
                                <strong>{step.title}</strong>
                                <small>{reduceMotion ? step.reducedMotionLabel : step.summary}</small>
                            </span>
                        </button>
                    </li>
                ))}
            </ol>
        </section>
    );
}
