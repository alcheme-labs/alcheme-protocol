'use client';

import styles from './Skeleton.module.css';

interface SkeletonProps {
    width?: string | number;
    height?: string | number;
    borderRadius?: string;
    className?: string;
}

export default function Skeleton({
    width = '100%',
    height = 20,
    borderRadius,
    className = '',
}: SkeletonProps) {
    return (
        <div
            className={`${styles.skeleton} ${className}`}
            style={{
                width: typeof width === 'number' ? `${width}px` : width,
                height: typeof height === 'number' ? `${height}px` : height,
                borderRadius: borderRadius || 'var(--radius-sm)',
            }}
        />
    );
}
