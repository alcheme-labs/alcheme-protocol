'use client';

import { useState, type ReactNode, Ref } from 'react';

import styles from './ScenarioComposeSurface.module.css';

export type ScenarioComposeSurfaceProps = {
    scenarioKey: string;
    title: string;
    body?: string;
    detail?: ReactNode;
    status: 'available' | 'waiting' | 'blocked' | 'completed';
    collapsed: boolean;
    onCollapsedChange: (value: boolean) => void;
    /** Interactive portal mode: leave null so Dock does not render a second gold CTA. */
    primaryAction: null | {
        label: string;
        onClick?: () => void;
        href?: string;
        disabled?: boolean;
        disabledHint?: string;
        loading?: boolean;
    };
    showDock: boolean;
    dockSlotRef?: Ref<HTMLDivElement>;
    eyebrow?: string;
    collapseLabel?: string;
    expandLabel?: string;
    detailLabel?: string;
    statusLabel?: string;
};

export default function ScenarioComposeSurface({
    scenarioKey,
    title,
    body,
    detail,
    status,
    collapsed,
    onCollapsedChange,
    primaryAction,
    showDock,
    dockSlotRef,
    eyebrow,
    collapseLabel = 'Collapse',
    expandLabel = 'Expand',
    detailLabel = 'Details',
    statusLabel,
}: ScenarioComposeSurfaceProps) {
    const [detailOpen, setDetailOpen] = useState(false);
    if (status === 'completed') return null;

    const waitingOrBlocked = status === 'waiting' || status === 'blocked';
    const showDetailBody = Boolean(detail) && (waitingOrBlocked || detailOpen);

    if (collapsed) {
        return (
            <button
                type="button"
                className={styles.chip}
                data-compose-scenario={scenarioKey}
                data-compose-chip=""
                onClick={() => onCollapsedChange(false)}
            >
                <span>{expandLabel}</span>
                <strong>{title}</strong>
            </button>
        );
    }

    return (
        <>
            <section
                className={styles.rail}
                data-compose-scenario={scenarioKey}
                data-compose-rail=""
                data-case-current-task={status}
                aria-live="polite"
                aria-atomic="true"
            >
                {eyebrow ? <p className={styles.railEyebrow}>{eyebrow}</p> : null}
                <h2 className={styles.railTitle} id="case-focus-title">{title}</h2>
                {statusLabel ? <p className={styles.railMeta}>{statusLabel}</p> : null}
                {body ? <p className={styles.railBody}>{body}</p> : null}
                <div className={styles.railToolbar}>
                    {detail && !waitingOrBlocked ? (
                        <button
                            type="button"
                            className={styles.ghostButton}
                            aria-expanded={detailOpen}
                            onClick={() => setDetailOpen((open) => !open)}
                        >
                            {detailLabel}
                        </button>
                    ) : (
                        <span className={styles.railToolbarSpacer} aria-hidden="true" />
                    )}
                    <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => onCollapsedChange(true)}
                    >
                        {collapseLabel}
                    </button>
                </div>
                {showDetailBody ? <div className={styles.detail}>{detail}</div> : null}
            </section>
            {showDock ? (
                <div
                    className={styles.dock}
                    data-compose-dock=""
                    data-compose-scenario={scenarioKey}
                >
                    <div
                        id="case-compose-dock"
                        className={styles.dockRoot}
                        ref={dockSlotRef}
                        data-compose-dock-root=""
                    />
                    {primaryAction ? (
                        <div className={styles.dockCtaRow}>
                            {primaryAction.href ? (
                                <a className={styles.primaryButton} href={primaryAction.href}>
                                    {primaryAction.loading ? '…' : primaryAction.label}
                                </a>
                            ) : (
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    disabled={primaryAction.disabled || primaryAction.loading}
                                    onClick={primaryAction.onClick}
                                >
                                    {primaryAction.loading ? '…' : primaryAction.label}
                                </button>
                            )}
                            {primaryAction.disabled && primaryAction.disabledHint ? (
                                <p className={styles.disabledHint} role="status">
                                    {primaryAction.disabledHint}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}
