'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import { BottomSheet } from '../BottomSheet';
import styles from './OptionPickerSheet.module.css';

export type OptionPickerValue = string | number;

export interface OptionPickerOption<T extends OptionPickerValue = string> {
    value: T;
    label: ReactNode;
    description?: ReactNode;
    disabled?: boolean;
}

export interface OptionPickerSheetProps<T extends OptionPickerValue = string> {
    open: boolean;
    title: string;
    closeLabel: string;
    value: T;
    options: readonly OptionPickerOption<T>[];
    onChange: (value: T) => void;
    onClose: () => void;
}

export default function OptionPickerSheet<T extends OptionPickerValue = string>({
    open,
    title,
    closeLabel,
    value,
    options,
    onChange,
    onClose,
}: OptionPickerSheetProps<T>) {
    return (
        <BottomSheet open={open} title={title} closeLabel={closeLabel} onClose={onClose}>
            <div className={styles.optionList} role="radiogroup" aria-label={title}>
                {options.map((option) => {
                    const selected = Object.is(option.value, value);
                    return (
                        <button
                            key={String(option.value)}
                            type="button"
                            className={styles.optionButton}
                            role="radio"
                            aria-checked={selected}
                            disabled={option.disabled}
                            onClick={() => {
                                if (option.disabled) return;
                                onChange(option.value);
                                onClose();
                            }}
                        >
                            <span className={styles.optionText}>
                                <span className={styles.optionLabel}>{option.label}</span>
                                {option.description && <span className={styles.optionDescription}>{option.description}</span>}
                            </span>
                            {selected && (
                                <span className={styles.optionCheck} aria-hidden="true">
                                    <Check size={16} />
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </BottomSheet>
    );
}
