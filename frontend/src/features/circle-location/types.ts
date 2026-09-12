import type {
    CircleGeoAnchorDto,
    CircleGeoAnchorInput,
    CircleGeoAnchorVisibility,
} from '@/lib/api/circleLocations';

export type {
    CircleGeoAnchorDto,
    CircleGeoAnchorInput,
    CircleGeoAnchorVisibility,
};

export interface CircleGeoAnchorDraft extends CircleGeoAnchorInput {}

export interface CircleLocationSaveResult {
    status: 'executed' | 'requires_governance';
    requestId?: string | null;
}
