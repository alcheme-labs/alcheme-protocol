'use client';

import type {
    CircleCognitiveMapViewModel,
    CognitiveMapNodeView,
} from './adapter';
import { useI18n } from '@/i18n/useI18n';
import styles from './CircleSummaryScaffold.module.css';

export type CognitiveMapCanvasMode = 'position' | 'routes';
type CognitiveMapState = 'empty' | 'single' | 'network';

export interface CognitiveMapCanvasActiveStep {
    stepId: string;
    highlightNodeIds: string[];
    highlightEdgeIds: string[];
}

interface Point {
    x: number;
    y: number;
}

type LabelAnchor = 'top' | 'right' | 'bottom' | 'left';

interface PositionedNode {
    node: CognitiveMapNodeView;
    point: Point;
    labelAnchor: LabelAnchor;
}

interface CognitiveMapCanvasProps {
    map: CircleCognitiveMapViewModel;
    mode: CognitiveMapCanvasMode;
    focusedNodeId: string | null;
    activeStep?: CognitiveMapCanvasActiveStep | null;
    onFocusNode: (nodeId: string | null) => void;
    onUserFocusDuringPlayback?: () => void;
}

export default function CognitiveMapCanvas({
    map,
    mode,
    focusedNodeId,
    activeStep,
    onFocusNode,
    onUserFocusDuringPlayback,
}: CognitiveMapCanvasProps) {
    const t = useI18n('CircleSummaryCognitiveMap');
    const nodes = selectCanvasNodes(map.topology.nodes, mode);
    const supportingNodeCount = nodes.filter((node) => node.kind !== 'current_circle').length;
    const mapState = resolveMapState(nodes, supportingNodeCount);
    const positionedNodes = positionNodes(nodes, mode);
    const pointByNodeId = new Map(positionedNodes.map((item) => [item.node.id, item.point]));
    const visibleEdges = map.topology.edges.filter((edge) => (
        pointByNodeId.has(edge.fromNodeId) && pointByNodeId.has(edge.toNodeId)
    ));

    return (
        <div
            className={styles.aerialMapCanvas}
            data-map-mode={mode}
            data-map-state={mapState}
            data-supporting-node-count={supportingNodeCount}
            data-has-active-step={activeStep ? 'true' : 'false'}
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onFocusNode(null);
                }
            }}
        >
            <div className={styles.aerialMapCompass} aria-hidden="true">
                <img
                    src="/assets/cognitive-map/awareness-meditation-contour-rays.png"
                    alt=""
                    className={styles.aerialMapMeditationIcon}
                    draggable={false}
                />
            </div>
            <div className={styles.aerialMapScale} aria-hidden="true" />
            {mapState !== 'network' ? (
                <div className={styles.aerialMapStatePanel} data-map-state-panel>
                    <span>{t(`emptyStates.${mode}.${mapState}.eyebrow`)}</span>
                    <strong>{t(`emptyStates.${mode}.${mapState}.title`)}</strong>
                    <small>{t(`emptyStates.${mode}.${mapState}.body`)}</small>
                </div>
            ) : null}

            <div className={styles.aerialMapScene} data-aerial-map-scene>
                <svg
                    className={styles.aerialMapEdges}
                    viewBox="0 0 100 100"
                    aria-hidden="true"
                    focusable="false"
                >
                    {visibleEdges.map((edge) => {
                        const from = pointByNodeId.get(edge.fromNodeId);
                        const to = pointByNodeId.get(edge.toNodeId);
                        if (!from || !to) return null;
                        const active = Boolean(activeStep?.highlightEdgeIds.includes(edge.id));
                        return (
                            <path
                                key={edge.id}
                                d={makeEdgePath(from, to)}
                                className={styles.aerialMapEdge}
                                data-edge-kind={edge.kind}
                                data-evidence-state={edge.evidenceState || 'unknown'}
                                data-active={active ? 'true' : 'false'}
                            />
                        );
                    })}
                </svg>

                {positionedNodes.map(({node, point, labelAnchor}) => {
                    const active = focusedNodeId === node.id || Boolean(activeStep?.highlightNodeIds.includes(node.id));
                    return (
                        <button
                            key={node.id}
                            type="button"
                            className={styles.aerialMapNode}
                            data-node-id={node.id}
                            data-node-kind={node.kind}
                            data-relation={node.relationToCurrent}
                            data-label-anchor={labelAnchor}
                            data-map-x={String(point.x)}
                            data-map-y={String(point.y)}
                            data-active={active ? 'true' : 'false'}
                            style={{
                                left: `${point.x}%`,
                                top: `${point.y}%`,
                            }}
                            aria-label={`${t(`nodeKinds.${node.kind}`)}: ${node.title}`}
                            onClick={(event) => {
                                event.stopPropagation();
                                onUserFocusDuringPlayback?.();
                                onFocusNode(node.id);
                            }}
                        >
                            <span>{t(`nodeKinds.${node.kind}`)}</span>
                            <strong>{node.title}</strong>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function selectCanvasNodes(nodes: CognitiveMapNodeView[], mode: CognitiveMapCanvasMode): CognitiveMapNodeView[] {
    if (mode === 'position') {
        return nodes.filter((node) => (
            node.kind === 'current_circle'
            || node.kind === 'parent_circle'
            || node.kind === 'child_circle'
            || node.kind === 'auxiliary_circle'
        ));
    }

    return nodes.filter((node) => (
        node.kind === 'current_circle'
        || node.kind === 'route'
        || node.kind === 'pending_question'
        || node.kind === 'evidence_gap'
    ));
}

function resolveMapState(nodes: CognitiveMapNodeView[], supportingNodeCount: number): CognitiveMapState {
    if (nodes.length === 0) return 'empty';
    if (supportingNodeCount === 0) return 'single';
    return 'network';
}

function positionNodes(nodes: CognitiveMapNodeView[], mode: CognitiveMapCanvasMode): PositionedNode[] {
    const parentNodes = nodes.filter((node) => node.kind === 'parent_circle');
    const currentNodes = nodes.filter((node) => node.kind === 'current_circle');
    const childNodes = nodes.filter((node) => node.kind === 'child_circle');
    const auxiliaryNodes = nodes.filter((node) => node.kind === 'auxiliary_circle');
    const routeNodes = nodes.filter((node) => node.kind === 'route');
    const pendingNodes = nodes.filter((node) => node.kind === 'pending_question');
    const gapNodes = nodes.filter((node) => node.kind === 'evidence_gap');

    if (mode === 'position') {
        return [
            ...parentNodes.map((node) => ({node, point: {x: 50, y: 15}, labelAnchor: 'bottom' as const})),
            ...currentNodes.map((node) => ({node, point: {x: 50, y: 48}, labelAnchor: 'bottom' as const})),
            ...spreadNodes(auxiliaryNodes, 50, 48, 66, 'horizontal', (index, total) => {
                if (total === 1) return 'bottom';
                return index === 0 ? 'right' : 'left';
            }),
            ...spreadNodes(childNodes, 50, 82, 32, 'horizontal', 'top'),
        ];
    }

    if (routeNodes.length + pendingNodes.length + gapNodes.length === 0) {
        return currentNodes.map((node) => ({node, point: {x: 50, y: 48}, labelAnchor: 'bottom' as const}));
    }

    return [
        ...currentNodes.map((node) => ({node, point: {x: 22, y: 58}, labelAnchor: 'right' as const})),
        ...placeRouteNodes(routeNodes),
        ...spreadNodes(pendingNodes, 36, 80, 16, 'horizontal', 'right'),
        ...spreadNodes(gapNodes, 78, 78, 14, 'vertical', 'left'),
    ];
}

const routeLanePoints: Array<Point & { labelAnchor: LabelAnchor }> = [
    {x: 56, y: 30, labelAnchor: 'right'},
    {x: 76, y: 52, labelAnchor: 'left'},
    {x: 58, y: 72, labelAnchor: 'right'},
    {x: 38, y: 40, labelAnchor: 'right'},
];

function placeRouteNodes(nodes: CognitiveMapNodeView[]): PositionedNode[] {
    return nodes.map((node, index) => {
        const point = routeLanePoints[index] ?? {
            x: 42 + ((index % 3) * 18),
            y: 30 + ((index % 4) * 15),
            labelAnchor: index % 2 === 0 ? 'right' as const : 'left' as const,
        };
        return {
            node,
            point: {x: point.x, y: point.y},
            labelAnchor: point.labelAnchor,
        };
    });
}

function spreadNodes(
    nodes: CognitiveMapNodeView[],
    startX: number,
    startY: number,
    spread: number,
    axis: 'horizontal' | 'vertical',
    labelAnchor: LabelAnchor | ((index: number, total: number) => LabelAnchor),
): PositionedNode[] {
    if (nodes.length === 0) return [];
    if (nodes.length === 1) {
        return [{
            node: nodes[0],
            point: {x: startX, y: startY},
            labelAnchor: resolveLabelAnchor(labelAnchor, 0, 1),
        }];
    }

    return nodes.map((node, index) => {
        const offset = (index / (nodes.length - 1) - 0.5) * spread;
        return {
            node,
            point: axis === 'horizontal'
                ? {x: startX + offset, y: startY}
                : {x: startX, y: startY + offset},
            labelAnchor: resolveLabelAnchor(labelAnchor, index, nodes.length),
        };
    });
}

function resolveLabelAnchor(
    labelAnchor: LabelAnchor | ((index: number, total: number) => LabelAnchor),
    index: number,
    total: number,
): LabelAnchor {
    return typeof labelAnchor === 'function'
        ? labelAnchor(index, total)
        : labelAnchor;
}

function makeEdgePath(from: Point, to: Point): string {
    const midY = (from.y + to.y) / 2;
    return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
}
