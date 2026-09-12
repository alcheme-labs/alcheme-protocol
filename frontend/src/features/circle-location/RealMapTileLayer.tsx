'use client';

import { useEffect, useMemo, useState } from 'react';

import { projectLonLatToWorldPixel } from './radarProjection';
import styles from './PaperRadarMap.module.css';

interface RealMapTileLayerProps {
    centerLat: number;
    centerLng: number;
    zoom: number;
    viewportSize: number;
    viewportWidth?: number;
    viewportHeight?: number;
    onTileLoadStateChange?: (ready: boolean) => void;
}

const TILE_SIZE = 256;
const TILE_RANGE = [-2, -1, 0, 1, 2] as const;
const TILE_LOAD_TIMEOUT_MS = 3500;
const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function RealMapTileLayer({
    centerLat,
    centerLng,
    zoom,
    viewportSize,
    viewportWidth,
    viewportHeight,
    onTileLoadStateChange,
}: RealMapTileLayerProps) {
    const width = Math.max(1, viewportWidth ?? viewportSize);
    const height = Math.max(1, viewportHeight ?? viewportSize);
    const normalizedZoom = normalizeTileZoom(zoom);
    const tileCount = 2 ** normalizedZoom;
    const centerWorld = projectLonLatToWorldPixel(centerLat, centerLng, normalizedZoom);
    const centerTileX = Math.floor(centerWorld.x / TILE_SIZE);
    const centerTileY = Math.floor(centerWorld.y / TILE_SIZE);
    const tiles = useMemo(() => TILE_RANGE.flatMap((offsetY) =>
        TILE_RANGE.map((offsetX) => {
            const rawX = centerTileX + offsetX;
            const rawY = centerTileY + offsetY;
            const tileX = wrapTileX(rawX, tileCount);
            const tileY = Math.max(0, Math.min(tileCount - 1, rawY));
            const left = ((rawX * TILE_SIZE - centerWorld.x + width / 2) / width) * 100;
            const top = ((rawY * TILE_SIZE - centerWorld.y + height / 2) / height) * 100;
            return {
                key: `${normalizedZoom}-${rawX}-${rawY}`,
                src: buildTileUrl(normalizedZoom, tileX, tileY),
                left,
                top,
                hidden: rawY < 0 || rawY >= tileCount,
            };
        }),
    ), [centerTileX, centerTileY, centerWorld.x, centerWorld.y, height, normalizedZoom, tileCount, width]);
    const visibleTileKeys = useMemo(() => tiles
        .filter((tile) => !tile.hidden)
        .map((tile) => tile.key), [tiles]);
    const visibleTileSignature = visibleTileKeys.join('|');
    const [completedTileKeys, setCompletedTileKeys] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        setCompletedTileKeys(new Set());
        onTileLoadStateChange?.(false);
        const timeout = window.setTimeout(() => {
            onTileLoadStateChange?.(true);
        }, TILE_LOAD_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    }, [onTileLoadStateChange, visibleTileSignature]);

    useEffect(() => {
        if (visibleTileKeys.length === 0) {
            onTileLoadStateChange?.(true);
            return;
        }
        if (completedTileKeys.size >= visibleTileKeys.length) {
            onTileLoadStateChange?.(true);
        }
    }, [completedTileKeys, onTileLoadStateChange, visibleTileKeys.length]);

    const markTileComplete = (key: string) => {
        setCompletedTileKeys((current) => {
            if (current.has(key)) return current;
            const next = new Set(current);
            next.add(key);
            return next;
        });
    };

    return (
        <div className={styles.realMapLayer} aria-hidden="true">
            {tiles.map((tile) => tile.hidden ? null : (
                <img
                    key={tile.key}
                    className={styles.realMapTile}
                    src={tile.src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    referrerPolicy="no-referrer-when-downgrade"
                    onLoad={() => markTileComplete(tile.key)}
                    onError={() => markTileComplete(tile.key)}
                    style={{
                        left: `${tile.left}%`,
                        top: `${tile.top}%`,
                        width: `${(TILE_SIZE / width) * 100}%`,
                        height: `${(TILE_SIZE / height) * 100}%`,
                    }}
                />
            ))}
        </div>
    );
}

function buildTileUrl(zoom: number, x: number, y: number): string {
    return TILE_URL_TEMPLATE
        .replace('{z}', String(zoom))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
}

function normalizeTileZoom(value: number): number {
    if (!Number.isFinite(value)) return 14;
    return Math.max(3, Math.min(18, Math.round(value)));
}

function wrapTileX(value: number, tileCount: number): number {
    return ((value % tileCount) + tileCount) % tileCount;
}
