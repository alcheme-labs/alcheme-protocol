'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, GitBranch, Pin, Search, Star, Users } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { SubCircle } from '@/lib/circle/types';
import styles from './CircleTreePanel.module.css';

interface CircleTreePanelProps {
    circles: SubCircle[];
    activeCircleId: string;
    rootCircleId: number;
    onSelectCircle: (circleId: string) => void;
    presentation?: 'accordion' | 'content';
}

const STORAGE_KEY_PREFIX = 'alcheme_circle_tree_pins:';

type Translator = (key: string, values?: Record<string, string | number>) => string;

function getKindLabel(circle: SubCircle, t: Translator): string {
    return circle.kind === 'auxiliary' ? t('kinds.side') : t('kinds.main');
}

function getModeLabel(circle: SubCircle, t: Translator): string {
    return circle.mode === 'knowledge' ? t('modes.knowledge') : t('modes.social');
}

function getCircleRelationLabel(circle: SubCircle, t: Translator, auxiliaryIndex?: number): string {
    if (circle.kind === 'auxiliary') {
        return t('meta.auxiliaryRelation', { index: auxiliaryIndex ?? 1 });
    }
    return getKindLabel(circle, t);
}

function formatCircleKind(circle: SubCircle, t: Translator, auxiliaryIndex?: number): string {
    return t('meta.circleDetail', {
        kind: getCircleRelationLabel(circle, t, auxiliaryIndex),
        mode: getModeLabel(circle, t),
    });
}

function compareCircleOrder(left: SubCircle, right: SubCircle): number {
    if (left.level !== right.level) return left.level - right.level;
    const leftId = Number(left.id);
    const rightId = Number(right.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
    }
    return left.name.localeCompare(right.name);
}

function buildDepthById(circles: SubCircle[]): Map<string, number> {
    const byId = new Map(circles.map((circle) => [circle.id, circle]));
    const depthById = new Map<string, number>();
    const resolveDepth = (circle: SubCircle, seen = new Set<string>()): number => {
        if (depthById.has(circle.id)) return depthById.get(circle.id) ?? 0;
        if (!circle.parentId || seen.has(circle.id) || !byId.has(circle.parentId)) {
            depthById.set(circle.id, 0);
            return 0;
        }
        seen.add(circle.id);
        const depth = resolveDepth(byId.get(circle.parentId)!, seen) + 1;
        depthById.set(circle.id, depth);
        return depth;
    };
    circles.forEach((circle) => resolveDepth(circle));
    return depthById;
}

function buildAuxiliaryIndexById(circles: SubCircle[]): Map<string, number> {
    const auxByParent = new Map<string, SubCircle[]>();
    circles.filter((circle) => circle.kind === 'auxiliary').forEach((circle) => {
        const parentKey = circle.parentId || '__root__';
        const group = auxByParent.get(parentKey) || [];
        group.push(circle);
        auxByParent.set(parentKey, group);
    });

    const indexById = new Map<string, number>();
    auxByParent.forEach((group) => {
        [...group].sort(compareCircleOrder).forEach((circle, index) => {
            indexById.set(circle.id, index + 1);
        });
    });
    return indexById;
}

export default function CircleTreePanel({
    circles,
    activeCircleId,
    rootCircleId,
    onSelectCircle,
    presentation = 'accordion',
}: CircleTreePanelProps) {
    const t = useI18n('CircleTreePanel');
    const [open, setOpen] = useState(true);
    const [query, setQuery] = useState('');
    const [pinnedIds, setPinnedIds] = useState<string[]>([]);
    const storageKey = `${STORAGE_KEY_PREFIX}${rootCircleId}`;
    const contentOnly = presentation === 'content';

    useEffect(() => {
        try {
            const raw = window.localStorage.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            setPinnedIds(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []);
        } catch {
            setPinnedIds([]);
        }
    }, [storageKey]);

    const persistPins = (next: string[]) => {
        setPinnedIds(next);
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
            // Local pinning is a browser-only convenience. Failure should not block navigation.
        }
    };

    const depthById = useMemo(() => buildDepthById(circles), [circles]);
    const auxiliaryIndexById = useMemo(() => buildAuxiliaryIndexById(circles), [circles]);
    const visibleCircles = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        const filtered = normalized
            ? circles.filter((circle) => {
                const auxiliaryIndex = auxiliaryIndexById.get(circle.id);
                const haystack = [
                    circle.name,
                    circle.kind,
                    circle.mode,
                    getCircleRelationLabel(circle, t, auxiliaryIndex),
                    getModeLabel(circle, t),
                    `Lv.${circle.level}`,
                ].join(' ').toLowerCase();
                return haystack.includes(normalized);
            })
            : circles;
        return [...filtered].sort((a, b) => {
            const aPinned = pinnedIds.includes(a.id) ? 0 : 1;
            const bPinned = pinnedIds.includes(b.id) ? 0 : 1;
            if (aPinned !== bPinned) return aPinned - bPinned;
            const depthDelta = (depthById.get(a.id) ?? 0) - (depthById.get(b.id) ?? 0);
            if (depthDelta !== 0) return depthDelta;
            return compareCircleOrder(a, b);
        });
    }, [auxiliaryIndexById, circles, depthById, pinnedIds, query, t]);

    const togglePinned = (circleId: string) => {
        if (pinnedIds.includes(circleId)) {
            persistPins(pinnedIds.filter((id) => id !== circleId));
            return;
        }
        persistPins([circleId, ...pinnedIds].slice(0, 12));
    };

    return (
        <section className={`${styles.panel} ${contentOnly ? styles.panelContentOnly : ''}`} aria-label={t('aria.panel')}>
            {!contentOnly && (
                <button
                    type="button"
                    className={styles.header}
                    onClick={() => setOpen((value) => !value)}
                    aria-expanded={open}
                >
                    <span className={styles.titleRow}>
                        <GitBranch size={15} />
                        <span className={styles.title}>{t('title')}</span>
                        <span className={styles.meta}>{t('meta.count', { count: circles.length })}</span>
                    </span>
                    <ChevronDown size={16} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
                </button>
            )}
            {(contentOnly || open) && (
                <div className={styles.body}>
                    <div className={styles.searchRow}>
                        <label className={styles.searchBox}>
                            <Search size={13} />
                            <input
                                className={styles.searchInput}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder={t('search.placeholder')}
                            />
                        </label>
                        <span className={styles.pinSummary}>
                            <Star size={12} />
                            {pinnedIds.length}
                        </span>
                    </div>
                    <div className={styles.list}>
                        {visibleCircles.map((circle) => {
                            const active = circle.id === activeCircleId;
                            const pinned = pinnedIds.includes(circle.id);
                            const depth = depthById.get(circle.id) ?? 0;
                            const auxiliaryIndex = auxiliaryIndexById.get(circle.id);
                            const relationLabel = getCircleRelationLabel(circle, t, auxiliaryIndex);
                            const rowKindClass = circle.kind === 'auxiliary' ? styles.rowAuxiliaryCircle : styles.rowMainCircle;
                            const depthMarkerKindClass = circle.kind === 'auxiliary' ? styles.depthMarkerAuxiliary : styles.depthMarkerMain;
                            const levelBadgeKindClass = circle.kind === 'auxiliary' ? styles.levelBadgeAuxiliary : styles.levelBadgeMain;
                            const markerIcon = circle.kind === 'auxiliary' ? <GitBranch size={13} /> : <Users size={14} />;
                            return (
                                <div
                                    key={circle.id}
                                    className={`${styles.row} ${rowKindClass} ${active ? styles.rowActive : ''}`}
                                >
                                    <span
                                        className={`${styles.depthMarker} ${depthMarkerKindClass} ${depth > 0 ? styles.depthMarkerNested : ''}`}
                                        style={{ marginLeft: Math.min(depth, 4) * 12 }}
                                        aria-hidden="true"
                                    >
                                        {markerIcon}
                                    </span>
                                    <button
                                        type="button"
                                        className={styles.rowButton}
                                        onClick={() => onSelectCircle(circle.id)}
                                    >
                                        <span className={styles.rowMain}>
                                            <span className={styles.rowName}>{circle.name}</span>
                                            <span className={`${styles.levelBadge} ${levelBadgeKindClass}`}>{t('meta.levelBadge', { level: circle.level })}</span>
                                            <span className={styles.kindBadge}>{relationLabel}</span>
                                        </span>
                                        <span className={styles.rowMeta}>
                                            {formatCircleKind(circle, t, auxiliaryIndex)}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.pinButton} ${pinned ? styles.pinButtonActive : ''}`}
                                        onClick={() => togglePinned(circle.id)}
                                        aria-label={pinned ? t('pin.unpin') : t('pin.pin')}
                                        title={pinned ? t('pin.unpin') : t('pin.pin')}
                                    >
                                        <Pin size={13} fill={pinned ? 'currentColor' : 'none'} />
                                    </button>
                                </div>
                            );
                        })}
                        {visibleCircles.length === 0 && (
                            <div className={styles.empty}>{t('empty')}</div>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
