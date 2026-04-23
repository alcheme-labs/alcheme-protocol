'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircle, SendHorizonal, X } from 'lucide-react';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import type { GQLPost } from '@/lib/apollo/types';
import styles from './FeedThreadSheet.module.css';

interface FeedThreadSheetProps {
    open: boolean;
    post: GQLPost | null;
    replies: GQLPost[];
    canReply: boolean;
    submitting?: boolean;
    error?: string | null;
    onClose: () => void;
    onSubmitReply?: (content: string) => Promise<boolean> | boolean;
}

function renderTime(value: string, locale: string): string {
    try {
        return new Date(value).toLocaleString(locale, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return value;
    }
}

export default function FeedThreadSheet({
    open,
    post,
    replies,
    canReply,
    submitting = false,
    error = null,
    onClose,
    onSubmitReply,
}: FeedThreadSheetProps) {
    const t = useI18n('FeedThreadSheet');
    const locale = useCurrentLocale();
    const [draft, setDraft] = useState('');

    useEffect(() => {
        if (!open) {
            setDraft('');
        }
    }, [open]);

    if (!post) return null;

    const handleSubmit = async () => {
        const next = draft.trim();
        if (!next || !onSubmitReply || submitting) return;
        const shouldClear = await onSubmitReply(next);
        if (shouldClear !== false) {
            setDraft('');
        }
    };

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
                        className={styles.sheet}
                        data-testid="feed-thread-sheet"
                        initial={{ y: '100%', opacity: 0.5 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: '100%', opacity: 0.5 }}
                        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.handle} />
                        <div className={styles.header}>
                            <div>
                                <div className={styles.eyebrow}>{t('header.eyebrow')}</div>
                                <h3 className={styles.title}>{t('header.title')}</h3>
                            </div>
                            <button
                                type="button"
                                className={styles.closeBtn}
                                onClick={onClose}
                                aria-label={t('header.closeAria')}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className={styles.scrollArea}>
                            <article className={styles.rootPost}>
                                <div className={styles.postMeta}>
                                    <span className={styles.author}>@{post.author.handle}</span>
                                    <span>{renderTime(post.createdAt, locale)}</span>
                                </div>
                                <p className={styles.postBody} data-testid="feed-thread-root-text">
                                    {post.text || t('states.noBody')}
                                </p>
                            </article>

                            <div className={styles.sectionLabel}>
                                <MessageCircle size={12} />
                                <span>
                                    {replies.length > 0
                                        ? t('thread.replyCount', {count: replies.length})
                                        : t('thread.noReplies')}
                                </span>
                            </div>

                            {replies.length > 0 ? (
                                <div className={styles.replyList}>
                                    {replies.map((reply) => (
                                        <article key={reply.id} className={styles.replyCard}>
                                            <div className={styles.postMeta}>
                                                <span className={styles.author}>@{reply.author.handle}</span>
                                                <span>{renderTime(reply.createdAt, locale)}</span>
                                            </div>
                                            <p className={styles.replyBody} data-testid="feed-thread-reply-text">
                                                {reply.text || t('states.noBody')}
                                            </p>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.emptyState}>{t('states.empty')}</div>
                            )}
                        </div>

                        <div className={styles.composer}>
                            <textarea
                                className={styles.input}
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                placeholder={canReply ? t('composer.placeholder') : t('composer.disabledPlaceholder')}
                                disabled={!canReply || submitting}
                                rows={3}
                            />
                            {error ? <div className={styles.error}>{error}</div> : null}
                            <div className={styles.composerFooter}>
                                <div className={styles.helperText}>
                                    {canReply ? t('composer.helper') : t('composer.readOnly')}
                                </div>
                                <button
                                    type="button"
                                    className={styles.submitBtn}
                                    onClick={() => { void handleSubmit(); }}
                                    disabled={!canReply || submitting || draft.trim().length === 0}
                                >
                                    <SendHorizonal size={14} />
                                    <span>{submitting ? t('actions.sending') : t('actions.sendReply')}</span>
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
