'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDiscussionDraftContent, saveDiscussionDraftContent } from '@/lib/api/draftRuntime';
import { splitCrucibleParagraphContent } from '@/lib/circle/crucibleViewModel';
import { flushComposeDraftSave } from '@/lib/compose/composeDraftSession';
import { useI18n } from '@/i18n/useI18n';
import styles from './ComposeDraftEditor.module.css';

const SAVE_DEBOUNCE_MS = 400;

type ComposeDraftEditorProps = {
    draftPostId: number;
    circleId: number;
};

function parseComposeDraft(text: string): { title: string; paragraphs: string[] } {
    const parts = splitCrucibleParagraphContent(text);
    if (!String(text || '').trim() || parts.length <= 1) {
        return { title: '', paragraphs: parts.length > 0 ? parts : [''] };
    }
    return {
        title: parts[0] || '',
        paragraphs: parts.slice(1),
    };
}

function serializeComposeDraft(title: string, paragraphs: string[]): string {
    return [title, ...paragraphs]
        .map((part) => part.replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
}

function persistComposeDraftText({
    text,
    draftPostId,
    workingCopyHash,
    onHash,
}: {
    text: string;
    draftPostId: number;
    workingCopyHash: string | null;
    onHash?: (hash: string) => void;
}): void {
    flushComposeDraftSave({
        text,
        draftPostId,
        workingCopyHash,
        save: (id, nextText, hash) => {
            void saveDiscussionDraftContent(id, nextText, undefined, { workingCopyHash: hash }).then((payload) => {
                if (payload.workingCopyHash) {
                    onHash?.(payload.workingCopyHash);
                }
            }).catch(() => {});
        },
    });
}

export default function ComposeDraftEditor({
    draftPostId,
    circleId,
}: ComposeDraftEditorProps) {
    const t = useI18n('ComposePage');
    const [title, setTitle] = useState('');
    const [paragraphs, setParagraphs] = useState<string[]>(['']);
    const saveTimerRef = useRef<number | null>(null);
    const titleRef = useRef('');
    const paragraphsRef = useRef<string[]>(['']);
    const workingCopyHashRef = useRef<string | null>(null);
    const dirtyRef = useRef(false);

    const persistDraft = useCallback((nextTitle: string, nextParagraphs: string[]) => {
        persistComposeDraftText({
            text: serializeComposeDraft(nextTitle, nextParagraphs),
            draftPostId,
            workingCopyHash: workingCopyHashRef.current,
            onHash: (hash) => {
                workingCopyHashRef.current = hash;
            },
        });
    }, [draftPostId]);

    useEffect(() => {
        let ignoreHydrate = false;
        dirtyRef.current = false;
        workingCopyHashRef.current = null;

        void fetchDiscussionDraftContent(draftPostId).then((payload) => {
            if (!payload) {
                return;
            }
            workingCopyHashRef.current = payload.workingCopyHash;
            if (!ignoreHydrate && !dirtyRef.current) {
                const parsed = parseComposeDraft(payload.text ?? '');
                setTitle(parsed.title);
                setParagraphs(parsed.paragraphs);
                titleRef.current = parsed.title;
                paragraphsRef.current = parsed.paragraphs;
            }
            if (dirtyRef.current) {
                persistDraft(titleRef.current, paragraphsRef.current);
            }
        }).catch(() => {});

        return () => {
            ignoreHydrate = true;
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            persistComposeDraftText({
                text: serializeComposeDraft(titleRef.current, paragraphsRef.current),
                draftPostId,
                workingCopyHash: workingCopyHashRef.current,
            });
        };
    }, [draftPostId, persistDraft]);

    const scheduleSave = useCallback((nextTitle: string, nextParagraphs: string[]) => {
        dirtyRef.current = true;
        titleRef.current = nextTitle;
        paragraphsRef.current = nextParagraphs;
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = window.setTimeout(() => {
            saveTimerRef.current = null;
            persistDraft(nextTitle, nextParagraphs);
        }, SAVE_DEBOUNCE_MS);
    }, [persistDraft]);

    const handleTitleChange = (value: string) => {
        setTitle(value);
        scheduleSave(value, paragraphsRef.current);
    };

    const handleParagraphChange = (index: number, value: string) => {
        const nextParagraphs = paragraphsRef.current.map((paragraph, itemIndex) => (
            itemIndex === index ? value : paragraph
        ));
        setParagraphs(nextParagraphs);
        scheduleSave(titleRef.current, nextParagraphs);
    };

    const handleAddParagraph = () => {
        const nextParagraphs = [...paragraphsRef.current, ''];
        setParagraphs(nextParagraphs);
        scheduleSave(titleRef.current, nextParagraphs);
    };

    return (
        <div className={styles.root} data-testid="compose-draft-editor" data-circle-id={circleId}>
            <input
                className={styles.titleInput}
                data-testid="compose-draft-title"
                value={title}
                onChange={(event) => handleTitleChange(event.target.value)}
                placeholder={t('draftEditor.titlePlaceholder')}
                autoComplete="off"
            />
            {paragraphs.map((paragraph, index) => (
                <label key={index} className={styles.paragraph}>
                    <span className={styles.paragraphLabel}>{t('draftEditor.paragraphLabel', { index: index + 1 })}</span>
                    <textarea
                        className={styles.bodyInput}
                        data-testid={`compose-draft-paragraph-${index}`}
                        value={paragraph}
                        rows={4}
                        onChange={(event) => handleParagraphChange(index, event.target.value)}
                        placeholder={t('draftEditor.bodyPlaceholder')}
                    />
                </label>
            ))}
            <button
                type="button"
                className={styles.addParagraph}
                onClick={handleAddParagraph}
            >
                {t('draftEditor.addParagraph')}
            </button>
        </div>
    );
}
