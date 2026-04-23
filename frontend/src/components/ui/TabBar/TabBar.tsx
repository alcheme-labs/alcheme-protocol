'use client';

import { type ReactNode } from 'react';
import styles from './TabBar.module.css';

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

export default function TabBar({ tabs, activeTab, onTabChange, className = '' }: TabBarProps) {
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
                    width: `${100 / tabs.length}%`,
                    transform: `translateX(${tabs.findIndex((t) => t.id === activeTab) * 100}%)`,
                }}
            />
        </div>
    );
}
