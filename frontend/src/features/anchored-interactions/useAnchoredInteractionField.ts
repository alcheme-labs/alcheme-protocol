import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DiscussionAnchoredInteractionDto, PlazaAnchoredInteractionType } from './types.ts';

export interface AnchoredInteractionFieldItem {
    interaction: DiscussionAnchoredInteractionDto;
    anchorKey: string;
    anchorType: 'discussion_message' | 'freeform';
    rank: number;
}

export interface AnchoredInteractionFieldGroup {
    anchorKey: string;
    anchorType: 'discussion_message' | 'freeform';
    items: AnchoredInteractionFieldItem[];
}

export interface AnchoredInteractionFieldMotionPulse {
    interactionId: string;
    anchorType: 'discussion_message' | 'freeform';
    anchorRef: string;
    interactionType: PlazaAnchoredInteractionType;
    projectionCursor: number;
    motionKey: number;
}

interface InteractionProjectionMarker {
    projectionCursor: number;
    projectionVersion: number;
}

type InteractionFieldDebugPayload = Record<string, unknown>;

declare global {
    interface Window {
        __alchemeInteractionFieldProjectionLast?: InteractionFieldDebugPayload;
    }
}

export function useAnchoredInteractionField(input: {
    interactions: DiscussionAnchoredInteractionDto[];
    baselineReady?: boolean;
}) {
    const [hasNewChanges, setHasNewChanges] = useState(false);
    const [unreadChangeCount, setUnreadChangeCount] = useState(0);
    const [motionPulse, setMotionPulse] = useState<AnchoredInteractionFieldMotionPulse | null>(null);
    const motionEpochRef = useRef(0);
    const projectionMarkersRef = useRef<Record<string, InteractionProjectionMarker>>({});
    const hasSeenProjectionBaselineRef = useRef(false);
    const fieldVisibleInteractions = useMemo(
        () => input.interactions.filter(isAnchoredInteractionFieldVisible),
        [input.interactions],
    );
    const projectionSignature = useMemo(() => fieldVisibleInteractions
        .map((interaction) => `${interaction.interactionId}:${interaction.projectionCursor}:${interaction.projectionVersion}`)
        .sort()
        .join('|'), [fieldVisibleInteractions]);
    const baselineReady = input.baselineReady ?? true;

    useEffect(() => {
        if (!baselineReady) {
            projectionMarkersRef.current = {};
            hasSeenProjectionBaselineRef.current = false;
            motionEpochRef.current = 0;
            setMotionPulse(null);
            setUnreadChangeCount(0);
            setHasNewChanges(false);
            debugInteractionProjection('skip:baseline-not-ready', {
                interactionCount: fieldVisibleInteractions.length,
            });
            return undefined;
        }
        const previousMarkers = projectionMarkersRef.current;
        const change = resolveAnchoredInteractionProjectionChange(
            previousMarkers,
            fieldVisibleInteractions,
        );
        debugInteractionProjection('resolved', {
            changedInteractionId: change.changedInteractionId,
            changedInteractionCount: change.changedInteractionCount,
            hasSeenBaseline: hasSeenProjectionBaselineRef.current,
            interactionCount: fieldVisibleInteractions.length,
            previousMarkers,
            nextMarkers: change.nextMarkers,
            interactions: fieldVisibleInteractions.map((interaction) => ({
                interactionId: interaction.interactionId,
                status: interaction.status,
                projectionCursor: interaction.projectionCursor,
                projectionVersion: interaction.projectionVersion,
            })),
        });
        projectionMarkersRef.current = change.nextMarkers;
        if (!hasSeenProjectionBaselineRef.current) {
            hasSeenProjectionBaselineRef.current = true;
            debugInteractionProjection('baseline', {
                changedInteractionId: change.changedInteractionId,
                interactionCount: fieldVisibleInteractions.length,
            });
            return undefined;
        }
        if (!change.changedInteractionId) {
            debugInteractionProjection('skip:no-change', {
                interactionCount: fieldVisibleInteractions.length,
            });
            return undefined;
        }
        const changedInteraction = fieldVisibleInteractions.find((interaction) => (
            interaction.interactionId === change.changedInteractionId
        ));
        if (!changedInteraction) {
            debugInteractionProjection('skip:missing-changed-interaction', {
                changedInteractionId: change.changedInteractionId,
            });
            return undefined;
        }
        motionEpochRef.current += 1;
        const nextEpoch = motionEpochRef.current;
        setMotionPulse({
            interactionId: changedInteraction.interactionId,
            anchorType: changedInteraction.anchor.type,
            anchorRef: changedInteraction.anchor.ref,
            interactionType: changedInteraction.interactionType,
            projectionCursor: changedInteraction.projectionCursor,
            motionKey: nextEpoch,
        });
        debugInteractionProjection('pulse', {
            changedInteractionId: change.changedInteractionId,
            changedInteractionCount: change.changedInteractionCount,
            motionEpoch: nextEpoch,
            projectionCursor: changedInteraction.projectionCursor,
        });
        setUnreadChangeCount((count) => Math.min(99, count + Math.max(1, change.changedInteractionCount)));
        setHasNewChanges(true);
        const timer = window.setTimeout(() => setHasNewChanges(false), 3_800);
        return () => window.clearTimeout(timer);
    }, [baselineReady, fieldVisibleInteractions, projectionSignature]);

    const acknowledgeChanges = useCallback(() => {
        setUnreadChangeCount(0);
        setHasNewChanges(false);
    }, []);

    return useMemo(() => {
        const items = fieldVisibleInteractions
            .map((interaction): AnchoredInteractionFieldItem => ({
                interaction,
                anchorKey: `${interaction.anchor.type}:${interaction.anchor.ref}`,
                anchorType: interaction.anchor.type,
                rank: rankInteraction(interaction),
            }))
            .sort((left, right) => right.rank - left.rank || right.interaction.projectionCursor - left.interaction.projectionCursor);
        const grouped = new Map<string, AnchoredInteractionFieldItem[]>();
        for (const item of items) {
            grouped.set(item.anchorKey, [...(grouped.get(item.anchorKey) || []), item]);
        }
        const groups: AnchoredInteractionFieldGroup[] = [...grouped.entries()].map(([anchorKey, groupItems]) => ({
            anchorKey,
            anchorType: groupItems[0]?.anchorType || 'discussion_message',
            items: groupItems,
        }));
        const activeItems = items.filter((item) => item.interaction.status === 'open');
        return {
            groups,
            activeItems,
            activeCount: activeItems.length,
            hasNewChanges,
            unreadChangeCount,
            acknowledgeChanges,
            motionPulse,
        };
    }, [acknowledgeChanges, fieldVisibleInteractions, hasNewChanges, motionPulse, unreadChangeCount]);
}

function isAnchoredInteractionFieldVisible(interaction: DiscussionAnchoredInteractionDto): boolean {
    return interaction.interactionType !== 'announcement';
}

function rankInteraction(interaction: DiscussionAnchoredInteractionDto): number {
    if (interaction.status === 'open') return 100 + interaction.projectionVersion;
    if (interaction.status === 'closed') return 40;
    if (interaction.status === 'resolved') return 20;
    return 0;
}

export function resolveAnchoredInteractionProjectionChange(
    previousMarkers: Record<string, InteractionProjectionMarker>,
    interactions: DiscussionAnchoredInteractionDto[],
): {
    changedInteractionId: string | null;
    changedInteractionCount: number;
    nextMarkers: Record<string, InteractionProjectionMarker>;
} {
    const nextMarkers: Record<string, InteractionProjectionMarker> = {};
    let changedInteraction: DiscussionAnchoredInteractionDto | null = null;
    let changedInteractionCount = 0;
    for (const interaction of interactions) {
        const marker = {
            projectionCursor: interaction.projectionCursor,
            projectionVersion: interaction.projectionVersion,
        };
        nextMarkers[interaction.interactionId] = marker;
        const previous = previousMarkers[interaction.interactionId];
        if (previous
            && interaction.projectionCursor <= previous.projectionCursor
            && interaction.projectionVersion <= previous.projectionVersion) {
            continue;
        }
        changedInteractionCount += previous
            ? Math.max(1, interaction.projectionVersion - previous.projectionVersion)
            : 1;
        if (!changedInteraction || compareInteractionMotionRecency(interaction, changedInteraction) < 0) {
            changedInteraction = interaction;
        }
    }
    return {
        changedInteractionId: changedInteraction?.interactionId || null,
        changedInteractionCount,
        nextMarkers,
    };
}

function compareInteractionMotionRecency(
    left: DiscussionAnchoredInteractionDto,
    right: DiscussionAnchoredInteractionDto,
): number {
    return right.projectionCursor - left.projectionCursor
        || right.projectionVersion - left.projectionVersion;
}

function debugInteractionProjection(event: string, payload: InteractionFieldDebugPayload): void {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return;
    const snapshot = {
        event,
        at: new Date().toISOString(),
        ...payload,
    };
    window.__alchemeInteractionFieldProjectionLast = snapshot;
    console.info('[interaction-field:projection]', snapshot);
}
