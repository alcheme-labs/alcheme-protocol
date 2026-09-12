import Link from 'next/link';
import styles from '../../public-demo-policy.module.css';

export default function PublicDemoPrivacyPage() {
    return (
        <main className={styles.page}>
            <article className={styles.article}>
                <p className={styles.eyebrow}>Alcheme public demo</p>
                <h1>Public Demo Privacy Notice</h1>
                <p className={styles.version}>Policy us-public-adult-demo-2026-07-22 · Effective July 22, 2026</p>
                <p className={styles.warning}>
                    The admission flow records an adult attestation. It does not request or store your birth date,
                    government identifier, or identity document.
                </p>

                <h2>Information processed</h2>
                <ul>
                    <li>Wallet public key, wallet-signed session message, and a digest of that message.</li>
                    <li>On-chain identity handle and profile fields you choose to provide.</li>
                    <li>The policy version, U.S. jurisdiction acknowledgement, broad region, and acceptance time.</li>
                    <li>Posts, Circle activity, governance actions, receipts, effects, appeals, and security audit events.</li>
                    <li>Operational logs needed to secure, debug, and prevent abuse of the public demo.</li>
                </ul>

                <h2>How information is used</h2>
                <p>
                    Information is used to authenticate sessions, provide the requested public or Circle-scoped features,
                    preserve governance integrity, enforce safety rules, investigate incidents, prevent replay and abuse,
                    and maintain auditable receipts. Admission data is not used to infer your exact age.
                </p>

                <h2>Visibility</h2>
                <p>
                    Wallet addresses, public profiles, public posts, and public governance records may be visible to anyone.
                    Circle-private content is limited to its authorized audience, but blockchain and provider facts may be
                    independently observable. Do not submit information that must remain permanently secret.
                </p>

                <h2>Minimization and retention</h2>
                <p>
                    The demo is designed to collect only data required for the selected capability. Policy acceptance and
                    governance receipts are retained as integrity and security records. Content disposition and deletion
                    remain subject to legal hold, appeal, immutable public-chain facts, and the current provider boundary;
                    the interface must not claim deletion until authoritative readback exists.
                </p>

                <h2>Security and requests</h2>
                <p>
                    Access is role-scoped and high-risk paths fail closed. Use the in-product report and appeal surfaces for
                    safety or privacy concerns. Until a dedicated privacy-request channel is published, do not submit
                    sensitive personal data to this experimental demo.
                </p>

                <nav className={styles.nav} aria-label="Public demo policies">
                    <Link href="/terms/public-demo">Terms</Link>
                    <Link href="/safety/public-demo">Community safety policy</Link>
                    <Link href="/connect">Return to admission</Link>
                </nav>
            </article>
        </main>
    );
}
