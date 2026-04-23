'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@apollo/client/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, MessageSquare, BookOpen, Users, Flame, Check } from 'lucide-react';

import { Card } from '@/components/ui/Card';
import { GET_NOTIFICATIONS, MARK_NOTIFICATIONS_READ } from '@/lib/apollo/queries';
import type { NotificationsResponse, MarkNotificationsReadResponse, GQLNotification } from '@/lib/apollo/types';
import { resolveNotificationHref } from '@/lib/notifications/routing';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

type NotificationType = 'crystal' | 'citation' | 'draft' | 'circle' | 'highlight' | 'forward' | 'identity';

const ICON_MAP: Record<NotificationType, React.ReactNode> = {
    crystal: <BookOpen size={14} strokeWidth={1.5} />,
    citation: <MessageSquare size={14} strokeWidth={1.5} />,
    draft: <Flame size={14} strokeWidth={1.5} />,
    circle: <Users size={14} strokeWidth={1.5} />,
    highlight: <Bell size={14} strokeWidth={1.5} />,
    forward: <MessageSquare size={14} strokeWidth={1.5} />,
    identity: <Users size={14} strokeWidth={1.5} />,
};

const STATE_MAP: Record<NotificationType, 'crystal' | 'alloy' | 'ore'> = {
    crystal: 'crystal',
    citation: 'ore',
    draft: 'alloy',
    circle: 'ore',
    highlight: 'ore',
    forward: 'ore',
    identity: 'ore',
};

const KNOWN_TYPES = new Set<string>(['crystal', 'citation', 'draft', 'circle', 'highlight', 'forward', 'identity']);

function normalizeType(raw: string): NotificationType {
    if (KNOWN_TYPES.has(raw)) return raw as NotificationType;
    return 'highlight'; // fallback for unknown types
}

function formatRelativeTime(iso: string, locale: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(ms / 60_000);
    const formatter = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
    if (minutes < 1) return formatter.format(0, 'minute');
    if (minutes < 60) return formatter.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return formatter.format(-hours, 'hour');
    const days = Math.floor(hours / 24);
    if (days < 30) return formatter.format(-days, 'day');
    return formatter.format(-Math.floor(days / 30), 'month');
}

export default function NotificationsPage() {
    const t = useI18n('NotificationsPage');
    const locale = useCurrentLocale();
    const router = useRouter();
    const { data, loading, error } = useQuery<NotificationsResponse>(GET_NOTIFICATIONS, {
        variables: { limit: 50, offset: 0 },
        fetchPolicy: 'cache-and-network',
    });

    const [markNotificationsRead] = useMutation<MarkNotificationsReadResponse>(MARK_NOTIFICATIONS_READ, {
        refetchQueries: [{ query: GET_NOTIFICATIONS, variables: { limit: 50, offset: 0 } }],
    });

    // Local optimistic read state
    const [localReadIds, setLocalReadIds] = useState<Set<number>>(new Set());

    const notifications = useMemo(() => {
        if (!data?.myNotifications) return [];
        return data.myNotifications.map(n => ({
            ...n,
            read: n.read || localReadIds.has(n.id),
        }));
    }, [data, localReadIds]);

    const unreadCount = notifications.filter(n => !n.read).length;

    const markRead = useCallback((id: number) => {
        setLocalReadIds(prev => new Set(prev).add(id));
        markNotificationsRead({ variables: { ids: [id] } }).catch(console.error);
    }, [markNotificationsRead]);

    const handleNotificationClick = useCallback((notification: GQLNotification) => {
        markRead(notification.id);
        const href = resolveNotificationHref(notification);
        if (href) {
            router.push(href);
        }
    }, [markRead, router]);

    const markAllRead = useCallback(() => {
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
        if (unreadIds.length === 0) return;
        setLocalReadIds(prev => {
            const next = new Set(prev);
            unreadIds.forEach(id => next.add(id));
            return next;
        });
        markNotificationsRead({ variables: { ids: unreadIds } }).catch(console.error);
    }, [notifications, markNotificationsRead]);

    return (
        <div className={styles.page}>
            <div className="content-container">
                <motion.header
                    className={styles.header}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
                >
                    <div className={styles.headerLeft}>
                        <h1 className={styles.title}>{t('title')}</h1>
                        {unreadCount > 0 && (
                            <span className={styles.unreadBadge}>{unreadCount}</span>
                        )}
                    </div>
                    {unreadCount > 0 && (
                        <button className={styles.markAllBtn} onClick={markAllRead}>
                            <Check size={14} /> {t('actions.markAllRead')}
                        </button>
                    )}
                </motion.header>

                <div className={styles.list}>
                    {loading && notifications.length === 0 && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 'var(--space-6) 0' }}
                        >
                            {t('states.loading')}
                        </motion.p>
                    )}

                    {error && notifications.length === 0 && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            style={{ textAlign: 'center', color: 'var(--color-error, #f87171)', padding: 'var(--space-6) 0' }}
                        >
                            {t('states.error')}
                        </motion.p>
                    )}

                    {!loading && !error && notifications.length === 0 && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', padding: 'var(--space-6) 0' }}
                        >
                            {t('states.empty')}
                        </motion.p>
                    )}

                    <AnimatePresence>
                        {notifications.map((notification, i) => {
                            const type = normalizeType(notification.type);
                            return (
                                <motion.div
                                    key={notification.id}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: 0.1 + i * 0.04, ease: [0.2, 0.8, 0.2, 1] }}
                                    onClick={() => handleNotificationClick(notification)}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <Card
                                        state={STATE_MAP[type]}
                                        heatState={type === 'draft' ? 'cooling' : undefined}
                                    >
                                        <div className={styles.notificationRow}>
                                            <div className={`${styles.iconBadge} ${styles[type]}`}>
                                                {ICON_MAP[type]}
                                            </div>
                                            <div className={styles.notificationBody}>
                                                <p className={`${styles.notificationText} ${!notification.read ? styles.unread : ''}`}>
                                                    {notification.displayBody || notification.displayTitle}
                                                </p>
                                                <p className={styles.notificationTime}>
                                                    {formatRelativeTime(notification.createdAt, locale)}
                                                </p>
                                            </div>
                                            {!notification.read && <div className={styles.unreadDot} />}
                                        </div>
                                    </Card>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}
