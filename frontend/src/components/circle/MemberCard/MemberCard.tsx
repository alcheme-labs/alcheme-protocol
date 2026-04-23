'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, UserPlus, Gem, BookOpen, Clock, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import styles from './MemberCard.module.css';

/* ═══ Types ═══ */

export interface MemberProfile {
    userId: number;
    pubkey?: string | null;
    name: string;
    handle: string;
    role: 'owner' | 'curator' | 'member';
    joinedAgo: string;
    viewerFollows?: boolean;
    isSelf?: boolean;
    stats?: {
        citations: number;
        crystals: number;
        circles: number;
    } | null;
    sharedCircles?: { id: number; name: string; kind: string; level: number }[];
    recentActivity?: { text: string; time: string; type: 'post' | 'draft' | 'crystal' }[];
    loading?: boolean;
    errorMessage?: string | null;
}

export interface MemberFollowState {
    isSelf: boolean;
    viewerFollows: boolean;
    loading: boolean;
    syncing?: boolean;
    indexTimeout?: boolean;
    disabled?: boolean;
    hint?: string | null;
}

interface MemberCardProps {
    open: boolean;
    member: MemberProfile | null;
    onClose: () => void;
    onMessage?: (handle: string) => void;
    onInvite?: (handle: string) => void;
    followState?: MemberFollowState | null;
    targetPubkey?: string | null;
    onToggleFollow?: (nextFollowState: boolean) => void;
}

/* ═══ Component ═══ */

export default function MemberCard({
    open,
    member,
    onClose,
    onMessage,
    onInvite,
    followState,
    targetPubkey,
    onToggleFollow,
}: MemberCardProps) {
    const t = useI18n('MemberCard');
    if (!member) return null;

    const roleClass =
        member.role === 'owner' ? styles.roleOwner :
            member.role === 'curator' ? styles.roleAdmin :
                styles.roleMember;

    const activityIcon = (type: string) => {
        switch (type) {
            case 'post': return <MessageSquare size={12} />;
            case 'draft': return <BookOpen size={12} />;
            case 'crystal': return <Gem size={12} />;
            default: return <Clock size={12} />;
        }
    };

    const followEnabled = Boolean(
        onToggleFollow
        && !followState?.isSelf
        && !followState?.disabled
        && targetPubkey,
    );
    const followBusy = Boolean(followState?.loading || followState?.syncing);
    const followLabel = followBusy
        ? t('actions.followPending')
        : (followState?.viewerFollows ? t('actions.following') : t('actions.follow'));
    const followHintText = !targetPubkey && !followState?.isSelf
        ? t('followHint.profileUnavailable')
        : (followState?.hint || null);
    const roleLabel = t(`roles.${member.role}`);

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={styles.card}
                        initial={{ opacity: 0, scale: 0.92, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.92, y: 20 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Banner + Avatar */}
                        <div className={styles.banner}>
                            <div className={styles.avatarWrap}>
                                {member.name.charAt(0).toUpperCase()}
                            </div>
                            <button className={styles.closeBtn} onClick={onClose}>
                                <X size={14} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className={styles.body}>
                            <div className={styles.name}>{member.name}</div>
                            <div className={styles.metaRow}>
                                <div className={styles.handle}>
                                    {t('meta.handle', {
                                        handle: member.handle,
                                        joinedAgo: member.joinedAgo,
                                    })}
                                </div>
                                {!followState?.isSelf && (
                                    <button
                                        type="button"
                                        className={`${styles.followBtn} ${followState?.viewerFollows ? styles.followBtnActive : ''}`}
                                        disabled={!followEnabled || followBusy}
                                        onClick={() => {
                                            if (!followEnabled || followBusy) return;
                                            onToggleFollow?.(!Boolean(followState?.viewerFollows));
                                        }}
                                    >
                                        {followBusy ? <Loader2 size={14} className={styles.followSpinner} /> : null}
                                        {followLabel}
                                    </button>
                                )}
                            </div>
                            <span className={`${styles.roleBadge} ${roleClass}`}>
                                {roleLabel}
                            </span>
                            {followHintText ? <div className={styles.followHint}>{followHintText}</div> : null}

                            {/* Stats Grid */}
                            {member.loading ? (
                                <div className={styles.loadingState}>{t('states.loading')}</div>
                            ) : member.errorMessage ? (
                                <div className={styles.errorState}>{member.errorMessage}</div>
                            ) : member.stats ? (
                                <div className={styles.stats}>
                                    <div className={styles.stat}>
                                        <span className={styles.statValue}>{member.stats.citations}</span>
                                        <span className={styles.statLabel}>{t('stats.citations')}</span>
                                    </div>
                                    <div className={styles.stat}>
                                        <span className={styles.statValue}>{member.stats.crystals}</span>
                                        <span className={styles.statLabel}>{t('stats.crystals')}</span>
                                    </div>
                                    <div className={styles.stat}>
                                        <span className={styles.statValue}>{member.stats.circles}</span>
                                        <span className={styles.statLabel}>{t('stats.circles')}</span>
                                    </div>
                                </div>
                            ) : null}

                            {/* Shared Circles */}
                            {!member.loading && !member.errorMessage && (member.sharedCircles?.length || 0) > 0 && (
                                <div className={styles.section}>
                                    <div className={styles.sectionTitle}>{t('sections.sharedCircles')}</div>
                                    <div className={styles.circleChips}>
                                        {member.sharedCircles?.map((c) => (
                                            <span key={c.id} className={styles.chip}>
                                                {c.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Recent Activity */}
                            {!member.loading && !member.errorMessage && (member.recentActivity?.length || 0) > 0 && (
                                <div className={`${styles.section} ${styles.activity}`}>
                                    <div className={styles.sectionTitle}>{t('sections.recentActivity')}</div>
                                    {member.recentActivity?.map((a, i) => (
                                        <div key={i} className={styles.activityItem}>
                                            <span className={styles.activityIcon}>{activityIcon(a.type)}</span>
                                            <span>{a.text}</span>
                                            <span className={styles.activityTime}>{a.time}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className={styles.actions}>
                                <button
                                    className={`${styles.actionBtn} ${styles.actionPrimary}`}
                                    disabled={!onMessage}
                                    onClick={() => onMessage?.(member.handle)}
                                >
                                    <MessageSquare size={14} />
                                    {t('actions.message')}
                                </button>
                                <button
                                    className={`${styles.actionBtn} ${styles.actionSecondary}`}
                                    disabled={!onInvite}
                                    onClick={() => onInvite?.(member.handle)}
                                >
                                    <UserPlus size={14} />
                                    {t('actions.invite')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
