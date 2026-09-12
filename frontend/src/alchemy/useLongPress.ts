'use client';

import { useRef, useCallback } from 'react';

interface UseLongPressOptions {
    /** Threshold in ms before long-press fires (default: 500) */
    threshold?: number;
    /** Callback when long-press is detected */
    onLongPress: () => void;
    /** Callback for a normal tap (short press) */
    onTap?: () => void;
    /** Move distance (px) that cancels the gesture (default: 10) */
    moveThreshold?: number;
}

/**
 * Hook to differentiate between tap and long-press on an element.
 * Returns event handler props to spread onto the target element.
 *
 * - Tap (< threshold): calls onTap
 * - Long-press (>= threshold): calls onLongPress + haptic feedback
 * - Moving more than moveThreshold cancels the gesture
 */
export function useLongPress({
    threshold = 500,
    onLongPress,
    onTap,
    moveThreshold = 10,
}: UseLongPressOptions) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didLongPress = useRef(false);
    const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const moved = useRef(false);
    const isActive = useRef(false);

    const clear = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const handleStart = useCallback(
        (clientX: number, clientY: number) => {
            isActive.current = true;
            didLongPress.current = false;
            moved.current = false;
            startPos.current = { x: clientX, y: clientY };

            timer.current = setTimeout(() => {
                didLongPress.current = true;
                // Haptic feedback if available
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                    navigator.vibrate(30);
                }
                onLongPress();
            }, threshold);
        },
        [threshold, onLongPress]
    );

    const handleMove = useCallback(
        (clientX: number, clientY: number) => {
            if (!isActive.current) return;
            const dx = Math.abs(clientX - startPos.current.x);
            const dy = Math.abs(clientY - startPos.current.y);
            if (dx > moveThreshold || dy > moveThreshold) {
                moved.current = true;
                clear();
            }
        },
        [moveThreshold, clear]
    );

    const handleEnd = useCallback(() => {
        if (!isActive.current) return;
        isActive.current = false;
        clear();

        if (!didLongPress.current && !moved.current) {
            onTap?.();
        }
    }, [clear, onTap]);

    const handleCancel = useCallback(() => {
        isActive.current = false;
        clear();
    }, [clear]);

    const handlers = {
        onMouseDown: (e: React.MouseEvent) => handleStart(e.clientX, e.clientY),
        onMouseMove: (e: React.MouseEvent) => handleMove(e.clientX, e.clientY),
        onMouseUp: handleEnd,
        onMouseLeave: handleCancel,
        onTouchStart: (e: React.TouchEvent) => {
            const t = e.touches[0];
            handleStart(t.clientX, t.clientY);
        },
        onTouchMove: (e: React.TouchEvent) => {
            const t = e.touches[0];
            handleMove(t.clientX, t.clientY);
        },
        onTouchEnd: handleEnd,
        onTouchCancel: handleCancel,
    };

    return handlers;
}
