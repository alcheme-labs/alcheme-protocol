'use client';

import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@apollo/client/react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Send, ChevronDown, Globe, FileEdit, Layers3, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { BreathingBg } from '@/alchemy';
import { GET_MY_CIRCLES } from '@/lib/apollo/queries';
import type { MyCirclesResponse, GQLCircle } from '@/lib/apollo/types';
import { useCreateContent } from '@/hooks/useCreateContent';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

type PublishIntent = 'feed' | 'draft';

interface CircleTarget {
    id: number;
    name: string;
    level: number;
    kind: 'main' | 'auxiliary';
    mode: 'knowledge' | 'social';
    parentCircleId: number | null;
    rootCircleId: number;
    rootCircleName: string;
    depth: number;
}

interface CircleTargetGroup {
    rootCircleId: number;
    rootCircleName: string;
    items: CircleTarget[];
}

function buildCircleTargets(circles: GQLCircle[]): CircleTarget[] {
    const byId = new Map<number, GQLCircle>();
    circles.forEach((circle) => byId.set(circle.id, circle));

    const resolveRoot = (circle: GQLCircle): { rootId: number; rootName: string; depth: number } => {
        const seen = new Set<number>();
        let current: GQLCircle | undefined = circle;
        let depth = 0;
        while (current?.parentCircleId != null && !seen.has(current.id)) {
            seen.add(current.id);
            const parent = byId.get(current.parentCircleId);
            if (!parent) break;
            current = parent;
            depth += 1;
        }
        return {
            rootId: current?.id || circle.id,
            rootName: current?.name || circle.name,
            depth,
        };
    };

    return circles
        .map((circle) => {
            const resolved = resolveRoot(circle);
            return {
                id: circle.id,
                name: circle.name,
                level: circle.level,
                kind: circle.kind,
                mode: circle.mode,
                parentCircleId: circle.parentCircleId,
                rootCircleId: resolved.rootId,
                rootCircleName: resolved.rootName,
                depth: resolved.depth,
            } satisfies CircleTarget;
        })
        .sort((a, b) => {
            if (a.rootCircleName !== b.rootCircleName) return a.rootCircleName.localeCompare(b.rootCircleName);
            if (a.depth !== b.depth) return a.depth - b.depth;
            if (a.level !== b.level) return a.level - b.level;
            return a.name.localeCompare(b.name);
        });
}

function groupCircleTargets(targets: CircleTarget[]): CircleTargetGroup[] {
    const groups = new Map<number, CircleTargetGroup>();
    targets.forEach((item) => {
        const existing = groups.get(item.rootCircleId);
        if (existing) {
            existing.items.push(item);
            return;
        }
        groups.set(item.rootCircleId, {
            rootCircleId: item.rootCircleId,
            rootCircleName: item.rootCircleName,
            items: [item],
        });
    });

    return Array.from(groups.values()).sort((a, b) => a.rootCircleName.localeCompare(b.rootCircleName));
}

function normalizeRequestedPublishIntent(raw: string | null): PublishIntent | null {
    if (raw === 'feed' || raw === 'draft') {
        return raw;
    }
    return null;
}

function isFeedIntentAllowed(circle: CircleTarget | null | undefined): boolean {
    return circle?.mode === 'social';
}

function isDraftIntentAllowed(circle: CircleTarget | null | undefined): boolean {
    return circle?.mode === 'knowledge';
}

function resolveAllowedPublishIntent(
    circle: CircleTarget | null | undefined,
    requestedIntent: PublishIntent,
): PublishIntent {
    if (!circle) {
        return requestedIntent;
    }
    return circle.mode === 'knowledge' ? 'draft' : 'feed';
}

function resolvePublishIntentValidationError(
    circle: CircleTarget | null | undefined,
    intent: PublishIntent,
    t: (key: 'validation.feedNotAllowed' | 'validation.draftNotAllowed') => string,
): string | null {
    if (!circle) {
        return null;
    }
    if (intent === 'feed' && !isFeedIntentAllowed(circle)) {
        return t('validation.feedNotAllowed');
    }
    if (intent === 'draft' && !isDraftIntentAllowed(circle)) {
        return t('validation.draftNotAllowed');
    }
    return null;
}

function ComposePageInner() {
    const t = useI18n('ComposePage');
    const locale = useCurrentLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const appliedRoutePresetRef = useRef<string | null>(null);
    const submitInFlightRef = useRef(false);
    const [content, setContent] = useState('');
    const [selectedCircle, setSelectedCircle] = useState<number | null>(null);
    const [publishIntent, setPublishIntent] = useState<PublishIntent>('feed');
    const [showCircleSelect, setShowCircleSelect] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    const { data: circlesData } = useQuery<MyCirclesResponse>(GET_MY_CIRCLES);
    const circles = circlesData?.myCircles ?? [];
    const hasCircleChoices = circles.length > 0;
    const circleTargets = useMemo(() => buildCircleTargets(circles), [circles]);
    const circleTargetGroups = useMemo(() => groupCircleTargets(circleTargets), [circleTargets]);
    const circleLevelFormatter = useMemo(
        () => new Intl.NumberFormat(locale),
        [locale],
    );
    const circleTargetById = useMemo(
        () => new Map<number, CircleTarget>(circleTargets.map((item) => [item.id, item])),
        [circleTargets],
    );
    const requestedCircleId = useMemo(() => {
        const raw = searchParams.get('circleId');
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }, [searchParams]);
    const requestedIntent = useMemo(
        () => normalizeRequestedPublishIntent(searchParams.get('intent')),
        [searchParams],
    );

    useEffect(() => {
        if (!hasCircleChoices) {
            setSelectedCircle(null);
            setShowCircleSelect(false);
            return;
        }
        if (selectedCircle !== null && !circleTargetById.has(selectedCircle)) {
            setSelectedCircle(null);
        }
    }, [circleTargetById, hasCircleChoices, selectedCircle]);

    const { createContent, loading: isSubmitting, error: submitError } = useCreateContent();

    const selectedCircleInfo = selectedCircle !== null ? circleTargetById.get(selectedCircle) || null : null;
    const canPublishFeed = isFeedIntentAllowed(selectedCircleInfo);
    const canPublishDraft = isDraftIntentAllowed(selectedCircleInfo);
    const effectiveIntent: PublishIntent = resolveAllowedPublishIntent(selectedCircleInfo, publishIntent);
    const identityStateLabel = hasCircleChoices
        ? t('status.joinedCircles', {count: circleTargets.length})
        : t('status.guest');
    const selectedCircleLabel = selectedCircleInfo
        ? selectedCircleInfo.depth > 0
            ? `${selectedCircleInfo.rootCircleName} / ${selectedCircleInfo.name}`
            : selectedCircleInfo.name
        : null;

    const canSubmit = content.trim().length >= 2 && selectedCircle !== null && hasCircleChoices;

    useEffect(() => {
        if (!selectedCircleInfo) return;
        const nextIntent = resolveAllowedPublishIntent(selectedCircleInfo, publishIntent);
        if (nextIntent !== publishIntent) {
            setPublishIntent(nextIntent);
        }
    }, [publishIntent, selectedCircleInfo]);

    useEffect(() => {
        setValidationError(null);
    }, [content, publishIntent, selectedCircle]);

    useEffect(() => {
        if (!hasCircleChoices) return;
        const routePresetKey = `${requestedCircleId ?? 'none'}:${requestedIntent ?? 'none'}`;
        if (appliedRoutePresetRef.current === routePresetKey) return;

        if (requestedCircleId !== null && circleTargetById.has(requestedCircleId)) {
            setSelectedCircle((prev) => (prev === requestedCircleId ? prev : requestedCircleId));
        }

        if (requestedIntent) {
            const targetCircleId = requestedCircleId !== null && circleTargetById.has(requestedCircleId)
                ? requestedCircleId
                : selectedCircle;
            const targetCircle = targetCircleId !== null ? circleTargetById.get(targetCircleId) : null;
            setPublishIntent(resolveAllowedPublishIntent(targetCircle, requestedIntent));
        }
        appliedRoutePresetRef.current = routePresetKey;
    }, [circleTargetById, hasCircleChoices, requestedCircleId, requestedIntent, selectedCircle]);

    const handleSubmit = useCallback(async () => {
        if (!canSubmit || isSubmitting || submitInFlightRef.current || selectedCircle === null || !selectedCircleInfo) return;

        const intentValidationError = resolvePublishIntentValidationError(selectedCircleInfo, effectiveIntent, t);
        if (intentValidationError) {
            setValidationError(intentValidationError);
            return;
        }

        submitInFlightRef.current = true;
        let releaseSubmitLock = true;
        try {
            const tx = await createContent({
                text: content.trim(),
                tags: [],
                circleId: selectedCircle,
                visibility: effectiveIntent === 'draft' ? 'CircleOnly' : 'Public',
                postStatus: effectiveIntent === 'draft' ? 'Draft' : undefined,
            });

            if (tx) {
                releaseSubmitLock = false;
                setSubmitted(true);
                setTimeout(() => {
                    router.push(
                        effectiveIntent === 'draft'
                            ? `/circles/${selectedCircle}?tab=crucible`
                            : `/circles/${selectedCircle}`,
                    );
                }, 1200);
            }
        } catch (err) {
            console.error('Failed to create content:', err);
        } finally {
            if (releaseSubmitLock) {
                submitInFlightRef.current = false;
            }
        }
    }, [canSubmit, isSubmitting, selectedCircle, selectedCircleInfo, content, createContent, effectiveIntent, router, t]);

    if (submitted) {
        return (
            <div className={styles.page}>
                <BreathingBg temperature="warm" />
                <motion.div
                    className={styles.successScreen}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <span className={styles.successIcon}>✨</span>
                    <h2 className={styles.successTitle}>{t('success.title')}</h2>
                    <p className={styles.successText}>
                        {t('success.text', {
                            circleName: selectedCircleLabel || t('common.circleFallback'),
                            target: effectiveIntent === 'draft' ? t('intent.draftArea') : t('intent.feedArea')
                        })}
                    </p>
                </motion.div>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <div className="content-container">
                <motion.header
                    className={styles.header}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <Link href="/home" className={styles.backBtn} aria-label={t('actions.backHomeAria')}>
                        <ArrowLeft size={20} strokeWidth={1.5} />
                    </Link>
                    <h1 className={styles.title}>{t('title')}</h1>
                    <motion.button
                        className={`${styles.submitBtn} ${canSubmit ? styles.submitActive : ''}`}
                        onClick={handleSubmit}
                        disabled={!canSubmit || isSubmitting}
                        whileTap={canSubmit ? { y: 1 } : {}}
                    >
                        {isSubmitting ? (
                            <motion.span
                                animate={{ rotate: 360 }}
                                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                                style={{ display: 'inline-block' }}
                            >
                                ◌
                            </motion.span>
                        ) : (
                            <>
                                <Send size={14} />
                                {t('actions.publish')}
                            </>
                        )}
                    </motion.button>
                </motion.header>

                <motion.div
                    className={styles.composeArea}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <textarea
                        className={styles.textarea}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={t('composer.placeholder')}
                        autoFocus
                        rows={8}
                    />
                    <div className={styles.charCount}>
                        {t('composer.charCount', {count: content.length})}
                    </div>
                </motion.div>

                {!hasCircleChoices && (
                    <motion.div
                        className={styles.noCircleCard}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <div className={styles.noCircleTitle}>
                            <Sparkles size={16} />
                            {t('empty.title')}
                        </div>
                        <p className={styles.noCircleDesc}>
                            {t('empty.description')}
                        </p>
                        <div className={styles.noCircleActions}>
                            <Link href="/circles" className={styles.noCircleBtnPrimary}>
                                {t('empty.createCircle')}
                            </Link>
                            <Link href="/circles" className={styles.noCircleBtnSecondary}>
                                {t('empty.joinCircle')}
                            </Link>
                        </div>
                    </motion.div>
                )}

                <motion.div
                    className={styles.identityHint}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.08 }}
                >
                    <span className={styles.identityHintLabel}>{t('status.label')}</span>
                    <span className={styles.identityHintValue}>{identityStateLabel}</span>
                </motion.div>

                <motion.div
                    className={styles.optionsBar}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.15, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div className={styles.optionGroup}>
                        <button
                            className={styles.optionBtn}
                            onClick={() => hasCircleChoices && setShowCircleSelect((v) => !v)}
                            disabled={!hasCircleChoices}
                        >
                            <ChevronDown size={14} />
                            {selectedCircleLabel || (hasCircleChoices ? t('selectors.chooseRequired') : t('selectors.createOrJoinFirst'))}
                        </button>

                        <AnimatePresence>
                            {showCircleSelect && hasCircleChoices && (
                                <motion.div
                                    className={styles.circleDropdown}
                                    initial={{ opacity: 0, y: -8, height: 0 }}
                                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                                    exit={{ opacity: 0, y: -8, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    {circleTargetGroups.map((group) => (
                                        <div key={group.rootCircleId} className={styles.circleGroup}>
                                            <div className={styles.circleGroupHeader}>
                                                <Layers3 size={12} />
                                                {group.rootCircleName}
                                            </div>
                                            {group.items.map((item) => (
                                                <button
                                                    key={item.id}
                                                    className={`${styles.circleOption} ${selectedCircle === item.id ? styles.circleSelected : ''}`}
                                                    onClick={() => {
                                                        setSelectedCircle(item.id);
                                                        setShowCircleSelect(false);
                                                    }}
                                                    style={{
                                                        paddingLeft: `calc(var(--space-4) + ${Math.min(item.depth, 4) * 14}px)`,
                                                    }}
                                                >
                                                    <span className={styles.circleOptionName}>{item.name}</span>
                                                    <span className={styles.circleOptionMeta}>
                                                        {item.kind === 'auxiliary' ? `${t('selectors.auxiliaryPrefix')} · ` : ''}
                                                        {t('selectors.levelLabel', {
                                                            level: circleLevelFormatter.format(item.level),
                                                        })}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ))}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className={styles.visibilityToggle}>
                        <button
                            className={`${styles.visBtn} ${effectiveIntent === 'feed' ? styles.visBtnActive : ''}`}
                            onClick={() => setPublishIntent('feed')}
                            disabled={!canPublishFeed}
                            title={canPublishFeed ? t('intent.feedTitleEnabled') : t('intent.feedTitleDisabled')}
                        >
                            <Globe size={12} /> {t('intent.feed')}
                        </button>
                        <button
                            className={`${styles.visBtn} ${effectiveIntent === 'draft' ? styles.visBtnActive : ''}`}
                            onClick={() => setPublishIntent('draft')}
                            disabled={!canPublishDraft}
                            title={canPublishDraft ? t('intent.draftTitleEnabled') : t('intent.draftTitleDisabled')}
                        >
                            <FileEdit size={12} /> {t('intent.draft')}
                        </button>
                    </div>
                </motion.div>

                {(validationError || submitError) && (
                    <p className={styles.errorHint}>{validationError || submitError}</p>
                )}

                <motion.p
                    className={styles.hint}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                >
                    {t('hint')}
                </motion.p>
            </div>
        </div>
    );
}

export default function ComposePage() {
    return (
        <Suspense fallback={null}>
            <ComposePageInner />
        </Suspense>
    );
}
