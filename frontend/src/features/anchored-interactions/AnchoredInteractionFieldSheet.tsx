'use client';

import { X } from 'lucide-react';

import type { PlazaAnchoredInteractionType } from './types.ts';
import type { PlazaAnchoredInteractionStatus } from './types.ts';
import type { AnchoredInteractionFieldGroup, AnchoredInteractionFieldItem } from './useAnchoredInteractionField.ts';
import styles from '@/app/(main)/circles/[id]/page.module.css';

export default function AnchoredInteractionFieldSheet({
    open,
    title,
    closeLabel,
    anchorLabels,
    groups,
    typeLabels,
    statusLabels,
    onSelect,
    onClose,
}: {
    open: boolean;
    title: string;
    closeLabel: string;
    anchorLabels: {
        discussionMessage: string;
        freeform: string;
    };
    groups: AnchoredInteractionFieldGroup[];
    typeLabels: Record<PlazaAnchoredInteractionType, string>;
    statusLabels: Record<PlazaAnchoredInteractionStatus, string>;
    onSelect: (item: AnchoredInteractionFieldItem) => void;
    onClose: () => void;
}) {
    if (!open) return null;
    return (
        <div className={styles.interactionFieldSheetOverlay} data-msg-action="1">
            <div className={styles.interactionFieldSheet}>
                <div className={styles.interactionFieldSheetHeader}>
                    <strong>{title}</strong>
                    <button
                        type="button"
                        className={styles.interactionFieldSheetClose}
                        onClick={onClose}
                        aria-label={closeLabel}
                    >
                        <X size={16} />
                    </button>
                </div>
                <div className={styles.interactionFieldGroupList}>
                    {groups.map((group) => (
                        <section key={group.anchorKey} className={styles.interactionFieldGroup}>
                            <span>
                                {group.anchorType === 'freeform'
                                    ? anchorLabels.freeform
                                    : anchorLabels.discussionMessage}
                            </span>
                            {group.items.map((item) => (
                                <button
                                    key={item.interaction.interactionId}
                                    type="button"
                                    onClick={() => onSelect(item)}
                                >
                                    <span>{typeLabels[item.interaction.interactionType]}</span>
                                    <small>{statusLabels[item.interaction.status]}</small>
                                </button>
                            ))}
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
