import styles from './ExternalProgramDetail.module.css';
import { useI18n } from '@/i18n/useI18n';

export function KnowledgeContextPanel() {
    const t = useI18n('ExternalPrograms.integration');
    return (
        <section className={styles.section}>
            <h2>{t('knowledgeTitle')}</h2>
            <p>{t('knowledgeHelp')}</p>
            <div className={styles.pillRow}>
                <span className={styles.pill}>{t('signedClaim')}</span>
                <span className={styles.pill}>{t('activeBinding')}</span>
                <span className={styles.pill}>{t('sourceMaterialOnly')}</span>
            </div>
        </section>
    );
}
