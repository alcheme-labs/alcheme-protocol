'use client';

import { useRef, type PointerEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import { formatRadius } from './locationFormatting';
import {
    projectLonLatToWorldPixel,
    unprojectWorldPixelToLonLat,
} from './radarProjection';
import RealMapTileLayer from './RealMapTileLayer';
import styles from './ManualScanCenterControl.module.css';

const RADIUS_OPTIONS = [500, 1000, 3000, 8000, 20000, 50000] as const;
const MANUAL_MAP_VIEWPORT_WIDTH = 360;
const MANUAL_MAP_VIEWPORT_HEIGHT = 180;

interface ManualScanCenterControlProps {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    disabled?: boolean;
    onChange: (next: {
        centerLat: number;
        centerLng: number;
        radiusMeters: number;
    }) => void;
}

function parseNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export default function ManualScanCenterControl({
    centerLat,
    centerLng,
    radiusMeters,
    disabled = false,
    onChange,
}: ManualScanCenterControlProps) {
    const t = useI18n('HomeMap');
    const mapRef = useRef<HTMLDivElement | null>(null);
    const mapZoom = deriveManualMapZoom(radiusMeters);

    const commit = (patch: Partial<{
        centerLat: number;
        centerLng: number;
        radiusMeters: number;
    }>) => {
        onChange({
            centerLat,
            centerLng,
            radiusMeters,
            ...patch,
        });
    };
    const commitFromPointer = (event: PointerEvent<HTMLDivElement>) => {
        if (disabled || !mapRef.current) return;
        const rect = mapRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
        const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
        const centerWorld = projectLonLatToWorldPixel(centerLat, centerLng, mapZoom);
        const targetWorld = {
            x: centerWorld.x + (x / rect.width - 0.5) * MANUAL_MAP_VIEWPORT_WIDTH,
            y: centerWorld.y + (y / rect.height - 0.5) * MANUAL_MAP_VIEWPORT_HEIGHT,
        };
        const target = unprojectWorldPixelToLonLat(targetWorld.x, targetWorld.y, mapZoom);
        commit({
            centerLat: Number(target.lat.toFixed(4)),
            centerLng: Number(target.lng.toFixed(4)),
        });
    };

    return (
        <div className={styles.control}>
            <div className={styles.header}>
                <SlidersHorizontal size={15} />
                <span>{t('manual.title')}</span>
            </div>
            <div
                ref={mapRef}
                className={styles.manualMap}
                role="application"
                aria-label={t('manual.mapAria')}
                onPointerDown={(event) => {
                    commitFromPointer(event);
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    if (event.buttons !== 1) return;
                    commitFromPointer(event);
                }}
            >
                <RealMapTileLayer
                    centerLat={centerLat}
                    centerLng={centerLng}
                    zoom={mapZoom}
                    viewportSize={MANUAL_MAP_VIEWPORT_WIDTH}
                    viewportWidth={MANUAL_MAP_VIEWPORT_WIDTH}
                    viewportHeight={MANUAL_MAP_VIEWPORT_HEIGHT}
                />
                <span className={styles.manualMarker} />
            </div>
            <div className={styles.fields}>
                <label>
                    <span>{t('manual.latitude')}</span>
                    <input
                        inputMode="decimal"
                        value={centerLat.toFixed(4)}
                        disabled={disabled}
                        onChange={(event) => {
                            const next = Math.max(-90, Math.min(90, parseNumber(event.target.value, centerLat)));
                            commit({ centerLat: next });
                        }}
                    />
                </label>
                <label>
                    <span>{t('manual.longitude')}</span>
                    <input
                        inputMode="decimal"
                        value={centerLng.toFixed(4)}
                        disabled={disabled}
                        onChange={(event) => {
                            const next = Math.max(-180, Math.min(180, parseNumber(event.target.value, centerLng)));
                            commit({ centerLng: next });
                        }}
                    />
                </label>
            </div>
            <div className={styles.radiusHeader}>
                <span>{t('manual.radius')}</span>
                <strong>{formatRadius(radiusMeters)}</strong>
            </div>
            <input
                className={styles.radiusSlider}
                type="range"
                min={0}
                max={RADIUS_OPTIONS.length - 1}
                step={1}
                value={Math.max(0, RADIUS_OPTIONS.findIndex((value) => value === radiusMeters))}
                disabled={disabled}
                onChange={(event) => {
                    const index = Math.max(0, Math.min(RADIUS_OPTIONS.length - 1, Number(event.target.value)));
                    commit({ radiusMeters: RADIUS_OPTIONS[index] });
                }}
            />
            <div className={styles.radiusOptions}>
                {RADIUS_OPTIONS.map((value) => (
                    <button
                        key={value}
                        type="button"
                        className={radiusMeters === value ? styles.radiusActive : ''}
                        disabled={disabled}
                        onClick={() => commit({ radiusMeters: value })}
                    >
                        {formatRadius(value)}
                    </button>
                ))}
            </div>
        </div>
    );
}

function deriveManualMapZoom(radiusMeters: number): number {
    if (radiusMeters <= 1000) return 15;
    if (radiusMeters <= 3000) return 14;
    if (radiusMeters <= 8000) return 13;
    if (radiusMeters <= 20000) return 12;
    return 10;
}
