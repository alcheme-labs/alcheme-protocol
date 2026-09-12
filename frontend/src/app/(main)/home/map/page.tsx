'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, MapPin, Radar, RefreshCw } from 'lucide-react';

import {
    fetchNearbyCircleLocations,
    type NearbyCircleLocationDto,
} from '@/lib/api/circleLocations';
import { useI18n } from '@/i18n/useI18n';
import CircleLocationPreviewSheet from '@/features/circle-location/CircleLocationPreviewSheet';
import ManualScanCenterControl from '@/features/circle-location/ManualScanCenterControl';
import MapBaseLayer from '@/features/circle-location/MapBaseLayer';
import PaperRadarMap from '@/features/circle-location/PaperRadarMap';
import { useForegroundLocation } from '@/features/circle-location/useForegroundLocation';
import { formatRadius } from '@/features/circle-location/locationFormatting';
import styles from './page.module.css';

type ScanStatus = 'idle' | 'scanning' | 'ready' | 'error';

const DEFAULT_SCAN_CENTER = {
    centerLat: 37.7749,
    centerLng: -122.4194,
    radiusMeters: 3000,
};

export default function HomeMapPage() {
    const t = useI18n('HomeMap');
    const foregroundLocation = useForegroundLocation();
    const [scanCenter, setScanCenter] = useState(DEFAULT_SCAN_CENTER);
    const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
    const [scanError, setScanError] = useState<string | null>(null);
    const [nearbyItems, setNearbyItems] = useState<NearbyCircleLocationDto[]>([]);
    const [selectedItem, setSelectedItem] = useState<NearbyCircleLocationDto | null>(null);
    const [manualFallbackVisible, setManualFallbackVisible] = useState(false);
    const [radarMapReady, setRadarMapReady] = useState(false);

    const handleManualScanCenterChange = useCallback((nextCenter: typeof DEFAULT_SCAN_CENTER) => {
        setScanCenter(nextCenter);
        setNearbyItems([]);
        setSelectedItem(null);
        setScanStatus('idle');
        setScanError(null);
    }, []);

    const scanNearby = useCallback(async (center: typeof DEFAULT_SCAN_CENTER) => {
        setScanStatus('scanning');
        setScanError(null);
        setSelectedItem(null);
        try {
            const result = await fetchNearbyCircleLocations({
                centerLat: center.centerLat,
                centerLng: center.centerLng,
                radiusMeters: center.radiusMeters,
                limit: 30,
            });
            setNearbyItems(result.items);
            setScanStatus('ready');
        } catch (error) {
            console.error('[HomeMapPage] nearby circle scan failed', error);
            setNearbyItems([]);
            setScanError(t('errors.scanFailed'));
            setScanStatus('error');
        }
    }, [t]);

    const handleScanCurrentLocation = async () => {
        const location = await foregroundLocation.requestForegroundLocation();
        if (location.status === 'ready' && location.centerLat !== null && location.centerLng !== null) {
            const center = {
                centerLat: location.centerLat,
                centerLng: location.centerLng,
                radiusMeters: scanCenter.radiusMeters,
            };
            setManualFallbackVisible(false);
            setScanCenter(center);
            await scanNearby(center);
            return;
        }

        setManualFallbackVisible(true);
        setNearbyItems([]);
        setScanStatus('idle');
        setScanError(
            location.status === 'denied'
                ? t('errors.locationDenied')
                : t('errors.locationUnavailable'),
        );
    };

    const handleManualScan = async () => {
        setManualFallbackVisible(true);
        await scanNearby(scanCenter);
    };

    const statusLabel = scanStatus === 'scanning'
        ? t('status.scanning')
        : scanStatus === 'ready'
            ? t('status.ready', { count: nearbyItems.length })
            : scanError || t('status.idle');

    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <header className={styles.header}>
                    <Link href="/home" className={styles.backLink} aria-label={t('actions.backAria')}>
                        <ArrowLeft size={17} />
                        <span>{t('actions.back')}</span>
                    </Link>
                    <div className={styles.titleBlock}>
                        <div className={styles.eyebrow}>
                            <Radar size={15} />
                            <span>{t('eyebrow')}</span>
                        </div>
                        <h1>{t('title')}</h1>
                        <p>{t('subtitle')}</p>
                    </div>
                </header>

                <section className={styles.mapStage}>
                    <MapBaseLayer statusLabel={statusLabel} statusHidden={!radarMapReady}>
                        <PaperRadarMap
                            originLat={scanCenter.centerLat}
                            originLng={scanCenter.centerLng}
                            radiusMeters={scanCenter.radiusMeters}
                            items={nearbyItems}
                            loading={scanStatus === 'scanning'}
                            selectedAnchorId={selectedItem?.anchorId ?? null}
                            onSelect={setSelectedItem}
                            onMapReadyChange={setRadarMapReady}
                        />
                    </MapBaseLayer>
                </section>

                <section className={styles.controls} aria-label={t('controls.aria')}>
                    <div className={styles.actionRow}>
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={handleScanCurrentLocation}
                            disabled={scanStatus === 'scanning' || foregroundLocation.status === 'requesting'}
                        >
                            {scanStatus === 'scanning' || foregroundLocation.status === 'requesting' ? (
                                <Loader2 size={16} className={styles.spin} />
                            ) : (
                                <MapPin size={16} />
                            )}
                            <span>{t('actions.scanCurrent')}</span>
                        </button>
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={handleManualScan}
                            disabled={scanStatus === 'scanning'}
                        >
                            <RefreshCw size={15} />
                            <span>{t('actions.scanManual')}</span>
                        </button>
                    </div>

                    <div className={styles.scanMeta}>
                        <span>{t('controls.radius', { radius: formatRadius(scanCenter.radiusMeters) })}</span>
                        <span>{t('controls.center', {
                            lat: scanCenter.centerLat.toFixed(4),
                            lng: scanCenter.centerLng.toFixed(4),
                        })}</span>
                    </div>

                    {(manualFallbackVisible || foregroundLocation.status === 'denied' || foregroundLocation.status === 'unavailable') && (
                        <ManualScanCenterControl
                            centerLat={scanCenter.centerLat}
                            centerLng={scanCenter.centerLng}
                            radiusMeters={scanCenter.radiusMeters}
                            disabled={scanStatus === 'scanning'}
                            onChange={handleManualScanCenterChange}
                        />
                    )}

                    {scanStatus === 'ready' && nearbyItems.length === 0 && (
                        <p className={styles.emptyState}>{t('empty')}</p>
                    )}
                    {scanError && (
                        <p className={styles.errorState}>{scanError}</p>
                    )}
                </section>
            </div>

            <CircleLocationPreviewSheet
                item={selectedItem}
                onClose={() => setSelectedItem(null)}
            />
        </main>
    );
}
