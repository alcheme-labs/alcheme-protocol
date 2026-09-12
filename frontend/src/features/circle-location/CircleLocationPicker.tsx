'use client';

import { useEffect, useMemo, useState } from 'react';
import { LocateFixed, MapPin, Navigation } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type {
    CircleGeoAnchorDraft,
    CircleGeoAnchorVisibility,
} from './types';
import { formatCoordinate, formatRadius } from './locationFormatting';
import styles from './CircleLocationPicker.module.css';

const RADIUS_PRESETS = [50, 120, 300, 800] as const;
const VISIBILITY_OPTIONS: CircleGeoAnchorVisibility[] = [
    'public_discovery',
    'members_only',
    'managers_only',
];

interface CircleLocationPickerProps {
    value: CircleGeoAnchorDraft | null;
    disabled?: boolean;
    onChange: (next: CircleGeoAnchorDraft) => void;
    onLocationError?: (message: string) => void;
}

function parseInputNumber(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clampRadius(value: number): number {
    return Math.max(25, Math.min(3000, Math.floor(value)));
}

function buildFallbackDraft(t: ReturnType<typeof useI18n>): CircleGeoAnchorDraft {
    return {
        label: t('defaultLabel'),
        centerLat: 0,
        centerLng: 0,
        radiusMeters: 120,
        visibility: 'public_discovery',
    };
}

export default function CircleLocationPicker({
    value,
    disabled = false,
    onChange,
    onLocationError,
}: CircleLocationPickerProps) {
    const t = useI18n('CircleLocation');
    const [locating, setLocating] = useState(false);
    const [latText, setLatText] = useState(value ? formatCoordinate(value.centerLat) : '');
    const [lngText, setLngText] = useState(value ? formatCoordinate(value.centerLng) : '');
    const [radiusText, setRadiusText] = useState(value ? String(value.radiusMeters) : '120');

    useEffect(() => {
        setLatText(value ? formatCoordinate(value.centerLat) : '');
        setLngText(value ? formatCoordinate(value.centerLng) : '');
        setRadiusText(value ? String(value.radiusMeters) : '120');
    }, [value?.centerLat, value?.centerLng, value?.radiusMeters]);

    const draft = value ?? buildFallbackDraft(t);
    const markerStyle = useMemo(() => ({
        left: `${50 + Math.max(-24, Math.min(24, draft.centerLng / 7.5))}%`,
        top: `${50 - Math.max(-24, Math.min(24, draft.centerLat / 3.75))}%`,
    }), [draft.centerLat, draft.centerLng]);

    const commit = (patch: Partial<CircleGeoAnchorDraft>) => {
        if (disabled) return;
        onChange({
            ...draft,
            ...patch,
        });
    };

    const commitCoordinate = (field: 'centerLat' | 'centerLng', text: string) => {
        if (field === 'centerLat') setLatText(text);
        if (field === 'centerLng') setLngText(text);
        const parsed = parseInputNumber(text);
        if (parsed === null) return;
        if (field === 'centerLat' && (parsed < -90 || parsed > 90)) return;
        if (field === 'centerLng' && (parsed < -180 || parsed > 180)) return;
        commit({ [field]: Number(parsed.toFixed(6)) });
    };

    const commitRadius = (text: string) => {
        setRadiusText(text);
        const parsed = parseInputNumber(text);
        if (parsed === null) return;
        commit({ radiusMeters: clampRadius(parsed) });
    };

    const useCurrentLocation = async () => {
        if (disabled || typeof navigator === 'undefined' || !navigator.geolocation) {
            onLocationError?.(t('errors.geolocationUnavailable'));
            return;
        }
        setLocating(true);
        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    maximumAge: 60_000,
                    timeout: 12_000,
                });
            });
            const nextLat = Number(position.coords.latitude.toFixed(6));
            const nextLng = Number(position.coords.longitude.toFixed(6));
            onChange({
                ...draft,
                label: draft.label || t('defaultLabel'),
                centerLat: nextLat,
                centerLng: nextLng,
            });
            setLatText(formatCoordinate(nextLat));
            setLngText(formatCoordinate(nextLng));
        } catch (error) {
            const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0;
            onLocationError?.(code === 1 ? t('errors.geolocationDenied') : t('errors.geolocationFailed'));
        } finally {
            setLocating(false);
        }
    };

    return (
        <div className={styles.picker}>
            <div className={styles.radarPreview} aria-hidden="true">
                <div className={styles.grid} />
                <div className={styles.scan} />
                <div className={styles.rangeRing} />
                <Navigation className={styles.redArrow} size={20} />
                <span className={styles.marker} style={markerStyle} />
            </div>

            <button
                type="button"
                className={styles.locateButton}
                onClick={useCurrentLocation}
                disabled={disabled || locating}
            >
                <LocateFixed size={15} />
                <span>{locating ? t('locating') : t('useCurrentLocation')}</span>
            </button>

            <label className={styles.field}>
                <span>{t('label')}</span>
                <input
                    value={draft.label}
                    placeholder={t('labelPlaceholder')}
                    maxLength={128}
                    disabled={disabled}
                    onChange={(event) => commit({ label: event.target.value })}
                />
            </label>

            <div className={styles.coordinateGrid}>
                <label className={styles.field}>
                    <span>{t('latitude')}</span>
                    <input
                        inputMode="decimal"
                        value={latText}
                        placeholder="37.774900"
                        disabled={disabled}
                        onChange={(event) => commitCoordinate('centerLat', event.target.value)}
                    />
                </label>
                <label className={styles.field}>
                    <span>{t('longitude')}</span>
                    <input
                        inputMode="decimal"
                        value={lngText}
                        placeholder="-122.419400"
                        disabled={disabled}
                        onChange={(event) => commitCoordinate('centerLng', event.target.value)}
                    />
                </label>
            </div>

            <div className={styles.radiusBlock}>
                <div className={styles.inlineHeader}>
                    <span>{t('radius')}</span>
                    <strong>{formatRadius(draft.radiusMeters)}</strong>
                </div>
                <div className={styles.radiusPresets}>
                    {RADIUS_PRESETS.map((radius) => (
                        <button
                            key={radius}
                            type="button"
                            className={`${styles.radiusPreset} ${draft.radiusMeters === radius ? styles.radiusPresetActive : ''}`}
                            onClick={() => {
                                setRadiusText(String(radius));
                                commit({ radiusMeters: radius });
                            }}
                            disabled={disabled}
                        >
                            {formatRadius(radius)}
                        </button>
                    ))}
                </div>
                <label className={styles.field}>
                    <span>{t('customRadius')}</span>
                    <input
                        type="number"
                        min={25}
                        max={3000}
                        step={1}
                        value={radiusText}
                        disabled={disabled}
                        onChange={(event) => commitRadius(event.target.value)}
                    />
                </label>
            </div>

            <div className={styles.visibilityBlock}>
                <div className={styles.inlineHeader}>
                    <span>{t('visibility')}</span>
                    <MapPin size={14} />
                </div>
                <div className={styles.visibilityOptions}>
                    {VISIBILITY_OPTIONS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            className={`${styles.visibilityOption} ${draft.visibility === option ? styles.visibilityOptionActive : ''}`}
                            onClick={() => commit({ visibility: option })}
                            disabled={disabled}
                        >
                            {t(`visibilityOptions.${option}`)}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
