'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Bot, CornerDownLeft, Copy, Trash2, ArrowUpRight, Plus, Lightbulb, HandCoins, ListChecks } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import styles from './MessageActionSheet.module.css';

interface MessageActionSheetProps {
    open: boolean;
    messageId: number | null;
    isMine: boolean;
    onReply?: () => void;
    onAskAi?: () => void;
    onMarkUseful?: () => void;
    onUnmarkUseful?: () => void;
    onTip?: () => void;
    onForward?: () => void;
    forwardDisabledReason?: string | null;
    forwardLabel?: string;
    onSelectMessages?: () => void;
    selectMessagesLabel?: string;
    onCreateInteraction?: () => void;
    onCopy: () => void;
    onDelete: () => void;
    onClose: () => void;
}

export default function MessageActionSheet({
    open,
    isMine,
    onReply,
    onAskAi,
    onMarkUseful,
    onUnmarkUseful,
    onTip,
    onForward,
    forwardDisabledReason,
    forwardLabel,
    onSelectMessages,
    selectMessagesLabel,
    onCreateInteraction,
    onCopy,
    onDelete,
    onClose,
}: MessageActionSheetProps) {
    const t = useI18n('MessageActionSheet');
    const resolvedForwardLabel = forwardLabel ?? t('actions.forward');
    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.actionSheetOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={styles.actionSheet}
                        initial={{ y: 200, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 200, opacity: 0 }}
                        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={styles.actionSheetHandle} />

                        <div className={styles.actionSheetRow}>
                            {onReply && (
                                <button className={styles.actionSheetBtn} onClick={onReply}>
                                    <CornerDownLeft size={20} className={styles.actionSheetIcon} />
                                    {t('actions.reply')}
                                </button>
                            )}
                            {onAskAi && (
                                <button className={styles.actionSheetBtn} onClick={onAskAi}>
                                    <Bot size={20} className={styles.actionSheetIcon} />
                                    {t('actions.askAi')}
                                </button>
                            )}
                            {(onMarkUseful || onUnmarkUseful) && (
                                <button className={styles.actionSheetBtn} onClick={onUnmarkUseful || onMarkUseful}>
                                    <Lightbulb size={20} className={styles.actionSheetIcon} />
                                    {onUnmarkUseful ? t('actions.unmarkUseful') : t('actions.markUseful')}
                                </button>
                            )}
                            {onTip && (
                                <button className={styles.actionSheetBtn} onClick={onTip}>
                                    <HandCoins size={20} className={styles.actionSheetIcon} />
                                    {t('actions.tip')}
                                </button>
                            )}
                            {(onForward || forwardDisabledReason) && (
                                <button
                                    data-testid="message-action-forward"
                                    className={`${styles.actionSheetBtn} ${!onForward ? styles.actionSheetBtnDisabled : ''}`}
                                    disabled={!onForward}
                                    title={forwardDisabledReason || resolvedForwardLabel}
                                    aria-label={forwardDisabledReason || resolvedForwardLabel}
                                    onClick={onForward}
                                >
                                    <ArrowUpRight size={20} className={styles.actionSheetIcon} />
                                    {resolvedForwardLabel}
                                </button>
                            )}
                            {onSelectMessages && (
                                <button
                                    data-testid="message-action-select-messages"
                                    className={styles.actionSheetBtn}
                                    onClick={onSelectMessages}
                                >
                                    <ListChecks size={20} className={styles.actionSheetIcon} />
                                    {selectMessagesLabel ?? t('actions.selectMessages')}
                                </button>
                            )}
                            {onCreateInteraction && (
                                <button className={styles.actionSheetBtn} onClick={onCreateInteraction}>
                                    <Plus size={20} className={styles.actionSheetIcon} />
                                    {t('actions.createInteraction')}
                                </button>
                            )}
                            <button className={styles.actionSheetBtn} onClick={onCopy}>
                                <Copy size={20} className={styles.actionSheetIcon} />
                                {t('actions.copy')}
                            </button>
                            {isMine && (
                                <button className={styles.actionSheetBtn} onClick={onDelete}>
                                    <Trash2 size={20} className={styles.actionSheetIcon} />
                                    {t('actions.delete')}
                                </button>
                            )}
                        </div>

                        <button className={styles.actionSheetCancel} onClick={onClose}>
                            {t('actions.cancel')}
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
