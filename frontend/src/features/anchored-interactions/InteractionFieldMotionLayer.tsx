'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import styles from '@/app/(main)/circles/[id]/page.module.css';

export interface InteractionFieldMotionSnapshot {
    interactionId: string;
    anchorType: 'discussion_message' | 'freeform';
    anchorRef: string;
    projectionCursor: number;
    motionKey: number;
    title: string;
    detail: string;
}

interface ActiveMotionEvent {
    key: string;
    title: string;
    detail: string;
    sourceKind: 'visible' | 'above' | 'below' | 'unknown';
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    pathD: string;
}

type InteractionFieldDebugPayload = Record<string, unknown>;

declare global {
    interface Window {
        __alchemeInteractionFieldMotionLast?: InteractionFieldDebugPayload;
    }
}

export default function InteractionFieldMotionLayer({
    enabled,
    motion,
}: {
    enabled: boolean;
    motion: InteractionFieldMotionSnapshot | null;
}) {
    const prefersReducedMotion = usePrefersReducedMotion();
    const [activeMotion, setActiveMotion] = useState<ActiveMotionEvent | null>(null);
    const layerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!motion) {
            debugInteractionMotion('skip:no-motion', { enabled, prefersReducedMotion });
            setActiveMotion(null);
            return undefined;
        }
        if (prefersReducedMotion) {
            debugInteractionMotion('skip:reduced-motion', {
                enabled,
                interactionId: motion.interactionId,
                motionKey: motion.motionKey,
                projectionCursor: motion.projectionCursor,
            });
            setActiveMotion(null);
            return undefined;
        }
        if (!enabled) {
            debugInteractionMotion('skip:disabled', {
                interactionId: motion.interactionId,
                motionKey: motion.motionKey,
                projectionCursor: motion.projectionCursor,
            });
            return undefined;
        }
        debugInteractionMotion('prepare', {
            interactionId: motion.interactionId,
            motionKey: motion.motionKey,
            projectionCursor: motion.projectionCursor,
        });
        setActiveMotion(null);

        let timeout: number | null = null;
        const frame = window.requestAnimationFrame(() => {
            const sourceElement = findInteractionSourceElement(motion);
            const targetElement = document.querySelector<HTMLElement>('[data-interaction-field-target="1"]');
            const source = resolveSourcePoint(sourceElement?.getBoundingClientRect() || null);
            const target = resolveTargetPoint(targetElement?.getBoundingClientRect() || null);
            const activeMotionEvent = {
                key: `${motion.interactionId}:${motion.projectionCursor}:${motion.motionKey}`,
                title: motion.title,
                detail: motion.detail,
                sourceKind: source.kind,
                sourceX: source.x,
                sourceY: source.y,
                targetX: target.x,
                targetY: target.y,
                pathD: buildAbsorptionPath(source.x, source.y, target.x, target.y),
            };
            debugInteractionMotion('mount', {
                interactionId: motion.interactionId,
                motionKey: motion.motionKey,
                projectionCursor: motion.projectionCursor,
                sourceFound: Boolean(sourceElement),
                targetFound: Boolean(targetElement),
                source,
                target,
                pathD: activeMotionEvent.pathD,
                key: activeMotionEvent.key,
                sourceRect: sourceElement ? rectToDebug(sourceElement.getBoundingClientRect()) : null,
                targetRect: targetElement ? rectToDebug(targetElement.getBoundingClientRect()) : null,
            });
            setActiveMotion(activeMotionEvent);
            timeout = window.setTimeout(() => setActiveMotion(null), 3_520);
        });

        return () => {
            window.cancelAnimationFrame(frame);
            if (timeout) window.clearTimeout(timeout);
        };
    }, [
        enabled,
        motion?.anchorRef,
        motion?.anchorType,
        motion?.detail,
        motion?.interactionId,
        motion?.motionKey,
        motion?.projectionCursor,
        motion?.title,
        prefersReducedMotion,
    ]);

    useEffect(() => {
        if (!activeMotion) return undefined;
        const timeouts: number[] = [];
        const previousBodyMotionState = document.body.dataset.interactionFieldMotionActive;
        document.body.dataset.interactionFieldMotionActive = '1';
        const frame = window.requestAnimationFrame(() => {
            debugInteractionMotion('rendered', collectRenderDebug(activeMotion, layerRef.current));
            for (const sampleDelayMs of [80, 350, 900]) {
                timeouts.push(window.setTimeout(() => {
                    const sample = collectRenderDebug(activeMotion, layerRef.current);
                    debugInteractionMotion('rendered:sample', {
                        sampleDelayMs,
                        key: activeMotion.key,
                        cardOpacity: sample.cardOpacity,
                        dotOpacity: sample.dotOpacity,
                        layerRect: sample.layerRect,
                        cardRect: sample.cardRect,
                        dotRect: sample.dotRect,
                        topSourceElement: sample.topSourceElement,
                        topTargetElement: sample.topTargetElement,
                    });
                }, sampleDelayMs));
            }
        });
        return () => {
            window.cancelAnimationFrame(frame);
            if (previousBodyMotionState === undefined) {
                delete document.body.dataset.interactionFieldMotionActive;
            } else {
                document.body.dataset.interactionFieldMotionActive = previousBodyMotionState;
            }
            for (const timeout of timeouts) {
                window.clearTimeout(timeout);
            }
        };
    }, [activeMotion]);

    if (prefersReducedMotion || typeof document === 'undefined' || !activeMotion) return null;

    return createPortal(
        renderMotionLayer(activeMotion, layerRef),
        document.body,
    );
}

function renderMotionLayer(
    renderedMotion: ActiveMotionEvent,
    layerRef: RefObject<HTMLDivElement | null>,
) {
    const style = {
        '--field-motion-source-x': `${renderedMotion.sourceX}px`,
        '--field-motion-source-y': `${renderedMotion.sourceY}px`,
        '--field-motion-target-x': `${renderedMotion.targetX}px`,
        '--field-motion-target-y': `${renderedMotion.targetY}px`,
    } as CSSProperties;
    return (
        <>
            <div
                ref={layerRef}
                key={`${renderedMotion.key}:under`}
                className={styles.interactionFieldMotionUnderLayer}
                data-interaction-field-motion-under-layer="1"
                data-interaction-field-motion-key={renderedMotion.key}
                style={style}
                aria-hidden="true"
            >
                <svg
                    className={styles.interactionFieldMotionSvg}
                    data-interaction-field-motion-svg="1"
                    viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
                    preserveAspectRatio="none"
                >
                    <circle className={styles.interactionFieldMotionHalo} r="9" opacity="0">
                        <animateMotion
                            dur="3.2s"
                            repeatCount="1"
                            fill="freeze"
                            path={renderedMotion.pathD}
                            keyPoints="0;0;1"
                            keyTimes="0;0.56;1"
                            calcMode="spline"
                            keySplines=".2 .8 .2 1;.18 .72 .12 1"
                        />
                        <animate attributeName="opacity" dur="3.2s" repeatCount="1" fill="freeze" values="0;0;0.7;0.58;0.36;0" keyTimes="0;0.48;0.56;0.8;0.92;1" />
                        <animate attributeName="r" dur="3.2s" repeatCount="1" fill="freeze" values="6;6;10;5;1" keyTimes="0;0.54;0.62;0.86;1" />
                    </circle>
                    <circle className={styles.interactionFieldMotionDot} data-interaction-field-motion-dot="1" r="3.5" opacity="0">
                        <animateMotion
                            dur="3.2s"
                            repeatCount="1"
                            fill="freeze"
                            path={renderedMotion.pathD}
                            keyPoints="0;0;1"
                            keyTimes="0;0.56;1"
                            calcMode="spline"
                            keySplines=".2 .8 .2 1;.18 .72 .12 1"
                        />
                        <animate attributeName="opacity" dur="3.2s" repeatCount="1" fill="freeze" values="0;0;1;1;0.62;0" keyTimes="0;0.48;0.56;0.8;0.92;1" />
                        <animate attributeName="r" dur="3.2s" repeatCount="1" fill="freeze" values="2.8;2.8;4.2;2.2;.3" keyTimes="0;0.54;0.62;0.86;1" />
                    </circle>
                </svg>
            </div>
            <div
                key={`${renderedMotion.key}:overlay`}
                className={styles.interactionFieldMotionLayer}
                data-interaction-field-motion-source={renderedMotion.sourceKind}
                data-interaction-field-motion-key={renderedMotion.key}
                style={style}
                aria-hidden="true"
            >
                <span className={styles.interactionFieldScreenCurrent} />
                <div className={styles.interactionFieldMotionCard} data-interaction-field-motion-card="1">
                    <strong>{renderedMotion.title}</strong>
                    <span>{renderedMotion.detail}</span>
                </div>
                <span className={styles.interactionFieldIntakeRipple} />
            </div>
        </>
    );
}

function collectRenderDebug(
    activeMotion: ActiveMotionEvent,
    layer: HTMLDivElement | null,
): InteractionFieldDebugPayload {
    const ownerDocument = layer?.ownerDocument || document;
    const svg = layer?.querySelector<SVGSVGElement>('[data-interaction-field-motion-svg="1"]') || null;
    const dot = layer?.querySelector<SVGCircleElement>('[data-interaction-field-motion-dot="1"]') || null;
    const card = layer?.querySelector<HTMLElement>('[data-interaction-field-motion-card="1"]')
        || ownerDocument.querySelector<HTMLElement>('[data-interaction-field-motion-card="1"]')
        || null;
    const sourceStack = elementsFromPointToDebug(activeMotion.sourceX, activeMotion.sourceY);
    const targetStack = elementsFromPointToDebug(activeMotion.targetX, activeMotion.targetY);
    return {
        key: activeMotion.key,
        inBody: Boolean(layer && layer.parentElement === layer.ownerDocument.body),
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
        },
        layer: elementToDebug(layer),
        svg: elementToDebug(svg),
        dot: elementToDebug(dot),
        card: elementToDebug(card),
        layerRect: layer ? rectToDebug(layer.getBoundingClientRect()) : null,
        cardRect: card ? rectToDebug(card.getBoundingClientRect()) : null,
        dotRect: dot ? rectToDebug(dot.getBoundingClientRect()) : null,
        cardOpacity: card ? window.getComputedStyle(card).opacity : null,
        dotOpacity: dot ? window.getComputedStyle(dot).opacity : null,
        sourceStack,
        targetStack,
        topSourceElement: sourceStack[0] || null,
        topTargetElement: targetStack[0] || null,
    };
}

function usePrefersReducedMotion(): boolean {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        setPrefersReducedMotion(mediaQuery.matches);
        const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
        mediaQuery.addEventListener?.('change', handleChange);
        return () => mediaQuery.removeEventListener?.('change', handleChange);
    }, []);

    return prefersReducedMotion;
}

function findInteractionSourceElement(motion: InteractionFieldMotionSnapshot): HTMLElement | null {
    const interactionSelector = `[data-anchored-interaction-id="${escapeCss(motion.interactionId)}"]`;
    const interactionElement = document.querySelector<HTMLElement>(interactionSelector);
    if (interactionElement) return interactionElement;
    if (motion.anchorType !== 'discussion_message' || !motion.anchorRef) return null;
    return document.querySelector<HTMLElement>(`[data-envelope-id="${escapeCss(motion.anchorRef)}"]`);
}

function resolveSourcePoint(rect: DOMRect | null): {
    kind: ActiveMotionEvent['sourceKind'];
    x: number;
    y: number;
} {
    const fallbackY = Math.min(Math.max(window.innerHeight * 0.32, 120), window.innerHeight - 96);
    if (!rect) return { kind: 'unknown', x: 24, y: fallbackY };
    if (rect.bottom < 0) return { kind: 'above', x: Math.max(rect.left, 22), y: 18 };
    if (rect.top > window.innerHeight) {
        return { kind: 'below', x: Math.max(rect.left, 22), y: window.innerHeight - 86 };
    }
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight);
    return {
        kind: 'visible',
        x: Math.max(rect.left - 4, 18),
        y: visibleTop + (visibleBottom - visibleTop) / 2,
    };
}

function resolveTargetPoint(rect: DOMRect | null): { x: number; y: number } {
    if (!rect) return { x: window.innerWidth - 42, y: 126 };
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    };
}

function buildAbsorptionPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
    const flowY = clamp(Math.max(sourceY + 76, targetY + 38), 72, window.innerHeight - 48);
    const firstBendX = sourceX + Math.max(26, Math.min(92, Math.abs(targetX - sourceX) * 0.18));
    const secondBendX = targetX - Math.max(42, Math.min(112, Math.abs(targetX - sourceX) * 0.24));
    return [
        `M ${round(sourceX)} ${round(sourceY)}`,
        `C ${round(firstBendX)} ${round(flowY)}, ${round(secondBendX)} ${round(flowY)}, ${round(targetX)} ${round(targetY)}`,
    ].join(' ');
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

function escapeCss(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return value.replace(/["\\]/g, '\\$&');
}

function debugInteractionMotion(event: string, payload: InteractionFieldDebugPayload): void {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return;
    const snapshot = {
        event,
        at: new Date().toISOString(),
        ...payload,
    };
    window.__alchemeInteractionFieldMotionLast = snapshot;
    console.info('[interaction-field:motion]', snapshot);
}

function rectToDebug(rect: DOMRect): InteractionFieldDebugPayload {
    return {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        top: round(rect.top),
        right: round(rect.right),
        bottom: round(rect.bottom),
        left: round(rect.left),
    };
}

function elementToDebug(element: Element | null): InteractionFieldDebugPayload | null {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : String(element.className),
        rect: rectToDebug(rect),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
        position: style.position,
        overflow: style.overflow,
        transform: style.transform,
        animationName: style.animationName,
        animationPlayState: style.animationPlayState,
        pointerEvents: style.pointerEvents,
    };
}

function elementsFromPointToDebug(x: number, y: number): InteractionFieldDebugPayload[] {
    if (typeof document.elementsFromPoint !== 'function') return [];
    return document.elementsFromPoint(x, y).slice(0, 8).map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === 'string' ? element.className : String(element.className),
        id: element.id || null,
        motionLayer: element.hasAttribute('data-interaction-field-motion-key'),
        motionCard: element.hasAttribute('data-interaction-field-motion-card'),
        motionSvg: element.hasAttribute('data-interaction-field-motion-svg'),
        text: element.textContent?.trim().slice(0, 80) || '',
    }));
}
