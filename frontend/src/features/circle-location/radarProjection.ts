const EARTH_RADIUS_METERS = 6371008.8;

export interface RadarProjectionInput {
    originLat: number;
    originLng: number;
    targetLat: number;
    targetLng: number;
    radiusMeters: number;
    viewportSize: number;
}

export interface RadarProjectionResult {
    x: number;
    y: number;
    distanceMeters: number;
    bearingDegrees: number;
    visible: boolean;
}

export function projectGeoPointToRadar(input: RadarProjectionInput): RadarProjectionResult {
    const distanceMeters = haversineDistanceMeters(
        input.originLat,
        input.originLng,
        input.targetLat,
        input.targetLng,
    );
    const bearingDegrees = bearingBetweenDegrees(
        input.originLat,
        input.originLng,
        input.targetLat,
        input.targetLng,
    );
    return projectBearingDistanceToRadar({
        bearingDegrees,
        distanceMeters,
        radiusMeters: input.radiusMeters,
        viewportSize: input.viewportSize,
    });
}

export function projectBearingDistanceToRadar(input: {
    bearingDegrees: number;
    distanceMeters: number;
    radiusMeters: number;
    viewportSize: number;
}): RadarProjectionResult {
    const viewportSize = Math.max(1, input.viewportSize);
    const center = viewportSize / 2;
    const maxRadius = viewportSize * 0.42;
    const radiusMeters = Math.max(1, input.radiusMeters);
    const distanceMeters = Math.max(0, input.distanceMeters);
    const distanceRatio = Math.min(1, distanceMeters / radiusMeters);
    const theta = normalizeBearingDegrees(input.bearingDegrees) * Math.PI / 180;
    const pointRadius = maxRadius * distanceRatio;
    return {
        x: center + Math.sin(theta) * pointRadius,
        y: center - Math.cos(theta) * pointRadius,
        distanceMeters,
        bearingDegrees: normalizeBearingDegrees(input.bearingDegrees),
        visible: distanceMeters <= radiusMeters,
    };
}

export function projectBearingDistanceToMap(input: {
    originLat: number;
    originLng: number;
    bearingDegrees: number;
    distanceMeters: number;
    radiusMeters: number;
    zoom: number;
    viewportSize: number;
}): RadarProjectionResult {
    const viewportSize = Math.max(1, input.viewportSize);
    const center = viewportSize / 2;
    const distanceMeters = Math.max(0, input.distanceMeters);
    const target = destinationPointFromBearingDistance({
        originLat: input.originLat,
        originLng: input.originLng,
        bearingDegrees: input.bearingDegrees,
        distanceMeters,
    });
    const originWorld = projectLonLatToWorldPixel(input.originLat, input.originLng, input.zoom);
    const targetWorld = projectLonLatToWorldPixel(target.lat, target.lng, input.zoom);
    const worldSize = 256 * (2 ** clampZoom(input.zoom));
    let deltaX = targetWorld.x - originWorld.x;
    if (Math.abs(deltaX) > worldSize / 2) {
        deltaX += deltaX > 0 ? -worldSize : worldSize;
    }
    const x = center + deltaX;
    const y = center + targetWorld.y - originWorld.y;
    const padding = viewportSize * 0.08;
    return {
        x,
        y,
        distanceMeters,
        bearingDegrees: normalizeBearingDegrees(input.bearingDegrees),
        visible: distanceMeters <= Math.max(1, input.radiusMeters)
            && x >= -padding
            && x <= viewportSize + padding
            && y >= -padding
            && y <= viewportSize + padding,
    };
}

export function projectLonLatToWorldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
    const normalizedZoom = clampZoom(zoom);
    const scale = 256 * (2 ** normalizedZoom);
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const safeLng = ((lng + 180) % 360 + 360) % 360 - 180;
    const sinLat = Math.sin(toRadians(safeLat));
    return {
        x: ((safeLng + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    };
}

export function unprojectWorldPixelToLonLat(x: number, y: number, zoom: number): { lat: number; lng: number } {
    const normalizedZoom = clampZoom(zoom);
    const scale = 256 * (2 ** normalizedZoom);
    const wrappedX = ((x % scale) + scale) % scale;
    const clampedY = Math.max(0, Math.min(scale, y));
    const lng = (wrappedX / scale) * 360 - 180;
    const mercatorY = Math.PI - (2 * Math.PI * clampedY) / scale;
    const lat = Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI;
    return { lat, lng };
}

export function destinationPointFromBearingDistance(input: {
    originLat: number;
    originLng: number;
    bearingDegrees: number;
    distanceMeters: number;
}): { lat: number; lng: number } {
    const angularDistance = Math.max(0, input.distanceMeters) / EARTH_RADIUS_METERS;
    const bearing = toRadians(normalizeBearingDegrees(input.bearingDegrees));
    const originLat = toRadians(input.originLat);
    const originLng = toRadians(input.originLng);
    const targetLat = Math.asin(
        Math.sin(originLat) * Math.cos(angularDistance)
        + Math.cos(originLat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const targetLng = originLng + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(originLat),
        Math.cos(angularDistance) - Math.sin(originLat) * Math.sin(targetLat),
    );
    return {
        lat: targetLat * 180 / Math.PI,
        lng: ((targetLng * 180 / Math.PI + 540) % 360) - 180,
    };
}

function haversineDistanceMeters(
    originLat: number,
    originLng: number,
    targetLat: number,
    targetLng: number,
): number {
    const lat1 = toRadians(originLat);
    const lat2 = toRadians(targetLat);
    const deltaLat = toRadians(targetLat - originLat);
    const deltaLng = toRadians(targetLng - originLng);
    const a = Math.sin(deltaLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}

function bearingBetweenDegrees(
    originLat: number,
    originLng: number,
    targetLat: number,
    targetLng: number,
): number {
    const lat1 = toRadians(originLat);
    const lat2 = toRadians(targetLat);
    const deltaLng = toRadians(targetLng - originLng);
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return normalizeBearingDegrees(Math.atan2(y, x) * 180 / Math.PI);
}

function normalizeBearingDegrees(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return ((value % 360) + 360) % 360;
}

function clampZoom(value: number): number {
    if (!Number.isFinite(value)) return 14;
    return Math.max(0, Math.min(22, Math.round(value)));
}

function toRadians(value: number): number {
    return value * Math.PI / 180;
}
