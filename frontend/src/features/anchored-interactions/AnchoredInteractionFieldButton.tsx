'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';

import styles from '@/app/(main)/circles/[id]/page.module.css';

const LONG_PRESS_MS = 430;

type DockEdge = 'left' | 'right';

function InteractionFieldAnchorCardIcon() {
    return (
        <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
            data-interaction-field-icon="anchor-card"
        >
            <circle cx="3.8" cy="9.2" r="1.7" />
            <path d="M5.7 9.2h2.1" />
            <rect x="10.3" y="5" width="9.8" height="14" rx="2.3" />
            <path d="M12.8 9.2h4.7" />
            <path d="M12.8 13h4" />
            <circle cx="18.2" cy="17.2" r="1.5" fill="currentColor" stroke="none" />
        </svg>
    );
}

function clampDockY(value: number): number {
    if (typeof window === 'undefined') return value;
    const minY = 86;
    const maxY = Math.max(minY, window.innerHeight - 112);
    return Math.min(Math.max(value, minY), maxY);
}

export default function AnchoredInteractionFieldButton({
    count,
    unreadCount,
    label,
    open = false,
    pulse,
    onClick,
}: {
    count: number;
    unreadCount: number;
    label: string;
    open?: boolean;
    pulse: boolean;
    onClick: () => void;
}) {
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pointerIdRef = useRef<number | null>(null);
    const latestPointerRef = useRef<{ x: number; y: number } | null>(null);
    const suppressClickRef = useRef(false);
    const [dockEdge, setDockEdge] = useState<DockEdge>('right');
    const [dockY, setDockY] = useState<number | null>(null);
    const [isTouched, setIsTouched] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const clearLongPressTimer = useCallback(() => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    const updateDockPosition = useCallback((point: { x: number; y: number }) => {
        if (typeof window === 'undefined') return;
        setDockEdge(point.x < window.innerWidth / 2 ? 'left' : 'right');
        setDockY(clampDockY(point.y));
    }, []);

    useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

    if (count <= 0) return null;

    const expanded = open || isTouched || isDragging;
    const clampedUnreadCount = Math.min(99, Math.max(0, unreadCount));
    const showUnreadDot = clampedUnreadCount === 1;
    const showCountBadge = clampedUnreadCount > 1;
    const buttonStyle =
        dockY === null
            ? undefined
            : ({
                  '--interaction-field-top': `${dockY}px`,
              } as CSSProperties);

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        setIsTouched(true);
        pointerIdRef.current = event.pointerId;
        latestPointerRef.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
            const latestPointer = latestPointerRef.current;
            if (!latestPointer) return;
            suppressClickRef.current = true;
            setIsDragging(true);
            updateDockPosition(latestPointer);
        }, LONG_PRESS_MS);
    };

    const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
        latestPointerRef.current = { x: event.clientX, y: event.clientY };
        if (isDragging) {
            event.preventDefault();
            updateDockPosition(latestPointerRef.current);
        }
    };

    const finishPointerInteraction = (event: PointerEvent<HTMLButtonElement>) => {
        clearLongPressTimer();
        if (pointerIdRef.current !== null && event.currentTarget.hasPointerCapture(pointerIdRef.current)) {
            event.currentTarget.releasePointerCapture(pointerIdRef.current);
        }
        pointerIdRef.current = null;
        latestPointerRef.current = null;
        setIsDragging(false);
        if (!open) {
            window.setTimeout(() => setIsTouched(false), 180);
        }
    };

    return (
        <button
            type="button"
            className={`${styles.interactionFieldButton} ${pulse ? styles.interactionFieldButtonPulse : ''}`}
            data-interaction-field-target="1"
            data-interaction-field-expanded={expanded ? 'true' : 'false'}
            data-interaction-field-edge={dockEdge}
            data-interaction-field-dragging={isDragging ? 'true' : 'false'}
            data-interaction-field-unread-count={clampedUnreadCount}
            aria-expanded={open}
            aria-label={label}
            style={buttonStyle}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishPointerInteraction}
            onPointerCancel={finishPointerInteraction}
            onFocus={() => setIsTouched(true)}
            onBlur={() => {
                if (!open) setIsTouched(false);
            }}
            onClick={(event) => {
                if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                setIsTouched(true);
                onClick();
            }}
        >
            {showCountBadge ? (
                <span className={styles.interactionFieldButtonCount}>{clampedUnreadCount}</span>
            ) : (
                <span className={styles.interactionFieldButtonIcon} aria-hidden="true">
                    <InteractionFieldAnchorCardIcon />
                    {showUnreadDot && <i className={styles.interactionFieldButtonDot} aria-hidden="true" />}
                </span>
            )}
            <strong className={styles.interactionFieldButtonLabel}>{label}</strong>
        </button>
    );
}
