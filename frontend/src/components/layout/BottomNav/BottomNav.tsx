'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@apollo/client/react';
import { Home, Compass, User, Bell, PenSquare } from 'lucide-react';
import { GET_NOTIFICATIONS } from '@/lib/apollo/queries';
import type { NotificationsResponse } from '@/lib/apollo/types';
import { useI18n } from '@/i18n/useI18n';
import styles from './BottomNav.module.css';

const NAV_ITEMS = [
    { href: '/home', key: 'home', icon: Home },
    { href: '/circles', key: 'circles', icon: Compass },
    { href: '/compose', key: 'compose', icon: PenSquare, isFab: true },
    { href: '/notifications', key: 'notifications', icon: Bell },
    { href: '/profile', key: 'profile', icon: User },
] as const;

export default function BottomNav() {
    const pathname = usePathname();
    const t = useI18n('BottomNav');

    // Fetch unread notification count (uses cache-and-network for freshness)
    const { data: notifData } = useQuery<NotificationsResponse>(GET_NOTIFICATIONS, {
        variables: { limit: 50, offset: 0 },
        fetchPolicy: 'cache-and-network',
    });
    const unreadCount = notifData?.myNotifications?.filter(n => !n.read).length ?? 0;

    // Hide BottomNav on circle detail pages for immersive experience
    const isCircleDetail = /^\/circles\/[^/]+$/.test(pathname ?? '');
    if (isCircleDetail) return null;

    return (
        <nav className={styles.nav} role="navigation" aria-label={t('ariaLabel')}>
            <div className={styles.inner}>
                {NAV_ITEMS.map(({ href, key, icon: Icon, ...rest }) => {
                    const label = t(`items.${key}`);
                    const isActive = pathname?.startsWith(href);
                    const isFab = 'isFab' in rest && rest.isFab;
                    const badge = href === '/notifications' ? unreadCount : 0;

                    if (isFab) {
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={styles.fab}
                                aria-label={label}
                            >
                                <Icon size={20} strokeWidth={2} />
                            </Link>
                        );
                    }

                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`${styles.item} ${isActive ? styles.active : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                        >
                            <div className={styles.iconWrap}>
                                <Icon
                                    size={22}
                                    strokeWidth={isActive ? 2 : 1.5}
                                    className={styles.icon}
                                />
                                {badge > 0 && (
                                    <span className={styles.badge}>{badge}</span>
                                )}
                            </div>
                            <span className={styles.label}>{label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
