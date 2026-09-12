import Link from 'next/link';
import styles from '../../public-demo-policy.module.css';

export default function PublicDemoSafetyPage() {
    return (
        <main className={styles.page}>
            <article className={styles.article}>
                <p className={styles.eyebrow}>Alcheme public demo</p>
                <h1>Community Safety Policy</h1>
                <p className={styles.version}>Policy us-public-adult-demo-2026-07-22 · Effective July 22, 2026</p>

                <h2>Minimum platform boundary</h2>
                <p>
                    Circle governance may add protections but cannot disable the platform minimum, restore content that is
                    legally unavailable, turn an ordinary manager into Platform Safety authority, or use an AI signal as a
                    permanent sanction.
                </p>

                <h2>Prohibited use</h2>
                <ul>
                    <li>Child sexual abuse or exploitation material, grooming, or sexual content involving minors.</li>
                    <li>Credible threats, targeted harassment, doxxing, stalking, or non-consensual intimate material.</li>
                    <li>Malware, credential theft, fraud, impersonation, or attempts to bypass authorization.</li>
                    <li>Illegal transactions, sanctions evasion, or use of the demo for valuable-asset custody.</li>
                    <li>Publishing private reports, personal identifiers, or restricted evidence outside its exact audience.</li>
                </ul>

                <h2>Actions and appeals</h2>
                <p>
                    Reports receive an audience-safe status. Temporary mute, hide, restriction, downrank, suspension, and
                    incident actions require exact authority, scope, expiry, receipt, and appeal. Independent appeal routes
                    must not be controlled by the original moderator or complained-about operator.
                </p>

                <h2>Emergency and legal boundary</h2>
                <p>
                    Break-glass access is unavailable unless a predefined incident policy, independent approval, short
                    expiry, alert, audit, and after-action review are all active. Legal hold, takedown, reporting, redaction,
                    and destruction require authoritative legal disposition and cannot be inferred from a Circle vote.
                </p>

                <h2>Adult-only demo</h2>
                <p>
                    Accounts and authenticated participation are limited to users who attest they are at least 18. If the
                    operator learns that an account belongs to a minor, participation must be disabled and the data handled
                    through the applicable safety and legal process rather than an ordinary Circle action.
                </p>

                <nav className={styles.nav} aria-label="Public demo policies">
                    <Link href="/terms/public-demo">Terms</Link>
                    <Link href="/privacy/public-demo">Privacy notice</Link>
                    <Link href="/connect">Return to admission</Link>
                </nav>
            </article>
        </main>
    );
}
