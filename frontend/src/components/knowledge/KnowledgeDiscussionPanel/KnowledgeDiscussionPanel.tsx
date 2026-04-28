'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import type { DiscussionSessionState } from '@/lib/circle/types';
import { fetchCircleMembershipState } from '@/lib/api/circlesMembership';
import {
    createDiscussionSession,
    fetchKnowledgeDiscussionMessages,
    refreshDiscussionSession,
    sendKnowledgeDiscussionMessage,
    type DiscussionMessageDto,
} from '@/lib/api/discussion';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './KnowledgeDiscussionPanel.module.css';

interface KnowledgeDiscussionPanelProps {
    knowledgeId: string;
    circleId: number;
    knowledgeTitle: string;
    description: string | null;
}

type MembershipState = 'loading' | 'joined' | 'locked';

function buildSummary(description: string | null, fallback: string): string {
    const firstParagraph = (description || '').split('\n\n').map((part) => part.trim()).find(Boolean);
    return firstParagraph || fallback;
}

function formatFloor(index: number, label: string): string {
    return `${String(index + 1).padStart(2, '0')} ${label}`;
}

function formatRelativeTime(value: string, locale: string): string {
    const ms = Date.now() - new Date(value).getTime();
    const minutes = Math.floor(ms / 60_000);
    const formatter = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
    if (minutes < 1) return formatter.format(0, 'minute');
    if (minutes < 60) return formatter.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return formatter.format(-hours, 'hour');
    return formatter.format(-Math.floor(hours / 24), 'day');
}

function scopeAllowsCircle(scope: string, circleId: number): boolean {
    return scope === 'circle:*' || scope === `circle:${circleId}`;
}

export default function KnowledgeDiscussionPanel({
    knowledgeId,
    circleId,
    knowledgeTitle,
    description,
}: KnowledgeDiscussionPanelProps) {
    const t = useI18n('KnowledgeDiscussionPanel');
    const locale = useCurrentLocale();
    const { publicKey, signMessage } = useWallet();
    const { setVisible: setWalletModalVisible } = useWalletModal();
    const walletPubkey = publicKey?.toBase58() || null;

    const [membershipState, setMembershipState] = useState<MembershipState>('loading');
    const [messages, setMessages] = useState<DiscussionMessageDto[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [threadError, setThreadError] = useState<string | null>(null);
    const [composerText, setComposerText] = useState('');
    const [posting, setPosting] = useState(false);
    const [discussionSession, setDiscussionSession] = useState<DiscussionSessionState | null>(null);
    const sessionBootstrapRef = useRef<Promise<string | null> | null>(null);

    const topicSummary = useMemo(
        () => buildSummary(description, t('fallbackSummary')),
        [description, t],
    );
    const discussionAuthMode = process.env.NEXT_PUBLIC_DISCUSSION_AUTH_MODE || 'session_token';
    const useSessionTokenAuth = discussionAuthMode === 'session_token';
    const shouldSignEachMessage =
        !useSessionTokenAuth && process.env.NEXT_PUBLIC_DISCUSSION_REQUIRE_SIGNATURE === 'true';
    const discussionSessionStorageKey = useMemo(
        () => (walletPubkey ? `alcheme_discussion_session_${walletPubkey}` : null),
        [walletPubkey],
    );

    const loadMessages = useCallback(async () => {
        if (!knowledgeId) return;
        setLoadingMessages(true);
        setThreadError(null);
        try {
            const response = await fetchKnowledgeDiscussionMessages({
                knowledgeId,
                limit: 80,
            });
            setMessages(response.messages);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '');
            if (message.includes('403') || message.includes('401')) {
                setMembershipState('locked');
                setMessages([]);
                setThreadError(null);
            } else {
                setThreadError(t('errors.loadThread'));
            }
        } finally {
            setLoadingMessages(false);
        }
    }, [knowledgeId, t]);

    useEffect(() => {
        let cancelled = false;
        setMembershipState('loading');
        setThreadError(null);
        setMessages([]);

        void fetchCircleMembershipState(circleId)
            .then((snapshot) => {
                if (cancelled) return;
                const joined = snapshot.joinState === 'joined' && snapshot.membership?.status === 'Active';
                setMembershipState(joined ? 'joined' : 'locked');
                if (joined) {
                    void loadMessages();
                }
            })
            .catch(() => {
                if (cancelled) return;
                setMembershipState('locked');
            });

        return () => {
            cancelled = true;
        };
    }, [circleId, loadMessages]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!discussionSessionStorageKey) {
            setDiscussionSession(null);
            return;
        }
        try {
            const raw = localStorage.getItem(discussionSessionStorageKey);
            if (!raw) {
                setDiscussionSession(null);
                return;
            }
            const parsed = JSON.parse(raw) as DiscussionSessionState;
            const expiresAtMs = Date.parse(parsed.expiresAt);
            if (
                !Number.isFinite(expiresAtMs)
                || expiresAtMs <= Date.now()
                || parsed.senderPubkey !== walletPubkey
                || !scopeAllowsCircle(parsed.scope, circleId)
            ) {
                localStorage.removeItem(discussionSessionStorageKey);
                setDiscussionSession(null);
                return;
            }
            setDiscussionSession(parsed);
        } catch {
            setDiscussionSession(null);
        }
    }, [circleId, discussionSessionStorageKey, walletPubkey]);

    const persistDiscussionSession = useCallback((session: DiscussionSessionState | null) => {
        if (typeof window === 'undefined' || !discussionSessionStorageKey) return;
        try {
            if (!session) {
                localStorage.removeItem(discussionSessionStorageKey);
                return;
            }
            localStorage.setItem(discussionSessionStorageKey, JSON.stringify(session));
        } catch {
            // ignore storage failures
        }
    }, [discussionSessionStorageKey]);

    const ensureDiscussionSessionToken = useCallback(async (): Promise<string | null> => {
        if (!useSessionTokenAuth) return null;
        if (!walletPubkey) throw new Error(t('errors.connectWalletFirst'));

        const current = discussionSession;
        const now = Date.now();
        const expiresAtMs = current ? Date.parse(current.expiresAt) : 0;
        const isUsableCurrent =
            !!current
            && current.senderPubkey === walletPubkey
            && scopeAllowsCircle(current.scope, circleId)
            && Number.isFinite(expiresAtMs)
            && expiresAtMs - now > 60_000;
        if (isUsableCurrent) {
            return current.discussionAccessToken;
        }

        if (sessionBootstrapRef.current) {
            return sessionBootstrapRef.current;
        }

        sessionBootstrapRef.current = (async () => {
            if (current?.sessionId && current.discussionAccessToken && scopeAllowsCircle(current.scope, circleId)) {
                try {
                    const refreshed = await refreshDiscussionSession({
                        sessionId: current.sessionId,
                        discussionAccessToken: current.discussionAccessToken,
                    });
                    const nextSession: DiscussionSessionState = {
                        sessionId: refreshed.sessionId,
                        discussionAccessToken: refreshed.discussionAccessToken,
                        expiresAt: refreshed.expiresAt,
                        senderPubkey: refreshed.senderPubkey,
                        scope: refreshed.scope,
                    };
                    setDiscussionSession(nextSession);
                    persistDiscussionSession(nextSession);
                    return nextSession.discussionAccessToken;
                } catch {
                    // fall through to create
                }
            }

            const created = await createDiscussionSession({
                senderPubkey: walletPubkey,
                senderHandle: `${walletPubkey.slice(0, 4)}...${walletPubkey.slice(-4)}`,
                signMessage,
                scope: `circle:${circleId}`,
            });
            const nextSession: DiscussionSessionState = {
                sessionId: created.sessionId,
                discussionAccessToken: created.discussionAccessToken,
                expiresAt: created.expiresAt,
                senderPubkey: created.senderPubkey,
                scope: created.scope,
            };
            setDiscussionSession(nextSession);
            persistDiscussionSession(nextSession);
            return nextSession.discussionAccessToken;
        })();

        try {
            return await sessionBootstrapRef.current;
        } finally {
            sessionBootstrapRef.current = null;
        }
    }, [circleId, discussionSession, persistDiscussionSession, signMessage, t, useSessionTokenAuth, walletPubkey]);

    const handleSubmit = useCallback(async () => {
        const text = composerText.trim();
        if (!text || posting) return;
        if (membershipState !== 'joined') return;
        if (!walletPubkey) {
            setWalletModalVisible(true);
            return;
        }

        setPosting(true);
        setThreadError(null);
        try {
            const discussionAccessToken = await ensureDiscussionSessionToken();
            const response = await sendKnowledgeDiscussionMessage({
                circleId,
                knowledgeId,
                senderPubkey: walletPubkey,
                senderHandle: `${walletPubkey.slice(0, 4)}...${walletPubkey.slice(-4)}`,
                text,
                prevEnvelopeId: messages.at(-1)?.envelopeId || null,
                signMessage: shouldSignEachMessage ? signMessage : undefined,
                discussionAccessToken: discussionAccessToken || undefined,
            });
            setMessages((prev) => [...prev, response.message]);
            setComposerText('');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '');
            if (message.includes('403') || message.includes('401')) {
                setThreadError(t('errors.permissionDenied'));
            } else {
                setThreadError(t('errors.postFailed'));
            }
        } finally {
            setPosting(false);
        }
    }, [
        circleId,
        composerText,
        ensureDiscussionSessionToken,
        knowledgeId,
        membershipState,
        messages,
        posting,
        setWalletModalVisible,
        shouldSignEachMessage,
        signMessage,
        t,
        walletPubkey,
    ]);

    return (
        <section className={styles.panel} aria-labelledby="knowledge-discussion-heading">
            <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Crystal Forum</span>
                <h2 id="knowledge-discussion-heading" className={styles.title}>{t('title')}</h2>
                <p className={styles.lead}>
                    {t('lead')}
                </p>
            </div>

            <div className={styles.topicCard}>
                <div className={styles.topicKicker}>{t('topic.kicker')}</div>
                <h3 className={styles.topicTitle}>{knowledgeTitle}</h3>
                <p className={styles.topicSummary}>{topicSummary}</p>
                <div className={styles.topicRule}>{t('topic.rule')}</div>
            </div>

            {membershipState === 'loading' && (
                <div className={styles.statusCard}>
                    <strong>{t('states.membershipLoading.title')}</strong>
                    <span>{t('states.membershipLoading.description')}</span>
                </div>
            )}

            {membershipState === 'locked' && (
                <div className={`${styles.statusCard} ${styles.statusLocked}`}>
                    <strong>{t('states.locked.title')}</strong>
                    <span>{t('states.locked.description')}</span>
                </div>
            )}

            {membershipState === 'joined' && loadingMessages && (
                <div className={styles.statusCard}>
                    <strong>{t('states.threadLoading.title')}</strong>
                    <span>{t('states.threadLoading.description')}</span>
                </div>
            )}

            {membershipState === 'joined' && !loadingMessages && threadError && (
                <div className={styles.statusCard}>
                    <strong>{t('states.unavailable.title')}</strong>
                    <span>{threadError}</span>
                </div>
            )}

            {membershipState === 'joined' && !loadingMessages && !threadError && messages.length === 0 && (
                <div className={styles.emptyState}>{t('states.empty.description')}</div>
            )}

            {membershipState === 'joined' && messages.length > 0 && (
                <ol className={styles.floorList}>
                    {messages.map((message, index) => (
                        <li key={message.envelopeId} className={styles.floorItem}>
                            <div className={styles.floorMarker}>
                                <div className={styles.floorBadge}>{formatFloor(index, t('message.floorLabel'))}</div>
                            </div>
                            <article className={styles.floorCard}>
                                <div className={styles.floorMeta}>
                                    <span className={styles.floorAuthor}>@{message.senderHandle || t('message.unknownAuthor')}</span>
                                    <span>·</span>
                                    <span>{formatRelativeTime(message.createdAt, locale)}</span>
                                </div>
                                <p className={styles.floorBody}>{message.text}</p>
                            </article>
                        </li>
                    ))}
                </ol>
            )}

            {membershipState === 'joined' && (
                <div className={styles.composer}>
                    <label className={styles.composerLabel} htmlFor="knowledge-discussion-composer">
                        <span>{t('composer.title')}</span>
                        <span className={styles.composerHint}>{t('composer.hint')}</span>
                    </label>
                    <textarea
                        id="knowledge-discussion-composer"
                        className={styles.composerTextarea}
                        value={composerText}
                        onChange={(event) => setComposerText(event.target.value)}
                        placeholder={t('composer.placeholder')}
                        maxLength={4000}
                    />
                    <div className={styles.composerFooter}>
                        <span className={styles.composerStatus}>
                            {!walletPubkey ? t('composer.walletRequired') : t('composer.boundHint')}
                        </span>
                        <div className={styles.composerActions}>
                            {!walletPubkey && (
                                <button
                                    type="button"
                                    className={styles.secondaryBtn}
                                    onClick={() => setWalletModalVisible(true)}
                                >
                                    {t('actions.connectWallet')}
                                </button>
                            )}
                            <button
                                type="button"
                                className={styles.primaryBtn}
                                onClick={() => void handleSubmit()}
                                disabled={!composerText.trim() || posting}
                            >
                                {posting ? t('actions.posting') : t('actions.submit')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
