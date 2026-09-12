import Link from 'next/link';
import styles from '../../public-demo-policy.module.css';

export default function PublicDemoTermsPage() {
    return (
        <main className={styles.page}>
            <article className={styles.article}>
                <p className={styles.eyebrow}>Alcheme public demo</p>
                <h1>Public Demo Terms</h1>
                <p className={styles.version}>Policy us-public-adult-demo-2026-07-22 · Effective July 22, 2026</p>
                <p className={styles.warning}>
                    This is an experimental, U.S.-focused public demo for adults. It is not a production service,
                    financial product, custody service, or promise of uninterrupted availability.
                </p>

                <h2>Eligibility and availability</h2>
                <ul>
                    <li>You must be at least 18 years old and able to accept these terms.</li>
                    <li>The demo is not currently offered in China because separate compliance support is unavailable.</li>
                    <li>Access may be limited or suspended when safety, security, legal, or provider facts are unresolved.</li>
                </ul>

                <h2>Wallets and demo assets</h2>
                <p>
                    Wallet signatures establish the current session and bind your policy acceptance. Do not use a wallet
                    containing valuable assets. Demo balances, test tokens, votes, grants, and provider receipts have no
                    promised monetary value and must not be treated as financial advice or a production transaction.
                </p>

                <h2>Your content and conduct</h2>
                <p>
                    You retain ownership of content you submit. You grant the demo operator a limited license to host,
                    process, reproduce, and display it only as needed to provide the visibility and governance flow you
                    selected. Do not submit unlawful content, secrets, personal data you lack authority to share, malware,
                    harassment, exploitation, impersonation, or material that violates another person’s rights.
                </p>

                <h2>Governance and moderation</h2>
                <p>
                    Circle decisions do not override platform safety or legal restrictions. Moderation, temporary
                    restrictions, appeals, incident holds, and audit records follow the current versioned policies and may
                    fail closed when no qualified authority is available.
                </p>

                <h2>Experimental service</h2>
                <p>
                    Features may change, be unavailable, or contain defects. The demo is provided as available to the
                    maximum extent permitted by applicable law. Do not rely on it for emergencies, legal deadlines,
                    permanent storage, valuable assets, or irreversible decisions.
                </p>

                <nav className={styles.nav} aria-label="Public demo policies">
                    <Link href="/privacy/public-demo">Privacy notice</Link>
                    <Link href="/safety/public-demo">Community safety policy</Link>
                    <Link href="/connect">Return to admission</Link>
                </nav>
            </article>
        </main>
    );
}
