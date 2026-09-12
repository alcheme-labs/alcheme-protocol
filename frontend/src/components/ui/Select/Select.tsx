'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useI18n } from '@/i18n/useI18n';
import styles from './Select.module.css';
import { acquireDocumentScrollLock } from './documentScrollLock';

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

function resolvePortalTheme(root: HTMLElement): CSSProperties {
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = [
        'position:absolute',
        'width:0',
        'height:0',
        'overflow:hidden',
        'pointer-events:none',
        'background-color:var(--select-menu-bg, #fff)',
        'border:1px solid var(--select-menu-border, rgba(0, 0, 0, 0.14))',
        'color:var(--select-option-color, inherit)',
    ].join(';');
    root.appendChild(probe);

    const rootStyle = window.getComputedStyle(root);
    const probeStyle = window.getComputedStyle(probe);
    const menuBackground = probeStyle.backgroundColor || '#fff';
    const menuBorder = probeStyle.borderTopColor || 'rgba(0, 0, 0, 0.14)';
    const optionColor = probeStyle.color || rootStyle.color;

    probe.style.backgroundColor = 'var(--select-option-active-bg, rgba(185, 154, 85, 0.14))';
    probe.style.color = 'var(--select-option-active-color, currentColor)';

    const resolved: CSSProperties & Record<string, string> = {
        '--select-menu-bg': menuBackground,
        '--select-menu-border': menuBorder,
        '--select-option-color': optionColor,
        '--select-option-active-bg': probeStyle.backgroundColor || 'rgba(185, 154, 85, 0.14)',
        '--select-option-active-color': probeStyle.color || optionColor,
    };

    probe.remove();
    return resolved;
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
    const t = useI18n('UiSelect');
    const generatedId = useId();
    const [open, setOpen] = useState(false);
    const [activeValue, setActiveValue] = useState<T | null>(null);
    const [mounted, setMounted] = useState(false);
    const [portalTheme, setPortalTheme] = useState<CSSProperties>();
    const [viewportInsets, setViewportInsets] = useState<CSSProperties>();
    const rootRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const optionRefs = useRef(new Map<string, HTMLButtonElement>());
    const typeaheadRef = useRef<{ value: string; resetTimer: ReturnType<typeof setTimeout> | null }>({
        value: '',
        resetTimer: null,
    });
    const selectedOption = useMemo(
        () => options.find((option) => Object.is(option.value, value)),
        [options, value],
    );
    const valueId = `${generatedId}-value`;
    const listboxId = `${generatedId}-listbox`;
    const enabledOptions = useMemo(
        () => options.filter((option) => !option.disabled),
        [options],
    );
    const activeOption = enabledOptions.find((option) => Object.is(option.value, activeValue));
    const activeOptionId = activeOption ? `${generatedId}-option-${String(activeOption.value)}` : undefined;

    const getInitialActiveValue = useCallback((): T | null => {
        const selectedEnabledOption = enabledOptions.find((option) => Object.is(option.value, value));
        return selectedEnabledOption?.value ?? enabledOptions[0]?.value ?? null;
    }, [enabledOptions, value]);
    const restoreOpenerFocus = useCallback(() => {
        requestAnimationFrame(() => {
            if (openerRef.current?.isConnected) {
                openerRef.current.focus({ preventScroll: true });
            }
        });
    }, []);
    const close = useCallback(() => {
        setOpen(false);
        setActiveValue(null);
        restoreOpenerFocus();
    }, [restoreOpenerFocus]);
    const syncPortalTheme = () => {
        if (!rootRef.current) return;
        setPortalTheme(resolvePortalTheme(rootRef.current));
    };
    const openMenu = () => {
        if (disabled) return;
        syncPortalTheme();
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
        if (option.disabled) {
            close();
            return;
        }
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
    const moveToBoundary = (boundary: 'first' | 'last') => {
        if (enabledOptions.length === 0) return;
        setActiveValue(
            enabledOptions[boundary === 'first' ? 0 : enabledOptions.length - 1].value,
        );
    };
    const moveByTypeahead = (key: string) => {
        const state = typeaheadRef.current;
        state.value = `${state.value}${key.toLocaleLowerCase()}`;
        if (state.resetTimer) clearTimeout(state.resetTimer);
        state.resetTimer = setTimeout(() => {
            state.value = '';
            state.resetTimer = null;
        }, 500);
        const match = enabledOptions.find((option) => (
            typeof option.label === 'string'
            && option.label.toLocaleLowerCase().startsWith(state.value)
        ));
        if (match) setActiveValue(match.value);
    };
    const commitActiveOption = () => {
        const option = activeOption || selectedOption;
        if (!option || option.disabled) return;
        selectValue(option);
    };

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!open) return;
        const releaseScrollLock = acquireDocumentScrollLock();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        const syncVisualViewport = () => {
            const vv = window.visualViewport;
            const height = Math.max(1, vv?.height ?? window.innerHeight);
            const offsetTop = Math.max(0, vv?.offsetTop ?? 0);
            setViewportInsets({
                '--select-vv-height': `${height}px`,
                '--select-vv-offset-top': `${offsetTop}px`,
            } as CSSProperties);
        };
        syncVisualViewport();
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', syncVisualViewport);
        window.visualViewport?.addEventListener('resize', syncVisualViewport);
        window.visualViewport?.addEventListener('scroll', syncVisualViewport);
        return () => {
            releaseScrollLock();
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('resize', syncVisualViewport);
            window.visualViewport?.removeEventListener('resize', syncVisualViewport);
            window.visualViewport?.removeEventListener('scroll', syncVisualViewport);
        };
    }, [close, open]);

    useEffect(() => {
        if (!open || activeValue === null) return;
        const option = optionRefs.current.get(String(activeValue));
        option?.focus({ preventScroll: true });
    }, [activeValue, open]);

    useEffect(() => () => {
        if (typeaheadRef.current.resetTimer) {
            clearTimeout(typeaheadRef.current.resetTimer);
        }
    }, []);

    const overlay = open && mounted
        ? createPortal(
            <div
                className={styles.overlay}
                data-select-overlay="true"
                style={{ ...portalTheme, ...viewportInsets }}
            >
                <button
                    type="button"
                    aria-label={t('close')}
                    className={styles.backdrop}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        close();
                    }}
                    onClick={close}
                />
                <div
                    ref={menuRef}
                    id={listboxId}
                    className={joinClassNames(styles.menu, menuClassName)}
                    role="listbox"
                    aria-labelledby={labelId}
                    aria-activedescendant={activeOptionId}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            moveActiveOption(1);
                        } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            moveActiveOption(-1);
                        } else if (event.key === 'Home') {
                            event.preventDefault();
                            moveToBoundary('first');
                        } else if (event.key === 'End') {
                            event.preventDefault();
                            moveToBoundary('last');
                        } else if (event.key === 'Enter' || event.key === ' ') {
                            if ((event.target as HTMLElement).getAttribute('role') === 'option') {
                                event.preventDefault();
                                commitActiveOption();
                            }
                        } else if (event.key === 'Tab') {
                            const focusable = Array.from(
                                menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
                            );
                            if (focusable.length === 0) return;
                            const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
                            const movingBeforeFirst = event.shiftKey && currentIndex <= 0;
                            const movingPastLast = !event.shiftKey && currentIndex === focusable.length - 1;
                            if (movingBeforeFirst || movingPastLast) {
                                event.preventDefault();
                                focusable[movingBeforeFirst ? focusable.length - 1 : 0]
                                    .focus({ preventScroll: true });
                            }
                        } else if (
                            event.key.length === 1
                            && !event.altKey
                            && !event.ctrlKey
                            && !event.metaKey
                        ) {
                            moveByTypeahead(event.key);
                        }
                    }}
                >
                    <div className={styles.sheetHeader}>
                        <div className={styles.sheetHandle} aria-hidden="true" />
                        <div className={styles.sheetTitleRow}>
                            <span>{ariaLabel || t('title')}</span>
                            <button type="button" className={styles.sheetClose} onClick={close}>
                                {t('done')}
                            </button>
                        </div>
                    </div>
                    <div className={styles.optionList}>
                        {options.map((option) => {
                            const selected = Object.is(option.value, value);
                            const active = Object.is(option.value, activeValue);
                            return (
                                <button
                                    ref={(node) => {
                                        const key = String(option.value);
                                        if (node) optionRefs.current.set(key, node);
                                        else optionRefs.current.delete(key);
                                    }}
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
                                    tabIndex={active ? 0 : -1}
                                    onFocus={() => {
                                        if (!option.disabled) setActiveValue(option.value);
                                    }}
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
                </div>
            </div>,
            document.body,
        )
        : null;

    return (
        <div ref={rootRef} className={joinClassNames(styles.root, open && styles.open, disabled && styles.disabled, className)}>
            <button
                ref={openerRef}
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
            {overlay}
        </div>
    );
}
