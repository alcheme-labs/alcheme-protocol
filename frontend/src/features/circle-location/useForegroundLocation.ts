'use client';

import { useCallback, useState } from 'react';

export type ForegroundLocationStatus =
    | 'idle'
    | 'requesting'
    | 'ready'
    | 'denied'
    | 'unavailable'
    | 'failed';

export interface ForegroundLocationState {
    status: ForegroundLocationStatus;
    centerLat: number | null;
    centerLng: number | null;
    error: string | null;
}

const initialState: ForegroundLocationState = {
    status: 'idle',
    centerLat: null,
    centerLng: null,
    error: null,
};

export function useForegroundLocation() {
    const [state, setState] = useState<ForegroundLocationState>(initialState);

    const requestForegroundLocation = useCallback(async (): Promise<ForegroundLocationState> => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            const next = {
                status: 'unavailable' as const,
                centerLat: null,
                centerLng: null,
                error: 'geolocation_unavailable',
            };
            setState(next);
            return next;
        }

        setState((current) => ({
            ...current,
            status: 'requesting',
            error: null,
        }));

        try {
            const position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    maximumAge: 60_000,
                    timeout: 12_000,
                });
            });
            const next = {
                status: 'ready' as const,
                centerLat: Number(position.coords.latitude.toFixed(6)),
                centerLng: Number(position.coords.longitude.toFixed(6)),
                error: null,
            };
            setState(next);
            return next;
        } catch (error) {
            const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0;
            const next = {
                status: code === 1 ? 'denied' as const : 'failed' as const,
                centerLat: null,
                centerLng: null,
                error: code === 1 ? 'geolocation_denied' : 'geolocation_failed',
            };
            setState(next);
            return next;
        }
    }, []);

    return {
        ...state,
        requestForegroundLocation,
    };
}
