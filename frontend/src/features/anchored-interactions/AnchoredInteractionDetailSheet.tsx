'use client';

import { X } from 'lucide-react';

import type {
    AnchoredInteractionDetailDto,
    PlazaAnchoredInteractionType,
} from './types.ts';
import styles from './AnchoredInteractionCard.module.css';

interface AnchoredInteractionDetailSheetProps {
    open: boolean;
    detail: AnchoredInteractionDetailDto | null;
    busy: boolean;
    errorMessage: string | null;
    titleLabel: string;
    closeLabel: string;
    loadingLabel: string;
    labels: {
        anchor: string;
        participation: string;
        result: string;
        events: string;
        receipts: string;
        actions: string;
        noSource: string;
        noEvents: string;
        noReceipts: string;
        audit: string;
        actorPubkey: string;
        recipientPubkey: string;
        signature: string;
        assetType: string;
        mint: string;
        createdAt: string;
        disclaimer: string;
        sameNameMember: string;
        eventKinds: Record<string, string>;
    };
    receiptStatusLabels: Record<string, string>;
    typeLabels: Record<PlazaAnchoredInteractionType, string>;
    statusLabel: string | null;
    resultStatusLabel: string | null;
    liveResultLabel: string | null;
    availableActions: string[];
    onClose: () => void;
}

export default function AnchoredInteractionDetailSheet({
    open,
    detail,
    busy,
    errorMessage,
    titleLabel,
    closeLabel,
    loadingLabel,
    labels,
    receiptStatusLabels,
    typeLabels,
    statusLabel,
    resultStatusLabel,
    liveResultLabel,
    availableActions,
    onClose,
}: AnchoredInteractionDetailSheetProps) {
    if (!open) return null;

    const anchorPreview = detail?.sourceMessage?.text || detail?.interaction.anchor.ref || null;
    const participationList = detail?.events.filter((event) => event.eventKind !== 'plaza_interaction_created') || [];
    const resultStatus = resultStatusLabel || detail?.interaction.resultStatus || null;
    const finalResultText = detail
        ? detail.resultNotice?.text || detail.interaction.resultNoticeEnvelopeId || null
        : null;
    const sourceEvents = detail?.events || [];
    const receipt = detail?.receipts[0] || null;

    return (
        <div className={styles.sheetOverlay} data-msg-action="1">
            <div className={styles.composerSheet}>
                <div className={styles.sheetHandle} />
                <div className={styles.sheetHeader}>
                    <strong>{titleLabel}</strong>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label={closeLabel}>
                        <X size={17} />
                    </button>
                </div>

                {busy && <p className={styles.footerNote}>{loadingLabel}</p>}
                {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}

                {detail && (
                    <div className={styles.detailStack}>
                        <section className={styles.detailSection}>
                            <div className={styles.detailSectionHeader}>
                                <span>{labels.anchor}</span>
                                <span className={styles.statusPill}>
                                    {typeLabels[detail.interaction.interactionType]}
                                </span>
                            </div>
                            <p className={styles.summaryText}>{anchorPreview || labels.noSource}</p>
                        </section>

                        <section className={styles.detailSection}>
                            <div className={styles.detailSectionHeader}>
                                <span>{labels.participation}</span>
                                {statusLabel && <span className={styles.statusPill}>{statusLabel}</span>}
                            </div>
                            {participationList.length > 0 ? (
                                <ul className={styles.detailList}>
                                    {participationList.map((event) => (
                                        <li key={event.eventId}>
                                            <span>{formatAnchoredInteractionEventLabel(event.eventKind, labels.eventKinds)}</span>
                                            <span>{event.actorEffectiveDisplayName || event.actorDisplayName || '-'}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className={styles.summaryText}>{labels.noEvents}</p>
                            )}
                        </section>

                        <section className={styles.detailSection}>
                            <div className={styles.detailSectionHeader}>
                                <span>{labels.result}</span>
                                {resultStatus && <span className={styles.statusPill}>{resultStatus}</span>}
                            </div>
                            {finalResultText && <p className={styles.summaryText}>{finalResultText}</p>}
                            {liveResultLabel && <p className={styles.summaryText}>{liveResultLabel}</p>}
                            {!finalResultText && !liveResultLabel && (
                                <p className={styles.summaryText}>{resultStatus || '-'}</p>
                            )}
                        </section>

                        <section className={styles.detailSection}>
                            <div className={styles.detailSectionHeader}>
                                <span>{labels.events}</span>
                                <span className={styles.statusPill}>{sourceEvents.length}</span>
                            </div>
                            {sourceEvents.length > 0 ? (
                                <ul className={styles.detailList}>
                                    {sourceEvents.map((event) => (
                                        <li key={event.eventId}>
                                            <span>{formatAnchoredInteractionEventLabel(event.eventKind, labels.eventKinds)}</span>
                                            <span>{event.createdAt}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className={styles.summaryText}>{labels.noEvents}</p>
                            )}
                        </section>

                        <section className={styles.detailSection}>
                            <div className={styles.detailSectionHeader}>
                                <span>{labels.receipts}</span>
                                {receipt && <span className={styles.statusPill}>{receiptStatusLabels[receipt.status] || receipt.status}</span>}
                            </div>
                            {receipt ? (
                                <>
                                    <p className={styles.summaryText}>
                                        {formatReceiptDisplay(receipt, labels.sameNameMember)}
                                    </p>
                                    <details className={styles.auditDetails}>
                                        <summary>{labels.audit}</summary>
                                        <dl className={styles.auditList}>
                                            <dt>{labels.actorPubkey}</dt>
                                            <dd>{receipt.actorPubkey}</dd>
                                            {receipt.recipientPubkey && (
                                                <>
                                                    <dt>{labels.recipientPubkey}</dt>
                                                    <dd>{receipt.recipientPubkey}</dd>
                                                </>
                                            )}
                                            {receipt.signature && (
                                                <>
                                                    <dt>{labels.signature}</dt>
                                                    <dd>{receipt.signature}</dd>
                                                </>
                                            )}
                                            {receipt.assetType && (
                                                <>
                                                    <dt>{labels.assetType}</dt>
                                                    <dd>{receipt.assetType}</dd>
                                                </>
                                            )}
                                            {receipt.mint && (
                                                <>
                                                    <dt>{labels.mint}</dt>
                                                    <dd>{receipt.mint}</dd>
                                                </>
                                            )}
                                            {receipt.createdAt && (
                                                <>
                                                    <dt>{labels.createdAt}</dt>
                                                    <dd>{receipt.createdAt}</dd>
                                                </>
                                            )}
                                        </dl>
                                        <p className={styles.footerNote}>{labels.disclaimer}</p>
                                    </details>
                                </>
                            ) : (
                                <p className={styles.summaryText}>{labels.noReceipts}</p>
                            )}
                        </section>

                        <section className={styles.detailSection}>
                            <div className={styles.detailSectionHeader}>
                                <span>{labels.actions}</span>
                            </div>
                            <div className={styles.actionRow}>
                                {availableActions.map((action) => (
                                    <span key={action} className={styles.statusPill}>{action}</span>
                                ))}
                            </div>
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatAnchoredInteractionEventLabel(eventKind: string, eventKindLabels: Record<string, string>): string {
    return eventKindLabels[eventKind] || eventKindLabels.unknown || 'Interaction event';
}

function formatReceiptDisplay(
    receipt: AnchoredInteractionDetailDto['receipts'][number],
    sameNameMemberLabel: string,
): string {
    const actor = withDisambiguation(
        receipt.actorDisplaySnapshot || receipt.actorEffectiveDisplayName || receipt.actorDisplayName || 'A member',
        Boolean((receipt as unknown as Record<string, unknown>).actorNeedsDisplayDisambiguation),
        sameNameMemberLabel,
    );
    const recipient = withDisambiguation(
        receipt.recipientDisplaySnapshot || receipt.recipientEffectiveDisplayName || receipt.recipientDisplayName || '',
        Boolean((receipt as unknown as Record<string, unknown>).recipientNeedsDisplayDisambiguation),
        sameNameMemberLabel,
    ) || null;
    const asset = receipt.assetType || receipt.receiptType;
    const amount = receipt.amount || '';
    const actorPart = recipient ? `${actor} -> ${recipient}` : actor;
    return `${actorPart} · ${asset} ${amount}`.trim();
}

function withDisambiguation(name: string, needsDisambiguation: boolean, sameNameMemberLabel: string): string {
    if (!name || !needsDisambiguation) return name;
    return `${name} (${sameNameMemberLabel})`;
}
