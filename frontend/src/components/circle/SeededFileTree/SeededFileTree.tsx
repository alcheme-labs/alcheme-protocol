'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import type { SeededFileTreeNode, SeededReferenceSelection } from '@/lib/circles/seeded';
import styles from './SeededFileTree.module.css';

interface SeededFileTreeProps {
    tree: SeededFileTreeNode[];
    loading?: boolean;
    error?: string | null;
    selectedReference?: SeededReferenceSelection | null;
    onSelectReference?: (reference: SeededReferenceSelection) => void;
    embedded?: boolean;
}

function flattenSeededFiles(nodes: SeededFileTreeNode[]): SeededFileTreeNode[] {
    const files: SeededFileTreeNode[] = [];
    for (const node of nodes) {
        if (node.nodeType === 'file') {
            files.push(node);
        }
        if (node.children.length > 0) {
            files.push(...flattenSeededFiles(node.children));
        }
    }
    return files;
}

function renderTree(
    nodes: SeededFileTreeNode[],
    selectedFilePath: string | null,
    onSelectFile: (path: string) => void,
): ReactNode {
    return nodes.map((node) => {
        if (node.nodeType === 'directory') {
            return (
                <div key={node.path} className={styles.nodeGroup}>
                    <span className={styles.directoryLabel}>{node.name}</span>
                    {node.children.length > 0 && (
                        <div className={styles.nodeChildren}>
                            {renderTree(node.children, selectedFilePath, onSelectFile)}
                        </div>
                    )}
                </div>
            );
        }

        const isActive = selectedFilePath === node.path;
        return (
            <button
                key={node.path}
                type="button"
                className={`${styles.fileButton} ${isActive ? styles.fileButtonActive : ''}`.trim()}
                onClick={() => onSelectFile(node.path)}
            >
                {node.name}
            </button>
        );
    });
}

export default function SeededFileTree({
    tree,
    loading = false,
    error = null,
    selectedReference = null,
    onSelectReference,
    embedded = false,
}: SeededFileTreeProps) {
    const t = useI18n('SeededFileTree');
    const fileNodes = useMemo(() => flattenSeededFiles(tree), [tree]);
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

    useEffect(() => {
        if (selectedReference?.path) {
            setSelectedFilePath(selectedReference.path);
            return;
        }
        if (fileNodes.length > 0 && !selectedFilePath) {
            setSelectedFilePath(fileNodes[0].path);
        }
    }, [fileNodes, selectedFilePath, selectedReference?.path]);

    const selectedFile = useMemo(
        () => fileNodes.find((node) => node.path === selectedFilePath) || fileNodes[0] || null,
        [fileNodes, selectedFilePath],
    );
    const selectedLines = useMemo(
        () => String(selectedFile?.contentText || '').split(/\r?\n/),
        [selectedFile?.contentText],
    );

    return (
        <section
            className={`${styles.panel} ${embedded ? styles.embeddedPanel : ''}`.trim()}
            aria-label={t('aria.section')}
        >
            {!embedded && (
                <div className={styles.heading}>
                    <p className={styles.eyebrow}>Seeded</p>
                    <h3 className={styles.title}>{t('title')}</h3>
                    <p className={styles.hint}>{t('hint')}</p>
                </div>
            )}

            {selectedReference && (
                <p className={styles.currentRef}>{t('currentRef', {reference: selectedReference.raw})}</p>
            )}
            {loading && <p className={styles.hint}>{t('loading')}</p>}
            {!loading && error && <p className={styles.error}>{error}</p>}
            {!loading && !error && fileNodes.length === 0 && (
                <p className={styles.empty}>{t('empty')}</p>
            )}

            {fileNodes.length > 0 && (
                <div className={styles.layout}>
                    <div className={styles.tree}>
                        {renderTree(tree, selectedFile?.path || null, setSelectedFilePath)}
                    </div>
                    <div className={styles.preview}>
                        <p className={styles.previewTitle}>{selectedFile?.path || t('preview.unselected')}</p>
                        <div className={styles.previewLines}>
                            {selectedLines.map((lineText, index) => {
                                const lineNumber = index + 1;
                                const reference = selectedFile
                                    ? {
                                        raw: `@file:${selectedFile.path}:${lineNumber}`,
                                        path: selectedFile.path,
                                        line: lineNumber,
                                        fileName: selectedFile.path.split('/').pop() || selectedFile.path,
                                    }
                                    : null;
                                const isActive = selectedReference?.path === selectedFile?.path
                                    && selectedReference.line === lineNumber;
                                return (
                                    <button
                                        key={`${selectedFile?.path || 'file'}:${lineNumber}`}
                                        type="button"
                                        aria-label={`L${lineNumber}`}
                                        className={`${styles.lineButton} ${isActive ? styles.lineButtonActive : ''}`.trim()}
                                        onClick={() => {
                                            if (reference) onSelectReference?.(reference);
                                        }}
                                    >
                                        <span className={styles.lineNumber}>L{lineNumber}</span>
                                        <span className={styles.lineText}>{lineText || ' '}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
