'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileText } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { SourceMaterialLicenseInput, SourceMaterialRecord } from '@/lib/api/circlesSourceMaterials';
import styles from './SourceMaterialsPanel.module.css';

interface SourceMaterialsPanelProps {
    materials: SourceMaterialRecord[];
    loading?: boolean;
    busy?: boolean;
    error?: string | null;
    canUpload?: boolean;
    onUpload?: (file: File, license: SourceMaterialLicenseInput) => Promise<SourceMaterialRecord | void>;
    onCaptureExternalUrl?: (input: {
        name: string;
        canonicalUrl: string;
        externalAuthorLabel: string;
        publishedAt: string;
        content: string;
        recaptureOfSourceMaterialId?: number | null;
        license: SourceMaterialLicenseInput;
    }) => Promise<SourceMaterialRecord | void>;
    onOpenContent?: (sourceMaterialId: number) => Promise<{ content: string; contentType: string | null }>;
}

const EMPTY_CAPTURE = {
    name: '',
    canonicalUrl: '',
    externalAuthorLabel: '',
    publishedAt: '',
    content: '',
    recaptureOfSourceMaterialId: null as number | null,
    licenseRef: '',
    licenseVersion: '',
    publicDisplayAuthorized: false,
};

function formatSourceMaterialStatus(
    status: string,
    t: ReturnType<typeof useI18n>,
): string {
    if (status === 'ai_readable') return t('status.aiReadable');
    if (status === 'extracting') return t('status.extracting');
    return t('status.processing');
}

export default function SourceMaterialsPanel({
    materials,
    loading = false,
    busy = false,
    error = null,
    canUpload = true,
    onUpload,
    onCaptureExternalUrl,
    onOpenContent,
}: SourceMaterialsPanelProps) {
    const t = useI18n('SourceMaterialsPanel');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const previewCardRef = useRef<HTMLElement | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [openingId, setOpeningId] = useState<number | null>(null);
    const [preview, setPreview] = useState<{ id: number; content: string } | null>(null);
    const [manualRightsHolder, setManualRightsHolder] = useState('');
    const [manualLicenseConfirmed, setManualLicenseConfirmed] = useState(false);
    const [captureOpen, setCaptureOpen] = useState(false);
    const [externalCapture, setExternalCapture] = useState(EMPTY_CAPTURE);

    const sortedMaterials = useMemo(
        () => [...materials],
        [materials],
    );
    const latestExternalVersionIds = useMemo(() => {
        const latest = new Map<string, SourceMaterialRecord>();
        for (const material of materials) {
            if (material.originType !== 'external_url_capture' || !material.originRef) continue;
            const current = latest.get(material.originRef);
            if (!current || (material.sourceVersion ?? 0) > (current.sourceVersion ?? 0)) {
                latest.set(material.originRef, material);
            }
        }
        return new Set([...latest.values()].map((material) => material.id));
    }, [materials]);

    useEffect(() => {
        if (!preview) return;
        previewCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [preview]);

    const uploadReady = Boolean(
        selectedFile
        && manualRightsHolder.trim()
        && manualLicenseConfirmed,
    );

    const handleUpload = async () => {
        if (!selectedFile || !onUpload) return;
        try {
            const content = await selectedFile.text();
            const material = await onUpload(selectedFile, {
                basis: 'self_authored_safe_default',
                rightsHolder: manualRightsHolder.trim(),
                publicDisplayAuthorized: true,
                commercialUseAuthorized: false,
                nftUseAuthorized: false,
            });
            if (material?.id) {
                setPreview({ id: material.id, content });
            }
            setSelectedFile(null);
            setManualRightsHolder('');
            setManualLicenseConfirmed(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch {
            // Parent state already surfaces the upload failure.
        }
    };

    const handleExternalCapture = async () => {
        if (!onCaptureExternalUrl) return;
        try {
            const material = await onCaptureExternalUrl({
                name: externalCapture.name,
                canonicalUrl: externalCapture.canonicalUrl,
                externalAuthorLabel: externalCapture.externalAuthorLabel,
                content: externalCapture.content,
                recaptureOfSourceMaterialId: externalCapture.recaptureOfSourceMaterialId,
                publishedAt: new Date(externalCapture.publishedAt).toISOString(),
                license: {
                    basis: 'external_license',
                    rightsHolder: externalCapture.externalAuthorLabel.trim(),
                    licenseRef: externalCapture.licenseRef.trim(),
                    licenseVersion: externalCapture.licenseVersion.trim(),
                    publicDisplayAuthorized: externalCapture.publicDisplayAuthorized,
                    commercialUseAuthorized: false,
                    nftUseAuthorized: false,
                },
            });
            if (material?.id) {
                setPreview({ id: material.id, content: externalCapture.content });
            }
            setExternalCapture(EMPTY_CAPTURE);
            setCaptureOpen(false);
        } catch {
            // Parent state already surfaces the capture failure.
        }
    };
    const externalCaptureReady = [
        externalCapture.name,
        externalCapture.canonicalUrl,
        externalCapture.externalAuthorLabel,
        externalCapture.publishedAt,
        externalCapture.content,
        externalCapture.licenseRef,
        externalCapture.licenseVersion,
    ].every((value) => value.trim().length > 0)
        && !Number.isNaN(new Date(externalCapture.publishedAt).getTime())
        && externalCapture.publicDisplayAuthorized;

    const handleOpenContent = async (material: SourceMaterialRecord) => {
        if (preview?.id === material.id) {
            setPreview(null);
            return;
        }
        if (!onOpenContent) return;
        setOpeningId(material.id);
        try {
            const result = await onOpenContent(material.id);
            setPreview({ id: material.id, content: result.content });
        } catch {
            // Parent state already surfaces the read failure.
        } finally {
            setOpeningId(null);
        }
    };

    const beginRecapture = (material: SourceMaterialRecord) => {
        if (!material.canonicalUrl || !material.externalAuthorLabel || !material.sourcePublishedAt) return;
        setCaptureOpen(true);
        setExternalCapture({
            name: material.name,
            canonicalUrl: material.canonicalUrl,
            externalAuthorLabel: material.externalAuthorLabel,
            publishedAt: toDateTimeLocal(material.sourcePublishedAt),
            content: '',
            recaptureOfSourceMaterialId: material.id,
            licenseRef: material.licenseFacts?.licenseRef || '',
            licenseVersion: material.licenseFacts?.licenseVersion || '',
            publicDisplayAuthorized: material.licenseFacts?.publicDisplayAuthorized === true,
        });
    };

    const resetCapture = () => {
        setExternalCapture(EMPTY_CAPTURE);
        setCaptureOpen(false);
    };

    const materialList = sortedMaterials.length === 0 ? null : (
            <div className={styles.list}>
                {sortedMaterials.map((material) => (
                    <article
                        key={material.id}
                        ref={preview?.id === material.id ? previewCardRef : undefined}
                        className={styles.card}
                    >
                        <div className={styles.cardHeader}>
                        <div className={styles.cardBody}>
                            <p className={styles.name}>{material.name}</p>
                            <p className={styles.meta}>
                                {t('meta.extracted', {
                                    chunkCount: material.chunkCount,
                                })}
                            </p>
                            {material.originType === 'communication_message' ? (
                                <div className={styles.sourceMeta}>
                                    {communicationContributorLabel(material) ? (
                                        <span>{communicationContributorLabel(material)}</span>
                                    ) : null}
                                    {material.summaryText ? <span>{material.summaryText}</span> : null}
                                </div>
                            ) : null}
                            {material.originType === 'external_url_capture' && material.canonicalUrl ? (
                                <p className={styles.sourceMeta}>
                                    <a href={material.canonicalUrl} target="_blank" rel="noreferrer">
                                        {material.externalAuthorLabel || material.canonicalUrl}
                                    </a>
                                    <span>{t('meta.sourceVersion', { version: material.sourceVersion ?? 1 })}</span>
                                    <span>{t('meta.capturedAt', { time: formatDate(material.capturedAt) })}</span>
                                    {material.versionDiff ? (
                                        <span>{t('meta.versionDiff', {
                                            previousVersion: material.versionDiff.previousVersion,
                                            added: material.versionDiff.addedChunks,
                                            removed: material.versionDiff.removedChunks,
                                            unchanged: material.versionDiff.unchangedChunks,
                                        })}</span>
                                    ) : null}
                                    {onCaptureExternalUrl && canUpload && !busy && latestExternalVersionIds.has(material.id) ? (
                                        <button
                                            type="button"
                                            className={styles.recaptureButton}
                                            onClick={() => beginRecapture(material)}
                                        >
                                            {t('capture.recapture')}
                                        </button>
                                    ) : null}
                                </p>
                            ) : null}
                            <p className={styles.meta}>
                                {material.licenseFacts
                                    ? t('license.summary', {
                                        licenseRef: material.licenseFacts.licenseRef || 'license',
                                        rightsHolder: material.licenseFacts.rightsHolder || '—',
                                    })
                                    : t('license.incomplete')}
                            </p>
                        </div>
                        <div className={styles.cardActions}>
                            <span className={styles.badge}>{formatSourceMaterialStatus(material.status, t)}</span>
                            {onOpenContent || preview?.id === material.id ? (
                                <button
                                    type="button"
                                    className={styles.openButton}
                                    disabled={busy || openingId === material.id}
                                    onClick={() => void handleOpenContent(material)}
                                >
                                    {preview?.id === material.id ? t('actions.closePreview') : t('actions.open')}
                                </button>
                            ) : null}
                        </div>
                        </div>
                        {preview?.id === material.id ? (
                            <pre className={styles.preview}>{preview.content}</pre>
                        ) : null}
                    </article>
                ))}
            </div>
    );

    return (
        <section className={styles.panel} aria-label={t('aria.section')}>
            <div className={styles.heading}>
                <p className={styles.eyebrow}>Grounding</p>
                <div className={styles.titleRow}>
                    <h3 className={styles.title}>{t('title')}</h3>
                    {sortedMaterials.length > 0 ? (
                        <span className={styles.count}>{sortedMaterials.length}</span>
                    ) : null}
                </div>
                <p className={styles.hint}>{t('hint')}</p>
            </div>

            {loading && <p className={styles.hint}>{t('loading')}</p>}
            {error ? <p className={styles.error}>{error}</p> : null}
            {!loading && !busy && sortedMaterials.length === 0 && (
                <p className={styles.empty}>{t('empty')}</p>
            )}
            {materialList}

            {canUpload && onUpload ? (
                <div className={styles.uploadCard}>
                    <input
                        ref={fileInputRef}
                        aria-label={t('aria.fileInput')}
                        className={styles.hiddenFileInput}
                        type="file"
                        accept=".txt,.md,.markdown,.json,.csv,.yaml,.yml,.xml"
                        disabled={busy}
                        onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    />
                    <button
                        type="button"
                        className={styles.filePicker}
                        disabled={busy}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <FileText size={18} />
                        <span className={styles.filePickerCopy}>
                            <span className={styles.filePickerLabel}>{t('actions.chooseFile')}</span>
                            <span className={styles.filePickerName}>
                                {selectedFile ? selectedFile.name : t('file.none')}
                            </span>
                        </span>
                    </button>
                    <label className={styles.field}>
                        <span>{t('license.rightsHolder')}</span>
                        <input
                            className={styles.fieldInput}
                            value={manualRightsHolder}
                            disabled={busy}
                            placeholder={t('license.rightsHolderPlaceholder')}
                            autoComplete="name"
                            onChange={(event) => setManualRightsHolder(event.target.value)}
                        />
                    </label>
                    <label className={styles.checkRow}>
                        <input
                            className={styles.nativeCheck}
                            type="checkbox"
                            checked={manualLicenseConfirmed}
                            disabled={busy}
                            onChange={(event) => setManualLicenseConfirmed(event.target.checked)}
                        />
                        <span
                            className={`${styles.checkbox} ${manualLicenseConfirmed ? styles.checkboxSelected : ''}`}
                            aria-hidden="true"
                        >
                            {manualLicenseConfirmed ? <Check size={12} color="#1f2421" strokeWidth={3} /> : null}
                        </span>
                        <span>{t('license.selfAuthoredConfirmation')}</span>
                    </label>
                    {selectedFile && !uploadReady ? (
                        <p className={styles.hint}>{t('notices.uploadNeedsLicense')}</p>
                    ) : null}
                    <button
                        type="button"
                        className={styles.uploadButton}
                        onClick={() => void handleUpload()}
                        disabled={!uploadReady || busy}
                    >
                        {t('actions.uploadAndExtract')}
                    </button>
                </div>
            ) : null}

            {!canUpload && <p className={styles.hint}>{t('notices.uploadDisabled')}</p>}
            {busy && <p className={styles.status}>{t('status.extracting')}</p>}

            {onCaptureExternalUrl ? (
                <div className={styles.captureShell}>
                    <button
                        type="button"
                        className={styles.captureToggle}
                        aria-expanded={captureOpen}
                        onClick={() => setCaptureOpen((open) => !open)}
                    >
                        <span className={styles.captureToggleCopy}>
                            <span className={styles.captureToggleTitle}>{t('capture.title')}</span>
                            {!captureOpen ? (
                                <span className={styles.captureToggleHint}>{t('capture.toggleHint')}</span>
                            ) : null}
                        </span>
                        <ChevronDown
                            size={16}
                            className={`${styles.chevron} ${captureOpen ? styles.chevronOpen : ''}`}
                        />
                    </button>
                    {captureOpen ? (
                <fieldset className={styles.captureForm} disabled={!canUpload || busy}>
                    <legend className={styles.srOnly}>{t('capture.title')}</legend>
                    <p>{t('capture.boundary')}</p>
                    {externalCapture.recaptureOfSourceMaterialId ? (
                        <div className={styles.recaptureNotice}>
                            <span>{t('capture.recaptureOf', { id: externalCapture.recaptureOfSourceMaterialId })}</span>
                            <button
                                type="button"
                                onClick={resetCapture}
                            >
                                {t('capture.cancelRecapture')}
                            </button>
                        </div>
                    ) : null}
                    <label>
                        <span>{t('capture.name')}</span>
                        <input
                            className={styles.fieldInput}
                            value={externalCapture.name}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, name: event.target.value }))}
                        />
                    </label>
                    <label>
                        <span>{t('capture.url')}</span>
                        <input
                            className={styles.fieldInput}
                            type="url"
                            inputMode="url"
                            placeholder="https://"
                            value={externalCapture.canonicalUrl}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, canonicalUrl: event.target.value }))}
                        />
                    </label>
                    <label>
                        <span>{t('capture.author')}</span>
                        <input
                            className={styles.fieldInput}
                            value={externalCapture.externalAuthorLabel}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, externalAuthorLabel: event.target.value }))}
                        />
                    </label>
                    <label>
                        <span>{t('capture.publishedAt')}</span>
                        <input
                            className={styles.fieldInput}
                            type="datetime-local"
                            value={externalCapture.publishedAt}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, publishedAt: event.target.value }))}
                        />
                    </label>
                    <label className={styles.captureContent}>
                        <span>{t('capture.content')}</span>
                        <textarea
                            className={styles.fieldTextarea}
                            rows={5}
                            value={externalCapture.content}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, content: event.target.value }))}
                        />
                    </label>
                    <label>
                        <span>{t('license.sourceLicenseRef')}</span>
                        <input
                            className={styles.fieldInput}
                            value={externalCapture.licenseRef}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, licenseRef: event.target.value }))}
                        />
                    </label>
                    <label>
                        <span>{t('license.sourceLicenseVersion')}</span>
                        <input
                            className={styles.fieldInput}
                            value={externalCapture.licenseVersion}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, licenseVersion: event.target.value }))}
                        />
                    </label>
                    <label className={styles.checkRow}>
                        <input
                            className={styles.nativeCheck}
                            type="checkbox"
                            checked={externalCapture.publicDisplayAuthorized}
                            onChange={(event) => setExternalCapture((current) => ({ ...current, publicDisplayAuthorized: event.target.checked }))}
                        />
                        <span
                            className={`${styles.checkbox} ${externalCapture.publicDisplayAuthorized ? styles.checkboxSelected : ''}`}
                            aria-hidden="true"
                        >
                            {externalCapture.publicDisplayAuthorized ? <Check size={12} color="#1f2421" strokeWidth={3} /> : null}
                        </span>
                        <span>{t('license.externalDisplayConfirmation')}</span>
                    </label>
                    <button
                        type="button"
                        className={styles.uploadButton}
                        disabled={!externalCaptureReady || !canUpload || busy}
                        onClick={() => void handleExternalCapture()}
                    >
                        {t('capture.save')}
                    </button>
                </fieldset>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function toDateTimeLocal(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function communicationContributorLabel(material: SourceMaterialRecord): string | null {
    const provenance = material.provenance;
    const handle = typeof provenance?.originMessageSenderHandle === 'string'
        ? provenance.originMessageSenderHandle.trim()
        : '';
    const pubkey = typeof provenance?.originMessageSenderPubkey === 'string'
        ? provenance.originMessageSenderPubkey.trim()
        : '';
    if (handle) return `@${handle}`;
    if (!pubkey) return null;
    return pubkey.length > 12 ? `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}` : pubkey;
}
