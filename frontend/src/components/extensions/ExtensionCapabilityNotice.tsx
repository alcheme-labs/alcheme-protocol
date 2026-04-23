import styles from './ExtensionCapabilitySection.module.css';

export default function ExtensionCapabilityNotice({ message }: { message: string }) {
    return <p className={styles.notice}>{message}</p>;
}
