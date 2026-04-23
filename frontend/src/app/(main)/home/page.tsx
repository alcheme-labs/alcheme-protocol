'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { motion } from 'framer-motion';
import { Compass, Flame, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';

import IdentityRegistrationEntry from '@/components/auth/IdentityRegistrationEntry';
import RegisterIdentitySheet from '@/components/auth/RegisterIdentitySheet/RegisterIdentitySheet';
import { Card } from '@/components/ui/Card';
import { HeatGauge } from '@/components/alchemy/HeatGauge';
import { Skeleton } from '@/components/ui/Skeleton';
import ExtensionCapabilitySection from '@/components/extensions/ExtensionCapabilitySection';
import { useRegisterIdentity } from '@/hooks/useRegisterIdentity';
import { GET_PUBLIC_FLOW, GET_FOLLOWING_FLOW, GET_ALL_CIRCLES, GET_ME } from '@/lib/apollo/queries';
import type {
    PublicFlowResponse,
    FollowingFlowResponse,
    AllCirclesResponse,
    GQLCircle,
    GQLPublicFlowItem,
    MeResponse,
} from '@/lib/apollo/types';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import { shouldLoadRegisteredProfile, shouldShowHomeWalletBadge } from '@/lib/auth/walletSurfaceState';
import { clampHeatScore, resolveHeatState } from '@/lib/heat/semantics';
import { useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

type FlowMode = 'public' | 'following';

function isRootMainCircle(circle: GQLCircle): boolean {
    const kind = typeof circle.kind === 'string' ? circle.kind.toLowerCase() : '';
    return kind === 'main' && circle.parentCircleId == null;
}

function itemHeat(item: GQLPublicFlowItem): number {
    return clampHeatScore(Math.round(item.score * 100));
}

export default function HomePage() {
    const t = useI18n('HomePage');
    const [flowMode, setFlowMode] = useState<FlowMode>('public');
    const [showRegisterSheet, setShowRegisterSheet] = useState(false);
    const [homeReminderDismissed, setHomeReminderDismissed] = useState(false);
    const {
        identityState,
        lastErrorMessage,
        refreshIdentityState,
        walletConnected,
        walletPublicKey,
    } = useIdentityOnboarding();
    const {
        registerIdentity,
        loading: identityRegistrationLoading,
        syncing: identityRegistrationSyncing,
        error: identityRegistrationError,
    } = useRegisterIdentity();

    const { data: publicFlowData, loading: publicFlowLoading } = useQuery<PublicFlowResponse>(GET_PUBLIC_FLOW, {
        variables: { limit: 20, offset: 0 },
        errorPolicy: 'all',
    });

    const { data: followingFlowData, loading: followingFlowLoading } = useQuery<FollowingFlowResponse>(GET_FOLLOWING_FLOW, {
        variables: { limit: 20, offset: 0 },
        errorPolicy: 'all',
    });

    const { data: circlesData, loading: circlesLoading } = useQuery<AllCirclesResponse>(GET_ALL_CIRCLES, {
        variables: { limit: 8 },
        errorPolicy: 'all',
    });

    const publicItems = publicFlowData?.publicFlow || [];
    const followingPosts = followingFlowData?.followingFlow || [];
    const circles = (circlesData?.allCircles || []).filter(isRootMainCircle);

    const publicDiscussions = useMemo(
        () => publicItems.filter((item) => item.kind === 'Discussion').slice(0, 5),
        [publicItems],
    );
    const publicCrystals = useMemo(
        () => publicItems.filter((item) => item.kind === 'Crystal').slice(0, 5),
        [publicItems],
    );

    const shouldLoadHomeProfile = shouldLoadRegisteredProfile({
        walletConnected,
        identityState,
    });
    const { data: meData } = useQuery<MeResponse>(GET_ME, {
        skip: !shouldLoadHomeProfile,
    });
    const me = shouldLoadHomeProfile ? (meData?.me ?? null) : null;
    const followingCount = me?.stats.following ?? 0;
    const hasFlowData = flowMode === 'public'
        ? publicItems.length > 0
        : followingPosts.length > 0;
    const isUnregisteredIdentity = walletConnected && identityState === 'unregistered';
    const isSessionErrorIdentity = walletConnected && identityState === 'session_error';
    const showIdentityReminder = isSessionErrorIdentity
        || (isUnregisteredIdentity && !homeReminderDismissed);

    useEffect(() => {
        if (!walletPublicKey || !isUnregisteredIdentity) {
            setHomeReminderDismissed(false);
            return;
        }

        const storageKey = `alcheme_identity_home_reminder_dismissed:${walletPublicKey}`;
        setHomeReminderDismissed(window.sessionStorage.getItem(storageKey) === '1');
    }, [isUnregisteredIdentity, walletPublicKey]);

    const dismissHomeReminder = () => {
        if (walletPublicKey) {
            window.sessionStorage.setItem(`alcheme_identity_home_reminder_dismissed:${walletPublicKey}`, '1');
        }
        setHomeReminderDismissed(true);
    };

    const handleRegisterIdentity = async (handle: string) => {
        const created = await registerIdentity({ handle });
        if (!created) return;
        await refreshIdentityState();
        setShowRegisterSheet(false);
    };

    const reminderTitle = isSessionErrorIdentity
        ? t('reminder.sessionError.title')
        : t('reminder.unregistered.title');
    const reminderDescription = isSessionErrorIdentity
        ? (lastErrorMessage || t('reminder.sessionError.description'))
        : t('reminder.unregistered.description');
    const reminderPrimaryLabel = isSessionErrorIdentity ? t('reminder.sessionError.primaryLabel') : t('reminder.unregistered.primaryLabel');
    const reminderSecondaryLabel = isSessionErrorIdentity ? undefined : t('reminder.unregistered.secondaryLabel');
    const handleReminderPrimary = () => {
        if (isSessionErrorIdentity) {
            void refreshIdentityState();
            return;
        }
        setShowRegisterSheet(true);
    };

    const followingEmptyStateMessage = followingCount > 0
        ? t('following.empty.following')
        : t('following.empty.none');

    const heatStateLabel = (state: ReturnType<typeof resolveHeatState>) => t(`heat.states.${state}`);

    return (
        <div className={styles.page}>
            <div className="content-container">
                <motion.header
                    className={styles.header}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <h1 className={styles.greeting}>{t('header.title')}</h1>
                    <p className={styles.subtitle}>{t('header.subtitle')}</p>
                    <div className={styles.headerMetaRow}>
                        <div className={styles.flowToggle}>
                            <button
                                className={`${styles.flowBtn} ${flowMode === 'public' ? styles.flowBtnActive : ''}`}
                                onClick={() => setFlowMode('public')}
                            >
                                {t('header.flow.public')}
                            </button>
                            <button
                                className={`${styles.flowBtn} ${flowMode === 'following' ? styles.flowBtnActive : ''}`}
                                onClick={() => setFlowMode('following')}
                            >
                                {t('header.flow.following')}
                            </button>
                        </div>
                        {shouldShowHomeWalletBadge(walletConnected) && (
                            <span className={styles.liveIndicator}>{t('header.walletConnected')}</span>
                        )}
                    </div>
                </motion.header>

                {showIdentityReminder && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <IdentityRegistrationEntry
                            variant="banner"
                            title={reminderTitle}
                            description={reminderDescription}
                            primaryLabel={reminderPrimaryLabel}
                            secondaryLabel={reminderSecondaryLabel}
                            onPrimary={handleReminderPrimary}
                            onSecondary={isSessionErrorIdentity ? undefined : dismissHomeReminder}
                        />
                    </motion.div>
                )}

                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <ExtensionCapabilitySection />
                </motion.div>

                {flowMode === 'public' ? (
                    <>
                        <motion.section
                            className={styles.section}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
                        >
                            <div className={styles.sectionHeader}>
                                <Flame size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                                <h2 className={styles.sectionTitle}>{t('public.discussions.title')}</h2>
                            </div>
                            <div className={styles.cardList}>
                                {publicFlowLoading ? (
                                    <>
                                        <Skeleton height={110} />
                                        <Skeleton height={110} />
                                    </>
                                ) : publicDiscussions.length === 0 ? (
                                    <p className={styles.cardMeta}>{t('public.discussions.empty')}</p>
                                ) : (
                                    publicDiscussions.map((item) => (
                                        <Card
                                            key={item.id}
                                            state="alloy"
                                            heatState={resolveHeatState(itemHeat(item))}
                                            footer={<HeatGauge score={itemHeat(item)} />}
                                        >
                                            <h3 className={styles.cardTitle}>{item.title}</h3>
                                            <p className={styles.cardDesc}>{item.excerpt}</p>
                                            <p className={styles.cardMeta}>
                                                {t('public.meta', {circleName: item.circleName, authorHandle: item.authorHandle})}
                                            </p>
                                        </Card>
                                    ))
                                )}
                            </div>
                        </motion.section>

                        <motion.section
                            className={styles.section}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        >
                            <div className={styles.sectionHeader}>
                                <Sparkles size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                                <h2 className={styles.sectionTitle}>{t('public.crystals.title')}</h2>
                            </div>
                            <div className={styles.cardList}>
                                {publicFlowLoading ? (
                                    <>
                                        <Skeleton height={100} />
                                        <Skeleton height={100} />
                                    </>
                                ) : publicCrystals.length === 0 ? (
                                    <p className={styles.cardMeta}>{t('public.crystals.empty')}</p>
                                ) : (
                                    publicCrystals.map((item) => (
                                        <Link
                                            key={item.id}
                                            href={`/knowledge/${item.sourceId}`}
                                            className={styles.cardLink}
                                            aria-label={t('public.crystals.openAria', {title: item.title})}
                                        >
                                            <Card state="crystal">
                                                <h3 className={styles.cardTitle}>{item.title}</h3>
                                                <p className={styles.cardDesc}>{item.excerpt}</p>
                                                <p className={styles.cardMeta}>
                                                    {t('public.meta', {circleName: item.circleName, authorHandle: item.authorHandle})}
                                                </p>
                                            </Card>
                                        </Link>
                                    ))
                                )}
                            </div>
                        </motion.section>
                    </>
                ) : (
                    <motion.section
                        className={styles.section}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <div className={styles.sectionHeader}>
                            <Users size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                            <h2 className={styles.sectionTitle}>{t('following.title')}</h2>
                        </div>
                        <div className={styles.cardList}>
                            {followingFlowLoading ? (
                                <>
                                    <Skeleton height={120} />
                                    <Skeleton height={120} />
                                </>
                            ) : followingPosts.length === 0 ? (
                                <p className={styles.cardMeta}>{followingEmptyStateMessage}</p>
                            ) : (
                                followingPosts.map((post) => {
                                    const postHeat = clampHeatScore(Number(post.stats.heatScore ?? 0));
                                    const postHeatState = resolveHeatState(postHeat);
                                    const postHeatLabel = heatStateLabel(postHeatState);
                                    return (
                                    <Card
                                        key={post.id}
                                        state="alloy"
                                        heatState={postHeatState}
                                        footer={<HeatGauge score={postHeat} />}
                                    >
                                        <h3 className={styles.cardTitle}>{post.text?.slice(0, 70) || t('following.untitled')}</h3>
                                        <p className={styles.cardMeta}>
                                            {t('following.postMeta', {
                                                authorHandle: post.author.handle,
                                                circleName: post.circle?.name || t('common.circleFallback'),
                                                heatLabel: postHeatLabel,
                                                heat: Math.round(postHeat)
                                            })}
                                        </p>
                                    </Card>
                                    );
                                })
                            )}
                        </div>
                    </motion.section>
                )}

                <motion.section
                    className={styles.section}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div className={styles.sectionHeader}>
                        <Compass size={16} strokeWidth={1.5} className={styles.sectionIcon} />
                        <h2 className={styles.sectionTitle}>{t('discover.title')}</h2>
                    </div>
                    <div className={styles.cardList}>
                        {circlesLoading ? (
                            <>
                                <Skeleton height={100} />
                                <Skeleton height={100} />
                            </>
                        ) : circles.length === 0 ? (
                            <p className={styles.cardMeta}>{t('discover.empty')}</p>
                        ) : (
                            circles.map((circle) => (
                                <Link key={circle.id} href={`/circles/${circle.id}`} className={styles.cardLink}>
                                    <Card state="ore">
                                        <h3 className={styles.cardTitle}>{circle.name}</h3>
                                        <p className={styles.cardDesc}>{circle.description || t('discover.noDescription')}</p>
                                        <p className={styles.cardMeta}>
                                            {t('discover.meta', {members: circle.stats.members, posts: circle.stats.posts})}
                                        </p>
                                    </Card>
                                </Link>
                            ))
                        )}
                    </div>
                </motion.section>
            </div>

            <RegisterIdentitySheet
                open={showRegisterSheet}
                context="onboarding"
                loading={identityRegistrationLoading}
                syncing={identityRegistrationSyncing}
                error={identityRegistrationError}
                onClose={() => {
                    if (!identityRegistrationLoading && !identityRegistrationSyncing) {
                        setShowRegisterSheet(false);
                    }
                }}
                onSubmit={handleRegisterIdentity}
            />
        </div>
    );
}
