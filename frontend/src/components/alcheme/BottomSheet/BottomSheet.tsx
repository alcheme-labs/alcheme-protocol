'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import styles from './BottomSheet.module.css';

export interface BottomSheetProps {
    open: boolean;
    title: string;
    closeLabel: string;
    children: ReactNode;
    footer?: ReactNode;
    layer?: 'default' | 'nested';
    className?: string;
    contentClassName?: string;
    onClose: () => void;
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
}

const MotionModalOverlay = motion.create(ModalOverlay);
const MotionModal = motion.create(Modal);

export default function BottomSheet({
    open,
    title,
    closeLabel,
    children,
    footer,
    layer = 'default',
    className,
    contentClassName,
    onClose,
}: BottomSheetProps) {
    return (
        <AnimatePresence>
            {open && (
                <MotionModalOverlay
                    key="bottom-sheet-overlay"
                    isOpen
                    isDismissable
                    className={joinClassNames(styles.overlay, layer === 'nested' && styles.overlayNested)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onOpenChange={(nextOpen) => {
                        if (!nextOpen) onClose();
                    }}
                >
                    <MotionModal
                        className={joinClassNames(styles.sheet, className)}
                        initial={{ y: 300, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 300, opacity: 0 }}
                        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <Dialog className={styles.dialog} aria-label={title}>
                            <div className={styles.handle} aria-hidden="true" />
                            <header className={styles.header}>
                                <Heading className={styles.title} slot="title">
                                    {title}
                                </Heading>
                                <button type="button" className={styles.closeButton} onClick={onClose} aria-label={closeLabel}>
                                    <X size={16} />
                                </button>
                            </header>
                            <div className={joinClassNames(styles.content, contentClassName)}>
                                {children}
                            </div>
                            {footer && <footer className={styles.footer}>{footer}</footer>}
                        </Dialog>
                    </MotionModal>
                </MotionModalOverlay>
            )}
        </AnimatePresence>
    );
}
