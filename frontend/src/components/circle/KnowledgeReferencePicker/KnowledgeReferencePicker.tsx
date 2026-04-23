'use client';

import { useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import {
    filterKnowledgeReferenceOptions,
    type KnowledgeReferenceOption,
} from '@/lib/circle/knowledgeReferenceOptions';
import styles from './KnowledgeReferencePicker.module.css';

interface KnowledgeReferencePickerProps {
    options: KnowledgeReferenceOption[];
    onSelect: (option: KnowledgeReferenceOption) => void;
    onClose?: () => void;
    query?: string;
    onQueryChange?: (value: string) => void;
    autoFocusSearch?: boolean;
    searchDisabled?: boolean;
}

export default function KnowledgeReferencePicker({
    options,
    onSelect,
    onClose,
    query,
    onQueryChange,
    autoFocusSearch = false,
    searchDisabled = false,
}: KnowledgeReferencePickerProps) {
    const t = useI18n('KnowledgeReferencePicker');
    const [internalQuery, setInternalQuery] = useState('');
    const resolvedQuery = query ?? internalQuery;
    const filteredOptions = useMemo(
        () => filterKnowledgeReferenceOptions(options, resolvedQuery),
        [options, resolvedQuery],
    );

    return (
        <div className={styles.picker}>
            <div className={styles.header}>
                <p className={styles.title}>{t('title')}</p>
                {onClose && (
                    <button type="button" className={styles.closeButton} onClick={onClose}>
                        {t('close')}
                    </button>
                )}
            </div>
            <p className={styles.hint}>{t('hint')}</p>
            <input
                type="search"
                value={resolvedQuery}
                onChange={(event) => {
                    onQueryChange?.(event.target.value);
                    if (!onQueryChange) {
                        setInternalQuery(event.target.value);
                    }
                }}
                className={styles.searchInput}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchAriaLabel')}
                autoFocus={autoFocusSearch}
                disabled={searchDisabled}
            />
            {filteredOptions.length > 0 ? (
                <div className={styles.optionList}>
                    {filteredOptions.map((option) => (
                        <button
                            key={option.knowledgeId}
                            type="button"
                            className={styles.option}
                            onClick={() => onSelect(option)}
                        >
                            <span className={styles.optionTitle}>{option.title}</span>
                            <span className={styles.optionMeta}>{t('version', { version: option.version || 1 })}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <p className={styles.empty}>{t('empty')}</p>
            )}
        </div>
    );
}
