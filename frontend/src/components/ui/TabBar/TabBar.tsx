'use client';

import { type ReactNode } from 'react';
import styles from './TabBar.module.css';
import { resolveTabBarActiveIndex } from '@/lib/circle/chromeTabs';

interface Tab {
    id: string;
    label: string;
    icon?: ReactNode;
}

interface TabBarProps {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (id: string) => void;
    className?: string;
}

const TAB_INDICATOR_INSET_PX = 2;
const TAB_INDICATOR_GAP_PX = 2;

export default function TabBar({ tabs, activeTab, onTabChange, className = '' }: TabBarProps) {
    const activeIndex = resolveTabBarActiveIndex(tabs.map((t) => t.id), activeTab);
    const indicatorReservedPx = (TAB_INDICATOR_INSET_PX * 2) + (TAB_INDICATOR_GAP_PX * Math.max(0, tabs.length - 1));
    const indicatorHidden = activeIndex < 0;

    return (
        <div className={`${styles.tabBar} ${className}`} role="tablist">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`${styles.tab} ${activeTab === tab.id ? styles.active : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    {tab.icon && <span className={styles.icon}>{tab.icon}</span>}
                    <span className={styles.label}>{tab.label}</span>
                </button>
            ))}
            <div
                className={styles.indicator}
                style={{
                    width: `calc((100% - ${indicatorReservedPx}px) / ${tabs.length})`,
                    transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * TAB_INDICATOR_GAP_PX}px))`,
                    opacity: indicatorHidden ? 0 : 1,
                }}
            />
        </div>
    );
}
