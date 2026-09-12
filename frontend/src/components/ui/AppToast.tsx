'use client';

import { useUIStore } from '@/stores/ui';
import styles from '@/lib/wallet/WalletActionStatusSurface.module.css';

export default function AppToast() {
    const toast = useUIStore((state) => state.toast);
    const dismissToast = useUIStore((state) => state.dismissToast);
    if (!toast) return null;
    return (
        <div
            className={styles.surface}
            role={toast.type === 'error' ? 'alert' : 'status'}
            data-toast-type={toast.type}
        >
            <div className={styles.content}>
                <span className={styles.title}>{toast.message}</span>
            </div>
            <button type="button" className={styles.dismiss} onClick={dismissToast}>
                ×
            </button>
        </div>
    );
}
