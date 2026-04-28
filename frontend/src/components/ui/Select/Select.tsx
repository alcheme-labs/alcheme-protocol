'use client';

import type { ReactNode } from 'react';
import { useId, useMemo, useState } from 'react';

import styles from './Select.module.css';

export type SelectValue = string | number;

export interface SelectOption<T extends SelectValue = string> {
    value: T;
    label: ReactNode;
    disabled?: boolean;
}

interface SelectProps<T extends SelectValue = string> {
    value: T;
    options: readonly SelectOption<T>[];
    onChange: (value: T) => void;
    ariaLabel?: string;
    labelId?: string;
    disabled?: boolean;
    className?: string;
    buttonClassName?: string;
    menuClassName?: string;
    optionClassName?: string;
    renderValue?: (option: SelectOption<T> | undefined) => ReactNode;
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
}

export default function Select<T extends SelectValue = string>({
    value,
    options,
    onChange,
    ariaLabel,
    labelId,
    disabled = false,
    className,
    buttonClassName,
    menuClassName,
    optionClassName,
    renderValue,
}: SelectProps<T>) {
    const generatedId = useId();
    const [open, setOpen] = useState(false);
    const [activeValue, setActiveValue] = useState<T | null>(null);
    const selectedOption = useMemo(
        () => options.find((option) => Object.is(option.value, value)),
        [options, value],
    );
    const valueId = `${generatedId}-value`;
    const listboxId = `${generatedId}-listbox`;
    const enabledOptions = options.filter((option) => !option.disabled);
    const activeOption = enabledOptions.find((option) => Object.is(option.value, activeValue));
    const activeOptionId = activeOption ? `${generatedId}-option-${String(activeOption.value)}` : undefined;

    const getInitialActiveValue = (): T | null => {
        const selectedEnabledOption = enabledOptions.find((option) => Object.is(option.value, value));
        return selectedEnabledOption?.value ?? enabledOptions[0]?.value ?? null;
    };
    const close = () => {
        setOpen(false);
        setActiveValue(null);
    };
    const openMenu = () => {
        if (disabled) return;
        setActiveValue(getInitialActiveValue());
        setOpen(true);
    };
    const toggle = () => {
        if (open) {
            close();
            return;
        }
        openMenu();
    };
    const selectValue = (option: SelectOption<T>) => {
        if (option.disabled) return;
        onChange(option.value);
        close();
    };
    const moveActiveOption = (direction: 1 | -1) => {
        if (enabledOptions.length === 0) return;
        const currentIndex = enabledOptions.findIndex((option) => Object.is(option.value, activeValue));
        const nextIndex = currentIndex < 0
            ? direction > 0 ? 0 : enabledOptions.length - 1
            : (currentIndex + direction + enabledOptions.length) % enabledOptions.length;
        setActiveValue(enabledOptions[nextIndex].value);
    };
    const commitActiveOption = () => {
        const option = activeOption || selectedOption;
        if (!option || option.disabled) return;
        selectValue(option);
    };

    return (
        <div className={joinClassNames(styles.root, open && styles.open, disabled && styles.disabled, className)}>
            {open && (
                <div
                    aria-hidden="true"
                    className={styles.backdrop}
                    onClick={close}
                />
            )}
            <button
                type="button"
                className={joinClassNames(styles.button, buttonClassName)}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
                aria-controls={listboxId}
                aria-activedescendant={open ? activeOptionId : undefined}
                disabled={disabled}
                onClick={toggle}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        close();
                    } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        if (!open) {
                            openMenu();
                            return;
                        }
                        moveActiveOption(1);
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        if (!open) {
                            openMenu();
                            return;
                        }
                        moveActiveOption(-1);
                    } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (!open) {
                            openMenu();
                            return;
                        }
                        commitActiveOption();
                    }
                }}
            >
                <span id={valueId} className={styles.value}>
                    {renderValue ? renderValue(selectedOption) : selectedOption?.label ?? String(value)}
                </span>
                <span aria-hidden="true" className={styles.chevron}>⌄</span>
            </button>
            {open && (
                <div
                    id={listboxId}
                    className={joinClassNames(styles.menu, menuClassName)}
                    role="listbox"
                    aria-labelledby={labelId}
                >
                    {options.map((option) => {
                        const selected = Object.is(option.value, value);
                        const active = Object.is(option.value, activeValue);
                        return (
                            <button
                                key={String(option.value)}
                                id={`${generatedId}-option-${String(option.value)}`}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={joinClassNames(
                                    styles.option,
                                    (selected || active) && styles.optionActive,
                                    option.disabled && styles.optionDisabled,
                                    optionClassName,
                                )}
                                disabled={option.disabled}
                                onMouseEnter={() => {
                                    if (!option.disabled) setActiveValue(option.value);
                                }}
                                onClick={() => selectValue(option)}
                            >
                                <span className={styles.optionLabel}>{option.label}</span>
                                {selected && <span aria-hidden="true" className={styles.check}>✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
