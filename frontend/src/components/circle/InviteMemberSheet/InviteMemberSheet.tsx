'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Check, UserPlus } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import styles from './InviteMemberSheet.module.css';

/* ═══ Types ═══ */

export interface InvitableUser {
    userId?: number;
    handle: string;
    name: string;
    role: 'curator' | 'member';
    alreadyIn?: boolean;
}

export interface InviteResultSummary {
    successCount: number;
    failureCount: number;
    errorMessage?: string | null;
}

interface InviteMemberSheetProps {
    open: boolean;
    targetCircleName: string;
    /** All users in the parent circle who can be invited */
    users: InvitableUser[];
    onClose: () => void;
    onInvite: (handles: string[]) => Promise<InviteResultSummary> | InviteResultSummary;
}

/* ═══ Component ═══ */

export default function InviteMemberSheet({
    open,
    targetCircleName,
    users,
    onClose,
    onInvite,
}: InviteMemberSheetProps) {
    const t = useI18n('InviteMemberSheet');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [showToast, setShowToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [inviteError, setInviteError] = useState<string | null>(null);

    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        if (!q) return users;
        return users.filter(
            (u) => u.name.toLowerCase().includes(q) || u.handle.toLowerCase().includes(q),
        );
    }, [users, search]);

    const toggle = (handle: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(handle)) next.delete(handle);
            else next.add(handle);
            return next;
        });
    };

    const handleSend = async () => {
        const handles = Array.from(selected);
        if (handles.length === 0 || submitting) return;
        setSubmitting(true);
        setInviteError(null);
        try {
            const result = await onInvite(handles);
            if (result.successCount > 0) {
                setToastMessage(
                    result.failureCount > 0
                        ? t('toast.partialSuccess', {
                            successCount: result.successCount,
                            failureCount: result.failureCount,
                        })
                        : t('toast.success', {count: result.successCount}),
                );
                setShowToast(true);
                setTimeout(() => {
                    setShowToast(false);
                }, 1800);
                setSearch('');
                setSelected(new Set());
                onClose();
                return;
            }
            setInviteError(result.errorMessage || t('errors.sendFailed'));
        } catch (error) {
            setInviteError(error instanceof Error ? error.message : t('errors.sendFailed'));
        } finally {
            setSubmitting(false);
        }
    };

    const handleClose = () => {
        if (submitting) return;
        setSearch('');
        setSelected(new Set());
        setInviteError(null);
        onClose();
    };

    return (
        <>
            <AnimatePresence>
                {open && (
                    <motion.div
                        className={styles.overlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        onClick={handleClose}
                    >
                        <motion.div
                            className={styles.sheet}
                            initial={{ y: 300, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 300, opacity: 0 }}
                            transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className={styles.handle} />

                            {/* Header */}
                            <div className={styles.header}>
                                <span className={styles.title}>
                                    <UserPlus size={16} style={{ verticalAlign: -2, marginRight: 6 }} />
                                    {t('title')}
                                </span>
                                <button className={styles.closeBtn} onClick={handleClose}>
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Target circle */}
                            <div className={styles.targetInfo}>
                                <span className={styles.targetLabel}>{t('target.label')}</span>
                                <span className={styles.targetName}>{targetCircleName}</span>
                            </div>

                            {/* Search */}
                            <div className={styles.search}>
                                <div style={{ position: 'relative' }}>
                                    <Search
                                        size={14}
                                        style={{
                                            position: 'absolute',
                                            left: 10,
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            opacity: 0.4,
                                        }}
                                    />
                                    <input
                                        className={styles.searchInput}
                                        placeholder={t('search.placeholder')}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        disabled={submitting}
                                        style={{ paddingLeft: 30 }}
                                    />
                                </div>
                            </div>

                            {inviteError && (
                                <div className={styles.errorBanner}>{inviteError}</div>
                            )}

                            {/* Member List */}
                            <div className={styles.list}>
                                {filtered.length === 0 ? (
                                    <div className={styles.empty}>{t('states.empty')}</div>
                                ) : (
                                    filtered.map((u) => {
                                        const isSelected = selected.has(u.handle);
                                        return (
                                            <motion.div
                                                key={u.handle}
                                                className={styles.memberItem}
                                                onClick={() => !u.alreadyIn && !submitting && toggle(u.handle)}
                                                /* §6 物理感: 点击=触碰石材, 轻微下沉, 不弹跳 */
                                                whileTap={u.alreadyIn || submitting ? undefined : { y: 1 }}
                                                style={{ opacity: u.alreadyIn ? 0.4 : 1 }}
                                            >
                                                <div
                                                    className={`${styles.checkbox} ${isSelected ? styles.checkboxSelected : ''}`}
                                                >
                                                    {isSelected && (
                                                        <Check size={12} color="#1f2421" strokeWidth={3} />
                                                    )}
                                                </div>
                                                <div className={styles.avatar}>
                                                    {u.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className={styles.memberInfo}>
                                                    <div className={styles.memberName}>{u.name}</div>
                                                    <div className={styles.memberHandle}>@{u.handle}</div>
                                                </div>
                                                {u.alreadyIn ? (
                                                    <span className={styles.alreadyIn}>{t('states.alreadyIn')}</span>
                                                ) : (
                                                    <span
                                                        className={`${styles.memberRole} ${u.role === 'curator'
                                                                ? styles.roleCurator
                                                                : styles.roleMember
                                                            }`}
                                                    >
                                                        {t(`roles.${u.role}`)}
                                                    </span>
                                                )}
                                            </motion.div>
                                        );
                                    })
                                )}
                            </div>

                            {/* Footer */}
                            <div className={styles.footer}>
                                <button className={styles.footerBtnSecondary} onClick={handleClose}>
                                    {t('actions.cancel')}
                                </button>
                                <button
                                    className={styles.footerBtnPrimary}
                                    onClick={() => { void handleSend(); }}
                                    disabled={selected.size === 0 || submitting}
                                >
                                    {submitting
                                        ? t('actions.sending')
                                        : t('actions.send', {count: selected.size})}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Toast — static fade, no decoration animation (§10 活物感 ≤5%) */}
            <AnimatePresence>
                {showToast && (
                    <motion.div
                        className={styles.toast}
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        {toastMessage}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
