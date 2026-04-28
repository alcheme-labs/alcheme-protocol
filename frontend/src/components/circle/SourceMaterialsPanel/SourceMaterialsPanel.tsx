'use client';

import { useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import type { SourceMaterialRecord } from '@/lib/api/circlesSourceMaterials';
import styles from './SourceMaterialsPanel.module.css';

interface SourceMaterialsPanelProps {
    materials: SourceMaterialRecord[];
    loading?: boolean;
    busy?: boolean;
    error?: string | null;
    canUpload?: boolean;
    onUpload?: (file: File) => Promise<void>;
}

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
}: SourceMaterialsPanelProps) {
    const t = useI18n('SourceMaterialsPanel');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const sortedMaterials = useMemo(
        () => [...materials],
        [materials],
    );

    const handleUpload = async () => {
        if (!selectedFile || !onUpload) return;
        try {
            await onUpload(selectedFile);
            setSelectedFile(null);
        } catch {
            // Parent state already surfaces the upload failure.
        }
    };

    return (
        <section className={styles.panel} aria-label={t('aria.section')}>
            <div className={styles.heading}>
                <p className={styles.eyebrow}>Grounding</p>
                <h3 className={styles.title}>{t('title')}</h3>
                <p className={styles.hint}>{t('hint')}</p>
            </div>

            <div className={styles.uploadRow}>
                <input
                    aria-label={t('aria.fileInput')}
                    className={styles.fileInput}
                    type="file"
                    accept=".txt,.md,.markdown,.json,.csv,.yaml,.yml,.xml,text/*,application/json,application/ld+json,application/xml"
                    disabled={!canUpload || busy}
                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
                <button
                    type="button"
                    className={styles.uploadButton}
                    onClick={handleUpload}
                    disabled={!canUpload || !selectedFile || busy}
                >
                    {t('actions.uploadAndExtract')}
                </button>
            </div>

            {!canUpload && <p className={styles.hint}>{t('notices.uploadDisabled')}</p>}
            {busy && <p className={styles.status}>{t('status.extracting')}</p>}
            {loading && <p className={styles.hint}>{t('loading')}</p>}
            {!loading && error && <p className={styles.error}>{error}</p>}
            {!loading && !busy && sortedMaterials.length === 0 && (
                <p className={styles.empty}>{t('empty')}</p>
            )}

            {sortedMaterials.length > 0 && (
                <div className={styles.list}>
                    {sortedMaterials.map((material) => (
                        <article key={material.id} className={styles.card}>
                            <div>
                                <p className={styles.name}>{material.name}</p>
                                <p className={styles.meta}>
                                    {t('meta.chunkDigest', {
                                        chunkCount: material.chunkCount,
                                        digest: material.contentDigest.slice(0, 10),
                                    })}
                                </p>
                            </div>
                            <span className={styles.badge}>{formatSourceMaterialStatus(material.status, t)}</span>
                        </article>
                    ))}
                </div>
            )}
        </section>
    );
}
