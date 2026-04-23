'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Gem, AtSign, FileEdit, Bell, UserPlus, Users } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import styles from './NotificationPanel.module.css';

/* ═══ Types ═══ */

export interface Notification {
    id: number;
    type: 'post' | 'crystal' | 'mention' | 'draft' | 'system' | 'invite' | 'highlight' | 'citation' | 'circle' | 'forward' | 'identity';
    text: string;
    time: string;
    circle?: string;
    sourceType?: string | null;
    sourceId?: string | null;
    circleId?: number | null;
    read: boolean;
}

interface NotificationPanelProps {
    open: boolean;
    notifications: Notification[];
    onClose: () => void;
    onMarkAllRead?: () => void;
    onNotificationClick?: (n: Notification) => void;
}

/* ═══ Component ═══ */

const ICON_MAP: Record<string, { icon: React.ReactNode; className: string }> = {
    post: { icon: <MessageSquare size={14} />, className: 'iconPost' },
    crystal: { icon: <Gem size={14} />, className: 'iconCrystal' },
    citation: { icon: <MessageSquare size={14} />, className: 'iconPost' },
    mention: { icon: <AtSign size={14} />, className: 'iconMention' },
    draft: { icon: <FileEdit size={14} />, className: 'iconDraft' },
    system: { icon: <Bell size={14} />, className: 'iconSystem' },
    highlight: { icon: <Bell size={14} />, className: 'iconSystem' },
    forward: { icon: <MessageSquare size={14} />, className: 'iconPost' },
    identity: { icon: <Users size={14} />, className: 'iconInvite' },
    invite: { icon: <UserPlus size={14} />, className: 'iconInvite' },
    circle: { icon: <Users size={14} />, className: 'iconInvite' },
};

export default function NotificationPanel({
    open,
    notifications,
    onClose,
    onMarkAllRead,
    onNotificationClick,
}: NotificationPanelProps) {
    const t = useI18n('NotificationPanel');
    const unreadCount = notifications.filter((n) => !n.read).length;

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
                        className={styles.panel}
                        initial={{ opacity: 0, y: -8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.96 }}
                        transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className={styles.header}>
                            <span className={styles.title}>
                                {t('title')} {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
                            </span>
                            {unreadCount > 0 && onMarkAllRead && (
                                <button className={styles.markRead} onClick={onMarkAllRead}>
                                    {t('actions.markAllRead')}
                                </button>
                            )}
                        </div>

                        {/* List */}
                        <div className={styles.list}>
                            {notifications.length === 0 ? (
                                <div className={styles.empty}>
                                    <Bell size={32} className={styles.emptyIcon} />
                                    <p className={styles.emptyText}>{t('empty')}</p>
                                </div>
                            ) : (
                                notifications.map((n) => {
                                    const iconInfo = ICON_MAP[n.type] || ICON_MAP.system;
                                    return (
                                        <motion.div
                                            key={n.id}
                                            className={`${styles.item} ${!n.read ? styles.itemUnread : ''}`}
                                            onClick={() => onNotificationClick?.(n)}
                                            whileTap={{ y: 1 }}
                                        >
                                            <div className={`${styles.itemIcon} ${styles[iconInfo.className]}`}>
                                                {iconInfo.icon}
                                            </div>
                                            <div className={styles.itemBody}>
                                                <div className={styles.itemText}>{n.text}</div>
                                                <div className={styles.itemMeta}>
                                                    <span className={styles.itemTime}>{n.time}</span>
                                                    {n.circle && (
                                                        <span className={styles.itemCircle}>{n.circle}</span>
                                                    )}
                                                </div>
                                            </div>
                                            {!n.read && <div className={styles.unreadDot} />}
                                        </motion.div>
                                    );
                                })
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
