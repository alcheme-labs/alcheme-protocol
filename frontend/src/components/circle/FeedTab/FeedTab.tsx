'use client';

import { motion } from 'framer-motion';
import { Heart, MessageCircle, Share2, Image, Rss, SendHorizonal } from 'lucide-react';
import styles from './FeedTab.module.css';
import { resolveFeedLikeState } from '@/lib/feed/likeState';
import { resolveFeedRepostState } from '@/lib/feed/repostState';
import { useI18n } from '@/i18n/useI18n';
import ProfileAvatar from '@/components/profile/ProfileAvatar/ProfileAvatar';
import ContentDownrankAppealPanel from './ContentDownrankAppealPanel';

/* ═══ Types ═══ */

export interface FeedPost {
    id: number;
    contentId: string;
    onChainAddress?: string | null;
    author: string;
    authorPubkey?: string;
    authorAvatarUri?: string | null;
    text: string;
    time: string;
    images?: string[];  // placeholder urls
    likes: number;
    comments: number;
    reposts: number;
    visibility: 'Public' | 'CircleOnly' | 'FollowersOnly' | 'Private';
    rankingAdjustmentState?: 'normal' | 'adjusted';
    rankingAdjustmentFactorBps?: number | null;
    rankingAdjustmentExpiresAt?: string | null;
    liked?: boolean;
    pendingLike?: boolean;
    pendingRepost?: boolean;
    repostOfAddress?: string | null;
    repostOf?: {
        contentId: string;
        author: string;
        authorPubkey?: string;
        text: string;
        time: string;
    } | null;
    replies?: FeedReply[];
}

export interface FeedReply {
    id: number;
    contentId: string;
    author: string;
    authorAvatarUri?: string | null;
    text: string;
    time: string;
}

function isSyntheticRepostText(text: string, repostOfAddress?: string | null): boolean {
    return Boolean(repostOfAddress) && /^content:\/\/repost\//.test(text.trim());
}

interface FeedTabProps {
    posts: FeedPost[];
    circleName: string;
    walletConnected?: boolean;
    repostMembershipPending?: boolean;
    interactionError?: string | null;
    circleId: number;
    walletPubkey?: string | null;
    onAvatarTap?: (author: string) => void;
    onCompose?: () => void;
    onLike?: (post: FeedPost) => void;
    onComment?: (post: FeedPost) => void;
    onRepost?: (post: FeedPost) => void;
}

/* ═══ Component ═══ */

export default function FeedTab({
    posts,
    circleName,
    walletConnected = false,
    repostMembershipPending = false,
    interactionError = null,
    circleId,
    walletPubkey = null,
    onAvatarTap,
    onCompose,
    onLike,
    onComment,
    onRepost,
}: FeedTabProps) {
    const t = useI18n('FeedTab');

    const renderComposer = () => (
        <div className={styles.feedCompose}>
            <button
                type="button"
                className={styles.feedComposeInput}
                onClick={onCompose}
                disabled={!onCompose}
            >
                {t('composer.placeholder', {circleName})}
            </button>
            <button
                className={styles.feedComposeBtn}
                type="button"
                onClick={onCompose}
                disabled={!onCompose}
                aria-label={onCompose ? t('composer.aria', {circleName}) : t('composer.unavailable')}
                title={onCompose ? t('composer.aria', {circleName}) : t('composer.unavailable')}
            >
                <SendHorizonal size={16} />
            </button>
        </div>
    );

    if (posts.length === 0) {
        return (
            <div className={styles.feedContainer}>
                <div className={styles.feedEmpty}>
                    <Rss size={40} className={styles.feedEmptyIcon} />
                    <p className={styles.feedEmptyText}>{t('states.empty')}</p>
                </div>
                {renderComposer()}
            </div>
        );
    }

    return (
        <div className={styles.feedContainer}>
            {interactionError ? (
                <div className={styles.interactionError} role="alert">
                    {interactionError}
                </div>
            ) : null}
            <div className={styles.feedList}>
            {posts.map((post, idx) => {
                const likeState = resolveFeedLikeState({
                    likes: post.likes,
                    liked: post.liked,
                    pendingLike: post.pendingLike,
                });
                const repostState = resolveFeedRepostState({
                    isRepost: Boolean(post.repostOfAddress),
                    walletConnected,
                    canPublish: Boolean(onRepost),
                    pending: Boolean(post.pendingRepost),
                    membershipPending: repostMembershipPending,
                });
                const repostReason = repostState.reason
                    ? t(`actions.repostReasons.${repostState.reason}`)
                    : null;
                const visiblePostText = isSyntheticRepostText(post.text, post.repostOfAddress)
                    ? ''
                    : post.text;

                return (
                <motion.div
                    key={post.id}
                    className={styles.feedPost}
                    data-testid={`feed-post-${post.contentId}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: idx * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    {/* Header */}
                    <div className={styles.feedPostHeader}>
                        <div
                            className={styles.feedAvatar}
                            onClick={() => onAvatarTap?.(post.author)}
                            style={{ cursor: onAvatarTap ? 'pointer' : undefined }}
                        >
                            <ProfileAvatar
                                handle={post.author}
                                avatarUri={post.authorAvatarUri}
                                className={styles.feedAvatarImage}
                                fallback={post.author.charAt(0).toUpperCase()}
                            />
                        </div>
                        <div className={styles.feedAuthorInfo}>
                            <div className={styles.feedAuthor}>@{post.author}</div>
                            <div className={styles.feedTime}>{post.time}</div>
                        </div>
                    </div>

                    {post.rankingAdjustmentState === 'adjusted' && post.rankingAdjustmentExpiresAt ? (
                        <>
                            <div
                                className={styles.rankingAdjustment}
                                data-testid={`feed-post-ranking-adjustment-${post.contentId}`}
                            >
                                {t('ranking.adjustedUntil', {
                                    expiresAt: new Date(post.rankingAdjustmentExpiresAt).toLocaleString(),
                                })}
                            </div>
                            {walletPubkey && post.authorPubkey === walletPubkey ? (
                                <ContentDownrankAppealPanel circleId={circleId} contentId={post.contentId} />
                            ) : null}
                        </>
                    ) : null}

                    {/* Content */}
                    {visiblePostText ? (
                        <p className={styles.feedContent}>{visiblePostText}</p>
                    ) : null}

                    {post.repostOf ? (
                        <div className={styles.repostCard}>
                            <div className={styles.repostMeta}>{t('repost.fromAuthor', {author: post.repostOf.author})}</div>
                            <p className={styles.repostBody}>{post.repostOf.text || t('repost.emptyBody')}</p>
                            <div className={styles.repostTime}>{post.repostOf.time}</div>
                        </div>
                    ) : post.repostOfAddress ? (
                        <div className={styles.repostCard}>
                            <div className={styles.repostMeta}>{t('repost.fromOriginal')}</div>
                            <p className={styles.repostBody}>{t('repost.unavailable')}</p>
                        </div>
                    ) : null}

                    {/* Placeholder Images */}
                    {post.images && post.images.length > 0 && (
                        <div className={`${styles.feedImages} ${post.images.length === 1 ? styles.feedImages1 :
                            post.images.length === 2 ? styles.feedImages2 :
                                styles.feedImages3
                            }`}>
                            {post.images.map((_, i) => (
                                <div key={i} className={styles.feedImagePlaceholder}>
                                    <Image size={20} />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Actions */}
                    <div className={styles.feedActions}>
                        <button
                            className={`${styles.feedAction} ${likeState.active ? styles.feedActionActive : ''}`}
                            type="button"
                            disabled={likeState.disabled || !onLike}
                            aria-label={likeState.active ? t('actions.liked') : t('actions.like')}
                            title={likeState.active ? t('actions.liked') : t('actions.like')}
                            onClick={() => onLike?.(post)}
                        >
                            <Heart size={14} fill={likeState.active ? 'currentColor' : 'none'} />
                            {likeState.likes > 0 && likeState.likes}
                        </button>
                        <button
                            className={styles.feedAction}
                            type="button"
                            disabled={!onComment}
                            aria-label={t('actions.comment')}
                            data-testid={`feed-post-comment-${post.contentId}`}
                            title={onComment ? t('actions.openReplies') : t('actions.commentUnavailable')}
                            onClick={() => onComment?.(post)}
                        >
                            <MessageCircle size={14} />
                            {post.comments > 0 && post.comments}
                        </button>
                        <button
                            className={styles.feedAction}
                            type="button"
                            disabled={repostState.disabled}
                            aria-label={t('actions.repost')}
                            title={repostReason ?? t('actions.repost')}
                            onClick={() => onRepost?.(post)}
                        >
                            <Share2 size={14} />
                            {post.reposts > 0 && post.reposts}
                        </button>
                    </div>

                    {post.replies && post.replies.length > 0 ? (
                        <div className={styles.feedReplies} data-testid={`feed-post-replies-${post.contentId}`}>
                            {post.replies.map((reply) => (
                                <article
                                    key={reply.id}
                                    className={styles.feedReply}
                                    data-testid={`feed-reply-${reply.contentId}`}
                                >
                                    <ProfileAvatar
                                        handle={reply.author}
                                        avatarUri={reply.authorAvatarUri}
                                        className={styles.feedReplyAvatar}
                                        fallback={reply.author.charAt(0).toUpperCase()}
                                    />
                                    <div className={styles.feedReplyBody}>
                                        <div className={styles.feedReplyMeta}>
                                            <span className={styles.feedReplyAuthor}>@{reply.author}</span>
                                            <span>{reply.time}</span>
                                        </div>
                                        <p className={styles.feedReplyText}>{reply.text}</p>
                                    </div>
                                </article>
                            ))}
                            {post.comments > post.replies.length ? (
                                <button
                                    type="button"
                                    className={styles.feedRepliesMore}
                                    onClick={() => onComment?.(post)}
                                >
                                    {t('thread.viewAll', {count: post.comments})}
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </motion.div>
                );
            })}
            </div>

            {/* Compose Bar */}
            {renderComposer()}
        </div>
    );
}
