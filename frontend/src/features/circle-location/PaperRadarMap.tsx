'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type TouchEvent, type WheelEvent } from 'react';
import { Compass, Minus, Plus } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { NearbyCircleLocationDto } from '@/lib/api/circleLocations';
import {
    projectBearingDistanceToMap,
    projectGeoPointToRadar,
} from './radarProjection';
import RealMapTileLayer from './RealMapTileLayer';
import { formatRadius } from './locationFormatting';
import styles from './PaperRadarMap.module.css';
import { useDeviceCompass } from './useDeviceCompass';

interface PaperRadarMapProps {
    originLat: number;
    originLng: number;
    radiusMeters: number;
    items: NearbyCircleLocationDto[];
    loading?: boolean;
    selectedAnchorId?: string | null;
    onSelect: (item: NearbyCircleLocationDto) => void;
    onMapReadyChange?: (ready: boolean) => void;
}

const VIEWPORT_SIZE = 320;
const WORLD_VIEWPORT_SIZE = 456;
const MIN_MAP_ZOOM = 10;
const MAX_MAP_ZOOM = 17;

export default function PaperRadarMap({
    originLat,
    originLng,
    radiusMeters,
    items,
    loading = false,
    selectedAnchorId = null,
    onSelect,
    onMapReadyChange,
}: PaperRadarMapProps) {
    const t = useI18n('HomeMap');
    const [mapZoom, setMapZoom] = useState(() => deriveMapZoom(radiusMeters));
    const [mapReady, setMapReady] = useState(false);
    const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
    const compass = useDeviceCompass();
    const compassHeading = compass.headingDegrees ?? 0;
    const radarStyle = {
        '--compass-heading': `${compassHeading}deg`,
        '--radar-bearing': `${-compassHeading}deg`,
        '--radar-world-scale': `${WORLD_VIEWPORT_SIZE / VIEWPORT_SIZE}`,
    } as CSSProperties;
    const originProjection = projectGeoPointToRadar({
        originLat,
        originLng,
        targetLat: originLat,
        targetLng: originLng,
        radiusMeters,
        viewportSize: VIEWPORT_SIZE,
    });
    const adjustZoom = useCallback((delta: number) => {
        setMapZoom((current) => clampMapZoom(current + delta));
    }, []);
    const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        adjustZoom(event.deltaY < 0 ? 1 : -1);
    }, [adjustZoom]);
    const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 2) {
            pinchRef.current = null;
            return;
        }
        pinchRef.current = {
            distance: touchDistance(event),
            zoom: mapZoom,
        };
    }, [mapZoom]);
    const handleTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
        if (event.touches.length !== 2 || !pinchRef.current) return;
        event.preventDefault();
        const nextDistance = touchDistance(event);
        if (nextDistance <= 0 || pinchRef.current.distance <= 0) return;
        const zoomDelta = Math.log2(nextDistance / pinchRef.current.distance) * 1.4;
        setMapZoom(clampMapZoom(Math.round(pinchRef.current.zoom + zoomDelta)));
    }, []);
    const handleTouchEnd = useCallback(() => {
        pinchRef.current = null;
    }, []);

    useEffect(() => {
        setMapZoom(deriveMapZoom(radiusMeters));
    }, [originLat, originLng, radiusMeters]);

    useEffect(() => {
        onMapReadyChange?.(mapReady);
    }, [mapReady, onMapReadyChange]);

    return (
        <div
            className={styles.radar}
            style={radarStyle}
            aria-label={t('radar.aria', { radius: formatRadius(radiusMeters) })}
            onWheel={handleWheel}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <div className={styles.radarWorld}>
                <RealMapTileLayer
                    centerLat={originLat}
                    centerLng={originLng}
                    zoom={mapZoom}
                    viewportSize={WORLD_VIEWPORT_SIZE}
                    onTileLoadStateChange={setMapReady}
                />
                <div className={styles.grid} />
                <div className={styles.radarFace}>
                    <div className={styles.rings}>
                        <span />
                        <span />
                        <span />
                    </div>
                    <div className={styles.scanBeam} data-loading={loading ? 'true' : 'false'} />

                    {items.map((item) => {
                        const projection = projectBearingDistanceToMap({
                            originLat,
                            originLng,
                            bearingDegrees: item.bearingDegrees,
                            distanceMeters: item.distanceMeters,
                            radiusMeters,
                            zoom: mapZoom,
                            viewportSize: VIEWPORT_SIZE,
                        });
                        if (!projection.visible) return null;
                        return (
                            <button
                                key={item.anchorId}
                                type="button"
                                className={`${styles.circleDot} ${selectedAnchorId === item.anchorId ? styles.circleDotSelected : ''}`}
                                style={{
                                    left: `${(projection.x / VIEWPORT_SIZE) * 100}%`,
                                    top: `${(projection.y / VIEWPORT_SIZE) * 100}%`,
                                }}
                                onClick={() => onSelect(item)}
                                aria-label={t('radar.circleAria', {
                                    circleName: item.circleName,
                                    distance: formatRadius(item.distanceMeters),
                                })}
                            >
                                <span />
                            </button>
                        );
                    })}

                    <div className={`${styles.direction} ${styles.directionNorth}`}><span>N</span></div>
                    <div className={`${styles.direction} ${styles.directionEast}`}><span>E</span></div>
                    <div className={`${styles.direction} ${styles.directionSouth}`}><span>S</span></div>
                    <div className={`${styles.direction} ${styles.directionWest}`}><span>W</span></div>
                </div>
            </div>
            <div
                className={styles.bootSignal}
                data-ready={mapReady ? 'true' : 'false'}
                aria-hidden="true"
            >
                <svg viewBox="0 0 320 180" role="presentation" focusable="false">
                    <path
                        className={styles.bootSignalBaseline}
                        d="M22 88H298"
                    />
                    <path
                        className={styles.bootSignalWave}
                        d="M22 90H58L64 78L71 101L78 64L86 116L94 88H126L132 82L138 96L145 70L153 108L161 88H205L212 83L218 94L226 76L233 104L241 88H298"
                    />
                    <path
                        className={styles.bootSignalEcho}
                        d="M40 116H96L102 112L108 120L116 104L124 130L132 116H188L196 112L204 121L212 108L220 126L228 116H280"
                    />
                </svg>
            </div>
            <div
                className={styles.userArrow}
                style={{
                    left: `${(originProjection.x / VIEWPORT_SIZE) * 100}%`,
                    top: `${(originProjection.y / VIEWPORT_SIZE) * 100}%`,
                }}
                aria-hidden="true"
            >
                <span />
            </div>
            {mapReady && (
                <>
                    <div className={styles.zoomControls} aria-label={t('radar.zoomControls')}>
                        <button
                            type="button"
                            aria-label={t('radar.zoomIn')}
                            onClick={() => adjustZoom(1)}
                            disabled={mapZoom >= MAX_MAP_ZOOM}
                        >
                            <Plus size={14} />
                        </button>
                        <span>{t('radar.zoomLevel', { zoom: mapZoom })}</span>
                        <button
                            type="button"
                            aria-label={t('radar.zoomOut')}
                            onClick={() => adjustZoom(-1)}
                            disabled={mapZoom <= MIN_MAP_ZOOM}
                        >
                            <Minus size={14} />
                        </button>
                        <button
                            type="button"
                            className={styles.compassButton}
                            aria-label={t(`radar.compass.${compass.status}`)}
                            title={t(`radar.compass.${compass.status}`)}
                            onClick={compass.requestCompass}
                            disabled={compass.status === 'unsupported' || compass.status === 'requesting'}
                            data-state={compass.status}
                        >
                            <Compass size={14} />
                        </button>
                    </div>
                    <a
                        className={styles.mapAttribution}
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noreferrer"
                    >
                        {t('radar.attribution')}
                    </a>
                </>
            )}
        </div>
    );
}

function deriveMapZoom(radiusMeters: number): number {
    if (radiusMeters <= 1000) return 15;
    if (radiusMeters <= 3000) return 14;
    if (radiusMeters <= 8000) return 13;
    if (radiusMeters <= 20000) return 12;
    return 10;
}

function clampMapZoom(value: number): number {
    return Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, value));
}

function touchDistance(event: TouchEvent<HTMLDivElement>): number {
    const first = event.touches.item(0);
    const second = event.touches.item(1);
    if (!first || !second) return 0;
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}
