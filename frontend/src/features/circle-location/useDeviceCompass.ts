'use client';

import { useCallback, useEffect, useState } from 'react';

export type DeviceCompassStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported';

interface DeviceCompassState {
    headingDegrees: number | null;
    status: DeviceCompassStatus;
    requestCompass: () => Promise<void>;
}

type DeviceOrientationConstructorWithPermission = typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>;
};

type CompassOrientationEvent = DeviceOrientationEvent & {
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
};

export function useDeviceCompass(): DeviceCompassState {
    const [enabled, setEnabled] = useState(false);
    const [headingDegrees, setHeadingDegrees] = useState<number | null>(null);
    const [status, setStatus] = useState<DeviceCompassStatus>('idle');

    useEffect(() => {
        if (!supportsDeviceOrientation()) {
            setStatus('unsupported');
        }
    }, []);

    useEffect(() => {
        if (!enabled || !supportsDeviceOrientation()) return;

        const handleOrientation = (event: Event) => {
            const nextHeading = readCompassHeading(event as CompassOrientationEvent);
            if (nextHeading === null) return;
            setHeadingDegrees((current) => (
                current === null ? nextHeading : smoothHeading(current, nextHeading)
            ));
            setStatus('active');
        };

        window.addEventListener('deviceorientationabsolute', handleOrientation);
        window.addEventListener('deviceorientation', handleOrientation);

        return () => {
            window.removeEventListener('deviceorientationabsolute', handleOrientation);
            window.removeEventListener('deviceorientation', handleOrientation);
        };
    }, [enabled]);

    const requestCompass = useCallback(async () => {
        if (!supportsDeviceOrientation()) {
            setStatus('unsupported');
            return;
        }

        setStatus('requesting');
        const DeviceOrientation = window.DeviceOrientationEvent as DeviceOrientationConstructorWithPermission;
        if (typeof DeviceOrientation.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientation.requestPermission();
                if (permission !== 'granted') {
                    setStatus('denied');
                    return;
                }
            } catch {
                setStatus('denied');
                return;
            }
        }

        setEnabled(true);
        setStatus('active');
    }, []);

    return {
        headingDegrees,
        status,
        requestCompass,
    };
}

function supportsDeviceOrientation(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

function readCompassHeading(event: CompassOrientationEvent): number | null {
    if (Number.isFinite(event.webkitCompassHeading)) {
        return normalizeHeading(event.webkitCompassHeading ?? 0);
    }

    if (event.absolute === true && Number.isFinite(event.alpha)) {
        return normalizeHeading(360 - (event.alpha ?? 0));
    }

    return null;
}

function smoothHeading(current: number, next: number): number {
    const delta = ((next - current + 540) % 360) - 180;
    return normalizeHeading(current + delta * 0.24);
}

function normalizeHeading(value: number): number {
    return ((value % 360) + 360) % 360;
}
