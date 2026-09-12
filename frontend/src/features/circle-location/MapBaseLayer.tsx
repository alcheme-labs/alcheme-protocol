'use client';

import type { ReactNode } from 'react';

import styles from './MapBaseLayer.module.css';

interface MapBaseLayerProps {
    children: ReactNode;
    statusLabel?: string;
    statusHidden?: boolean;
}

export default function MapBaseLayer({
    children,
    statusLabel,
    statusHidden = false,
}: MapBaseLayerProps) {
    return (
        <div className={styles.baseLayer}>
            <div className={styles.paperTexture} />
            <div className={styles.einkPanel}>
                {children}
            </div>
            {statusLabel && !statusHidden && (
                <div className={styles.statusLabel}>{statusLabel}</div>
            )}
        </div>
    );
}
