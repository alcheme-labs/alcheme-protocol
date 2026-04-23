'use client';

import { MessageSquare } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import styles from './ChatRecordBubble.module.css';

export interface ChatRecordMessage {
    author: string;
    text: string;
}

interface ChatRecordBubbleProps {
    /** Source circle name */
    sourceCircle: string;
    /** Messages in the record (shows first 3 as preview) */
    messages: ChatRecordMessage[];
    /** Who forwarded it */
    forwardedBy: string;
    /** Click handler for expanding the record */
    onClick?: () => void;
}

const MAX_PREVIEW = 3;

export default function ChatRecordBubble({
    sourceCircle,
    messages,
    onClick,
}: ChatRecordBubbleProps) {
    const t = useI18n('ChatRecordBubble');
    const preview = messages.slice(0, MAX_PREVIEW);
    const remaining = messages.length - MAX_PREVIEW;

    return (
        <div className={styles.chatRecordCard} onClick={onClick}>
            <div className={styles.chatRecordSource}>
                <MessageSquare size={12} className={styles.chatRecordSourceIcon} />
                {t('source', { circle: sourceCircle })}
            </div>

            <div className={styles.chatRecordMessages}>
                {preview.map((m, i) => (
                    <div key={i} className={styles.chatRecordMsgRow}>
                        <span className={styles.chatRecordMsgAuthor}>
                            {m.author.replace(/\.sol$/, '')}:
                        </span>
                        <span className={styles.chatRecordMsgText}>{m.text}</span>
                    </div>
                ))}
                {remaining > 0 && (
                    <span className={styles.chatRecordMore}>{t('more', { count: remaining })}</span>
                )}
            </div>

            <div className={styles.chatRecordFooter}>
                <span className={styles.chatRecordCount}>
                    {t('count', { count: messages.length })}
                </span>
                <span className={styles.chatRecordViewAll}>
                    {t('actions.viewAll')}
                </span>
            </div>
        </div>
    );
}
