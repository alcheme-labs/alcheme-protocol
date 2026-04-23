'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Plus } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { SubCircle } from '@/lib/circle/types';
import styles from '@/app/(main)/circles/[id]/page.module.css';

/* ══════════════════════════════════════════
   Tier Pill — Compact inline tier indicator
   Long-press → lift → horizontal drag to switch
   Uses native DOM events to avoid framer-motion
   drag intercepting pointer events.
   ══════════════════════════════════════════ */

export interface TierPillProps {
    subCircles: SubCircle[];
    activeTierId: string;
    onTierChange: (id: string) => void;
    onLockedTier: (sc: SubCircle) => void;
    userCrystals: number;
    isLifted: boolean;
    setIsLifted: (v: boolean) => void;
    onCreateCircle?: () => void;
}

export default function TierPill({
    subCircles,
    activeTierId,
    onTierChange,
    onLockedTier,
    userCrystals,
    isLifted,
    setIsLifted,
    onCreateCircle,
}: TierPillProps) {
    const t = useI18n('TierPill');
    const activeIndex = subCircles.findIndex((s) => s.id === activeTierId);
    const activeCircle = subCircles[activeIndex];

    const [showDropdown, setShowDropdown] = useState(false);
    const pillRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);

    // Refs for gesture tracking
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPressing = useRef(false);
    const startX = useRef(0);
    const hasMoved = useRef(false);

    /* ── Cleanup on unmount ── */
    useEffect(() => {
        return () => {
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
        };
    }, []);

    /* ── Native event listeners for reliable long-press ── */
    useEffect(() => {
        const el = innerRef.current;
        if (!el) return;

        let pressing = false;
        let touchActive = false; // track touch vs mouse

        const handleStart = (clientX: number) => {

            pressing = true;
            isLongPressing.current = false;
            hasMoved.current = false;
            startX.current = clientX;

            longPressTimer.current = setTimeout(() => {
                isLongPressing.current = true;
                setIsLifted(true);
                setShowDropdown(false);
                if (navigator.vibrate) navigator.vibrate(10);
            }, 300);
        };

        const handleMove = (clientX: number) => {
            if (!pressing) return;
            if (!isLongPressing.current) {
                const dx = Math.abs(clientX - startX.current);
                if (dx > 10 && longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                }
                return;
            }
            hasMoved.current = true;
        };

        const handleEnd = (clientX: number) => {
            if (!pressing) return;
            pressing = false;

            if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }

            if (isLongPressing.current) {
                const dx = clientX - startX.current;
                const threshold = 40;

                if (Math.abs(dx) > threshold) {
                    if (dx < -threshold && activeIndex < subCircles.length - 1) {
                        const next = subCircles[activeIndex + 1];
                        const locked = next.accessRequirement.type === 'crystal' && userCrystals < next.accessRequirement.minCrystals;
                        if (locked) onLockedTier(next);
                        else onTierChange(next.id);
                    }
                    if (dx > threshold && activeIndex > 0) {
                        onTierChange(subCircles[activeIndex - 1].id);
                    }
                }

                setIsLifted(false);
                isLongPressing.current = false;
            } else if (!hasMoved.current) {
                // Short tap → toggle dropdown
                setShowDropdown((prev) => !prev);
            }
        };

        const handleCancel = () => {
            pressing = false;
            if (longPressTimer.current) {
                clearTimeout(longPressTimer.current);
                longPressTimer.current = null;
            }
            isLongPressing.current = false;
        };

        /* Mouse events */
        const onMouseDown = (e: MouseEvent) => {
            if (touchActive) return; // ignore mouse events from touch
            if (e.button !== 0) return;
            handleStart(e.clientX);
        };
        const onMouseMove = (e: MouseEvent) => {
            if (touchActive) return;
            handleMove(e.clientX);
        };
        const onMouseUp = (e: MouseEvent) => {
            if (touchActive) return;
            handleEnd(e.clientX);
        };

        /* Touch events — preventDefault on touchstart blocks Chrome's
           native long-press context menu in DevTools mobile emulation */
        const onTouchStart = (_e: TouchEvent) => {
            touchActive = true;
            handleStart(_e.touches[0].clientX);
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!pressing) return; // Only intercept when actively dragging pill
            e.preventDefault();
            handleMove(e.touches[0].clientX);
        };
        const onTouchEnd = (e: TouchEvent) => {
            handleEnd(e.changedTouches[0].clientX);
            // Reset touchActive after a brief delay to avoid ghost mouse events
            setTimeout(() => { touchActive = false; }, 300);
        };
        const onTouchCancel = () => {
            handleCancel();
            setTimeout(() => { touchActive = false; }, 300);
        };

        /* Prevent context menu at capture phase (before Chrome's default) */
        const onCtx = (e: Event) => {
            if (pressing || isLongPressing.current) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        el.addEventListener('mousedown', onMouseDown);
        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchcancel', onTouchCancel);
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        // Capture phase to intercept before Chrome's default
        el.addEventListener('contextmenu', onCtx, { capture: true });
        document.addEventListener('contextmenu', onCtx, { capture: true });

        return () => {
            el.removeEventListener('mousedown', onMouseDown);
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchcancel', onTouchCancel);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            el.removeEventListener('contextmenu', onCtx, { capture: true });
            document.removeEventListener('contextmenu', onCtx, { capture: true });
        };
    }, [activeIndex, subCircles, userCrystals, onTierChange, onLockedTier]);

    /* ── Close dropdown on outside click ── */
    useEffect(() => {
        if (!showDropdown && !isLifted) return;
        const handleClick = (e: MouseEvent) => {
            if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
                setIsLifted(false);
            }
        };
        document.addEventListener('pointerdown', handleClick);
        return () => document.removeEventListener('pointerdown', handleClick);
    }, [showDropdown, isLifted]);

    return (
        <div className={styles.tierPillWrapper} ref={pillRef}>
            {/* Plain div captures ALL touch/mouse events reliably.
                motion.div ref forwarding may not expose raw DOM element. */}
            <div
                ref={innerRef}

                style={{
                    touchAction: 'none',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                }}
            >
                <motion.div
                    className={`${styles.tierPill} ${isLifted ? styles.tierPillLifted : ''}`}
                    animate={{
                        y: isLifted ? -4 : 0,
                        scale: isLifted ? 1.06 : 1,
                        boxShadow: isLifted
                            ? '0 6px 20px rgba(199, 168, 107, 0.35), 0 0 0 1px rgba(199, 168, 107, 0.3)'
                            : '0 1px 3px rgba(0, 0, 0, 0.15)',
                    }}
                    transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <span className={styles.tierPillName}>{activeCircle?.name}</span>
                    <span className={styles.tierPillDots}>
                        {subCircles.filter(sc => sc.kind === 'main').map((sc) => {
                            const isCurrent = sc.id === activeTierId;
                            const locked = sc.accessRequirement.type === 'crystal' && userCrystals < sc.accessRequirement.minCrystals;
                            return (
                                <span
                                    key={sc.id}
                                    className={`${styles.tierPillDot} ${isCurrent ? styles.tierPillDotActive : ''} ${locked ? styles.tierPillDotLocked : ''}`}
                                >
                                    {locked && <Lock size={6} />}
                                </span>
                            );
                        })}
                    </span>
                    {isLifted && <span className={styles.tierPillHint}>{t('hint')}</span>}
                </motion.div>
            </div>

            {/* Dropdown */}
            <AnimatePresence>
                {showDropdown && (
                    <motion.div
                        className={styles.tierDropdown}
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        {(() => {
                            const mainCircles = subCircles.filter(sc => sc.kind === 'main');
                            const auxByParent = new Map<string, SubCircle[]>();
                            subCircles.filter(sc => sc.kind === 'auxiliary').forEach(sc => {
                                if (!sc.parentId) return;
                                if (!auxByParent.has(sc.parentId)) auxByParent.set(sc.parentId, []);
                                auxByParent.get(sc.parentId)!.push(sc);
                            });

                            return mainCircles.map((sc) => {
                                const isCurrent = sc.id === activeTierId;
                                const locked = sc.accessRequirement.type === 'crystal' && userCrystals < sc.accessRequirement.minCrystals;
                                const children = auxByParent.get(sc.id) || [];
                                const hasChildren = children.length > 0;
                                // Auto-expand if active circle is this parent or one of its children
                                const isChildActive = children.some(c => c.id === activeTierId);
                                const expanded = isCurrent || isChildActive;

                                return (
                                    <div key={sc.id}>
                                        <button
                                            className={`${styles.tierDropdownItem} ${isCurrent ? styles.tierDropdownItemActive : ''} ${locked ? styles.tierDropdownItemLocked : ''}`}
                                            onClick={() => {
                                                if (locked) {
                                                    onLockedTier(sc);
                                                } else {
                                                    onTierChange(sc.id);
                                                }
                                                setShowDropdown(false);
                                            }}
                                        >
                                            <span className={styles.tierDropdownName}>
                                                {locked && <Lock size={10} />}
                                                {sc.name}
                                            </span>
                                            <span className={styles.tierDropdownMeta}>
                                                {t('meta.level', { level: sc.level })}
                                                {sc.accessRequirement.type === 'crystal' && ` · ≥${sc.accessRequirement.minCrystals}💎`}
                                                {hasChildren && ` · ${children.length}`}
                                            </span>
                                        </button>
                                        {/* Auxiliary children — always shown if expanded */}
                                        {hasChildren && expanded && (
                                            <div className={styles.tierDropdownChildren}>
                                                {children.map((child, childIdx) => {
                                                    const childCurrent = child.id === activeTierId;
                                                    const childLocked = child.accessRequirement.type === 'crystal' && userCrystals < child.accessRequirement.minCrystals;
                                                    return (
                                                        <button
                                                            key={child.id}
                                                            className={`${styles.tierDropdownChild} ${childCurrent ? styles.tierDropdownItemActive : ''} ${childLocked ? styles.tierDropdownItemLocked : ''}`}
                                                            onClick={() => {
                                                                if (childLocked) {
                                                                    onLockedTier(child);
                                                                } else {
                                                                    onTierChange(child.id);
                                                                }
                                                                setShowDropdown(false);
                                                            }}
                                                        >
                                                            <span className={styles.tierDropdownName}>
                                                                <span className={styles.tierDropdownIcon}>{child.mode === 'social' ? '💬' : '📚'}</span>
                                                                <span className={styles.tierDropdownNameText}>{child.name}</span>
                                                            </span>
                                                            <span className={styles.tierDropdownMeta}>
                                                                {t('meta.childLevel', {
                                                                    parentLevel: sc.level,
                                                                    childLevel: childIdx + 1,
                                                                })}
                                                                {childLocked && <Lock size={8} />}
                                                                {child.accessRequirement.type === 'crystal' && ` · ≥${child.accessRequirement.minCrystals}💎`}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            });
                        })()}
                        {onCreateCircle && (
                            <button
                                className={styles.tierDropdownCreate}
                                onClick={() => {
                                    onCreateCircle();
                                    setShowDropdown(false);
                                }}
                            >
                                <Plus size={12} />
                                {t('actions.createCircle')}
                            </button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
