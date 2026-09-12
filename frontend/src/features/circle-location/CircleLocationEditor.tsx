'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin, Save, ShieldCheck, Trash2 } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import CircleLocationPicker from './CircleLocationPicker';
import {
    formatAnchorUpdatedAt,
    formatCoordinate,
    formatRadius,
} from './locationFormatting';
import type {
    CircleGeoAnchorDraft,
    CircleGeoAnchorDto,
    CircleLocationSaveResult,
} from './types';
import styles from './CircleLocationEditor.module.css';

interface CircleLocationEditorProps {
    anchor: CircleGeoAnchorDto | null;
    loading?: boolean;
    saving?: boolean;
    error?: string | null;
    governanceRequestId?: string | null;
    editable?: boolean;
    onSave?: (input: CircleGeoAnchorDraft) => Promise<CircleLocationSaveResult | void> | CircleLocationSaveResult | void;
    onArchive?: (anchorId?: string) => Promise<CircleLocationSaveResult | void> | CircleLocationSaveResult | void;
}

function anchorToDraft(anchor: CircleGeoAnchorDto): CircleGeoAnchorDraft {
    return {
        label: anchor.label,
        centerLat: anchor.centerLat,
        centerLng: anchor.centerLng,
        radiusMeters: anchor.radiusMeters,
        visibility: anchor.visibility,
    };
}

function createEmptyDraft(t: ReturnType<typeof useI18n>): CircleGeoAnchorDraft {
    return {
        label: t('defaultLabel'),
        centerLat: 0,
        centerLng: 0,
        radiusMeters: 120,
        visibility: 'public_discovery',
    };
}

function isValidDraft(value: CircleGeoAnchorDraft | null): boolean {
    if (!value) return false;
    const label = value.label.trim();
    return label.length > 0
        && label.length <= 128
        && Number.isFinite(value.centerLat)
        && value.centerLat >= -90
        && value.centerLat <= 90
        && Number.isFinite(value.centerLng)
        && value.centerLng >= -180
        && value.centerLng <= 180
        && Number.isInteger(value.radiusMeters)
        && value.radiusMeters >= 25
        && value.radiusMeters <= 3000;
}

export default function CircleLocationEditor({
    anchor,
    loading = false,
    saving = false,
    error = null,
    governanceRequestId = null,
    editable = false,
    onSave,
    onArchive,
}: CircleLocationEditorProps) {
    const t = useI18n('CircleLocation');
    const [draft, setDraft] = useState<CircleGeoAnchorDraft | null>(anchor ? anchorToDraft(anchor) : null);
    const [dirty, setDirty] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [localGovernanceRequestId, setLocalGovernanceRequestId] = useState<string | null>(null);

    useEffect(() => {
        setDraft(anchor ? anchorToDraft(anchor) : null);
        setDirty(false);
        setLocalError(null);
        setLocalGovernanceRequestId(null);
    }, [anchor?.anchorId, anchor?.updatedAt, anchor?.archivedAt]);

    const statusSummary = useMemo(() => {
        if (loading) return t('loading');
        if (!anchor) return t('noAnchor');
        const updatedAt = formatAnchorUpdatedAt(anchor.updatedAt);
        if (!updatedAt) return t('currentAnchor');
        return t('currentAnchorWithDate', { date: updatedAt });
    }, [anchor, loading, t]);

    const activeGovernanceRequestId = localGovernanceRequestId || governanceRequestId;
    const canSave = editable && Boolean(onSave) && !saving && dirty && isValidDraft(draft);
    const canArchive = editable && Boolean(onArchive) && !saving && Boolean(anchor?.anchorId);

    const handleSave = async () => {
        if (!draft || !onSave || !canSave) return;
        setLocalError(null);
        const normalized: CircleGeoAnchorDraft = {
            ...draft,
            label: draft.label.trim().replace(/\s+/g, ' '),
            radiusMeters: Math.floor(draft.radiusMeters),
        };
        try {
            const result = await onSave(normalized);
            if (result?.status === 'requires_governance') {
                setLocalGovernanceRequestId(result.requestId ?? null);
            } else {
                setDirty(false);
            }
        } catch {
            setLocalError(t('errors.saveFailed'));
        }
    };

    const handleArchive = async () => {
        if (!onArchive || !canArchive) return;
        setLocalError(null);
        try {
            const result = await onArchive(anchor?.anchorId);
            if (result?.status === 'requires_governance') {
                setLocalGovernanceRequestId(result.requestId ?? null);
            } else {
                setDraft(null);
                setDirty(false);
            }
        } catch {
            setLocalError(t('errors.archiveFailed'));
        }
    };

    return (
        <div className={styles.editor}>
            <div className={styles.summaryRow}>
                <div className={styles.summaryIcon}>
                    <MapPin size={16} />
                </div>
                <div className={styles.summaryText}>
                    <div className={styles.summaryTitle}>{t('title')}</div>
                    <div className={styles.summaryDescription}>{statusSummary}</div>
                </div>
            </div>

            {anchor && (
                <div className={styles.currentMeta}>
                    <span>{anchor.label}</span>
                    <span>{formatRadius(anchor.radiusMeters)}</span>
                    <span>{formatCoordinate(anchor.centerLat)}, {formatCoordinate(anchor.centerLng)}</span>
                </div>
            )}

            {!draft && editable && !loading && (
                <button
                    type="button"
                    className={styles.startButton}
                    onClick={() => {
                        setDraft(createEmptyDraft(t));
                        setDirty(true);
                    }}
                >
                    <MapPin size={15} />
                    <span>{t('startSetting')}</span>
                </button>
            )}

            {draft && (
                <CircleLocationPicker
                    value={draft}
                    disabled={!editable || saving || loading}
                    onChange={(next) => {
                        setDraft(next);
                        setDirty(true);
                        setLocalError(null);
                    }}
                    onLocationError={setLocalError}
                />
            )}

            {activeGovernanceRequestId && (
                <div className={styles.notice}>
                    <ShieldCheck size={14} />
                    <span>{t('governanceRequired', { requestId: activeGovernanceRequestId })}</span>
                </div>
            )}

            {(error || localError) && (
                <div className={styles.error}>{localError || error}</div>
            )}

            {editable ? (
                <div className={styles.actions}>
                    <button
                        type="button"
                        className={styles.saveButton}
                        onClick={handleSave}
                        disabled={!canSave}
                    >
                        <Save size={15} />
                        <span>{saving ? t('saving') : t('save')}</span>
                    </button>
                    <button
                        type="button"
                        className={styles.archiveButton}
                        onClick={handleArchive}
                        disabled={!canArchive}
                    >
                        <Trash2 size={15} />
                        <span>{t('archive')}</span>
                    </button>
                </div>
            ) : (
                <div className={styles.readonly}>{t('readonly')}</div>
            )}
        </div>
    );
}
