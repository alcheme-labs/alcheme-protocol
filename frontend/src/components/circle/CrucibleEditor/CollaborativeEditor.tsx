'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { useI18n } from '@/i18n/useI18n';
import KnowledgeReferencePicker from '@/components/circle/KnowledgeReferencePicker/KnowledgeReferencePicker';
import {
    formatCrystalReferenceMarkup,
    type KnowledgeReferenceOption,
} from '@/lib/circle/knowledgeReferenceOptions';
import {
    buildKnowledgeReferenceInsertion,
    detectActiveKnowledgeReferenceQuery,
} from './referenceInsertion';
import styles from './CollaborativeEditor.module.css';

interface CollaborativeEditorInsertReferenceRequest {
    token: number;
    option: KnowledgeReferenceOption;
}

interface CollaborativeEditorProps {
    ydoc: Y.Doc;
    initialContent?: string;
    replaceRequest?: {
        token: number;
        content: string;
    } | null;
    editable?: boolean;
    onUpdate?: (content: string) => void;
    onSelectionParagraphChange?: (paragraphIndex: number | null) => void;
    placeholder?: string;
    field?: string;
    compact?: boolean;
    knowledgeReferenceOptions?: KnowledgeReferenceOption[];
    insertReferenceRequest?: CollaborativeEditorInsertReferenceRequest | null;
    onKnowledgeReferenceInserted?: (option: KnowledgeReferenceOption) => void;
}

function resolveParagraphIndex(editor: Editor): number | null {
    const selectionFrom = editor.state.selection.from;
    let paragraphIndex = 0;
    let matched: number | null = null;
    editor.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        const start = pos + 1;
        const end = pos + node.nodeSize - 1;
        if (selectionFrom >= start && selectionFrom <= end) {
            matched = paragraphIndex;
            return false;
        }
        paragraphIndex += 1;
        return true;
    });
    return matched;
}

function EditorToolbar({
    editor,
    t,
}: {
    editor: Editor | null;
    t: ReturnType<typeof useI18n>;
}) {
    if (!editor) return null;

    const btnClass = (active: boolean) =>
        `${styles.toolbarBtn} ${active ? styles.toolbarBtnActive : ''}`;

    return (
        <div className={styles.toolbar}>
            <button
                type="button"
                className={btnClass(editor.isActive('bold'))}
                onClick={() => editor.chain().focus().toggleBold().run()}
                title={t('toolbar.bold')}
            >
                <strong>B</strong>
            </button>
            <button
                type="button"
                className={btnClass(editor.isActive('italic'))}
                onClick={() => editor.chain().focus().toggleItalic().run()}
                title={t('toolbar.italic')}
            >
                <em>I</em>
            </button>
            <button
                type="button"
                className={btnClass(editor.isActive('strike'))}
                onClick={() => editor.chain().focus().toggleStrike().run()}
                title={t('toolbar.strike')}
            >
                <s>S</s>
            </button>

            <div className={styles.toolbarDivider} />

            <button
                type="button"
                className={btnClass(editor.isActive('heading', { level: 2 }))}
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                title={t('toolbar.heading')}
            >
                H2
            </button>
            <button
                type="button"
                className={btnClass(editor.isActive('heading', { level: 3 }))}
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                title={t('toolbar.subheading')}
            >
                H3
            </button>

            <div className={styles.toolbarDivider} />

            <button
                type="button"
                className={btnClass(editor.isActive('bulletList'))}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
                title={t('toolbar.bulletList')}
            >
                •
            </button>
            <button
                type="button"
                className={btnClass(editor.isActive('orderedList'))}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
                title={t('toolbar.orderedList')}
            >
                1.
            </button>
            <button
                type="button"
                className={btnClass(editor.isActive('blockquote'))}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
                title={t('toolbar.blockquote')}
            >
                &ldquo;
            </button>
            <button
                type="button"
                className={btnClass(editor.isActive('codeBlock'))}
                onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                title={t('toolbar.codeBlock')}
            >
                {'</>'}
            </button>

            <div className={styles.toolbarDivider} />

            <button
                type="button"
                className={btnClass(editor.isActive('highlight'))}
                onClick={() => editor.chain().focus().toggleHighlight().run()}
                title={t('toolbar.highlight')}
            >
                🖍
            </button>
        </div>
    );
}

export default function CollaborativeEditor({
    ydoc,
    initialContent,
    replaceRequest = null,
    editable = true,
    onUpdate,
    onSelectionParagraphChange,
    placeholder,
    field = 'default',
    compact = false,
    knowledgeReferenceOptions = [],
    insertReferenceRequest = null,
    onKnowledgeReferenceInserted,
}: CollaborativeEditorProps) {
    const t = useI18n('CollaborativeEditor');
    const lastAppliedReplaceTokenRef = useRef<number | null>(null);
    const lastAppliedInsertTokenRef = useRef<number | null>(null);
    const dismissedInlinePickerRef = useRef(false);
    const [activeReferenceQuery, setActiveReferenceQuery] = useState<string | null>(null);

    const syncActiveReferenceQuery = useCallback((editorInstance: Editor) => {
        if (!editable || knowledgeReferenceOptions.length === 0) {
            dismissedInlinePickerRef.current = false;
            setActiveReferenceQuery(null);
            return;
        }

        const selectionStart = editorInstance.state.selection.$from.parentOffset;
        const textBeforeCursor = editorInstance.state.selection.$from.parent.textBetween(0, selectionStart, '\n', '\n');
        const activeQuery = detectActiveKnowledgeReferenceQuery(textBeforeCursor);

        if (!activeQuery) {
            dismissedInlinePickerRef.current = false;
            setActiveReferenceQuery(null);
            return;
        }

        if (dismissedInlinePickerRef.current) {
            setActiveReferenceQuery(null);
            return;
        }

        setActiveReferenceQuery(activeQuery.query);
    }, [editable, knowledgeReferenceOptions.length]);

    const applyKnowledgeReference = useCallback((editorInstance: Editor, option: KnowledgeReferenceOption) => {
        const selectionStart = editorInstance.state.selection.$from.parentOffset;
        const selectionEnd = editorInstance.state.selection.$to.parentOffset;
        const parentNode = editorInstance.state.selection.$from.parent;
        const parentStart = editorInstance.state.selection.$from.start();
        const textBeforeCursor = parentNode.textBetween(0, selectionStart, '\n', '\n');
        const activeQuery = detectActiveKnowledgeReferenceQuery(textBeforeCursor);
        const insertionStart = activeQuery
            ? Math.max(0, selectionStart - activeQuery.token.length)
            : selectionStart;
        const paragraphText = parentNode.textBetween(0, parentNode.content.size, '\n', '\n');
        const insertion = buildKnowledgeReferenceInsertion(
            paragraphText.slice(0, insertionStart),
            paragraphText.slice(selectionEnd),
            formatCrystalReferenceMarkup(option),
        );
        const absoluteFrom = parentStart + insertionStart;
        const absoluteTo = parentStart + selectionEnd;

        editorInstance.chain()
            .focus()
            .insertContentAt({ from: absoluteFrom, to: absoluteTo }, insertion.insertedText)
            .setTextSelection(absoluteFrom + insertion.cursorOffset)
            .run();
        dismissedInlinePickerRef.current = false;
        setActiveReferenceQuery(null);
        onKnowledgeReferenceInserted?.(option);
    }, [onKnowledgeReferenceInserted]);

    const handleUpdate = useCallback(({ editor }: { editor: Editor }) => {
        onUpdate?.(editor.getText());
        syncActiveReferenceQuery(editor);
    }, [onUpdate, syncActiveReferenceQuery]);

    const emitSelectionParagraph = useCallback((editorInstance: Editor) => {
        if (!onSelectionParagraphChange) return;
        onSelectionParagraphChange(resolveParagraphIndex(editorInstance));
    }, [onSelectionParagraphChange]);

    const resolvedPlaceholder = placeholder || t('placeholder');

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                undoRedo: false,
            }),
            Highlight.configure({
                multicolor: false,
            }),
            Placeholder.configure({
                placeholder: resolvedPlaceholder,
            }),
            Collaboration.configure({
                document: ydoc,
                field,
            }),
        ],
        editable,
        onUpdate: handleUpdate,
        onCreate: ({ editor: createdEditor }) => {
            emitSelectionParagraph(createdEditor);
            syncActiveReferenceQuery(createdEditor);
        },
        onSelectionUpdate: ({ editor: activeEditor }) => {
            emitSelectionParagraph(activeEditor);
            syncActiveReferenceQuery(activeEditor);
        },
        immediatelyRender: false,
        editorProps: {
            attributes: {
                class: `${styles.prosemirror} ${compact ? styles.prosemirrorCompact : ''}`.trim(),
                spellcheck: 'false',
            },
        },
    });

    useEffect(() => {
        if (!editor) return;
        const normalizedInitialContent = String(initialContent || '').trim();
        if (!normalizedInitialContent) return;
        if (editor.getText().trim().length > 0) return;
        const yjsFragment = ydoc.getXmlFragment(field);
        if (yjsFragment.length > 0) return;
        editor.commands.setContent(normalizedInitialContent);
    }, [editor, field, initialContent, ydoc]);

    useEffect(() => {
        if (!editor || !replaceRequest) return;
        if (lastAppliedReplaceTokenRef.current === replaceRequest.token) return;
        const normalized = String(replaceRequest.content || '').trim();
        if (!normalized) return;
        editor.commands.setContent(normalized);
        lastAppliedReplaceTokenRef.current = replaceRequest.token;
        emitSelectionParagraph(editor);
    }, [editor, emitSelectionParagraph, replaceRequest]);

    useEffect(() => {
        if (!editor || !insertReferenceRequest) return;
        if (lastAppliedInsertTokenRef.current === insertReferenceRequest.token) return;
        applyKnowledgeReference(editor, insertReferenceRequest.option);
        lastAppliedInsertTokenRef.current = insertReferenceRequest.token;
    }, [applyKnowledgeReference, editor, insertReferenceRequest]);

    return (
        <div className={`${styles.editorWrapper} ${!editable ? styles.readOnly : ''} ${compact ? styles.editorWrapperCompact : ''}`.trim()}>
            {editable && <EditorToolbar editor={editor} t={t} />}
            <EditorContent editor={editor} className={`${styles.editorContent} ${compact ? styles.editorContentCompact : ''}`.trim()} />
            {editable && activeReferenceQuery !== null && knowledgeReferenceOptions.length > 0 && (
                <div className={styles.inlineReferencePicker}>
                    <KnowledgeReferencePicker
                        options={knowledgeReferenceOptions}
                        query={activeReferenceQuery}
                        searchDisabled
                        onSelect={(option) => {
                            if (!editor) return;
                            applyKnowledgeReference(editor, option);
                        }}
                        onClose={() => {
                            dismissedInlinePickerRef.current = true;
                            setActiveReferenceQuery(null);
                            editor?.commands.focus();
                        }}
                    />
                </div>
            )}
        </div>
    );
}
