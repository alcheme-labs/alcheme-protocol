'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './DraftDiscussionPanel.module.css';

export interface DraftDiscussionSelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface DraftDiscussionSelectProps {
    id: string;
    value: string;
    options: DraftDiscussionSelectOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
}

export default function DraftDiscussionSelect({
    id,
    value,
    options,
    onChange,
    disabled = false,
}: DraftDiscussionSelectProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxId = `${id}-listbox`;
    const selectedOption = options.find((option) => option.value === value);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    return (
        <div className={styles.selectRoot} ref={rootRef}>
            <button
                id={id}
                ref={triggerRef}
                type="button"
                className={styles.selectTrigger}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <span className={styles.selectValue}>
                    {selectedOption?.label || options[0]?.label || ''}
                </span>
                <span className={styles.selectChevron} aria-hidden="true" />
            </button>
            {open && !disabled && (
                <div id={listboxId} className={styles.selectMenu} role="listbox" aria-labelledby={id}>
                    {options.map((option) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`${styles.selectOption}${selected ? ` ${styles.selectOptionActive}` : ''}`}
                                disabled={option.disabled}
                                onClick={() => {
                                    if (option.disabled) return;
                                    onChange(option.value);
                                    setOpen(false);
                                    triggerRef.current?.focus();
                                }}
                            >
                                <span className={styles.selectOptionLabel}>{option.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
