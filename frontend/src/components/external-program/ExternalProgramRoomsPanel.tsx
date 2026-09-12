import type { ExternalAppCircleBinding } from '@/lib/api/externalApps';
import { useI18n } from '@/i18n/useI18n';
import styles from './ExternalProgramDetail.module.css';

export function ExternalProgramRoomsPanel(props: {
    appId: string;
    primaryCircle: ExternalAppCircleBinding | null;
}) {
    const t = useI18n('ExternalPrograms.integration');
    const lobbyRoomKey = props.primaryCircle
        ? `external:${props.appId}:lobby:main`
        : null;
    return (
        <section className={styles.section}>
            <h2>{t('roomsTitle')}</h2>
            {lobbyRoomKey ? (
                <div className={styles.row}>
                    <strong>{t('primaryLobby')}</strong>
                    <span>{lobbyRoomKey}</span>
                    <span className={styles.muted}>
                        {t('roomsHelp')}
                    </span>
                </div>
            ) : (
                <p className={styles.muted}>{t('roomsUnavailable')}</p>
            )}
        </section>
    );
}
