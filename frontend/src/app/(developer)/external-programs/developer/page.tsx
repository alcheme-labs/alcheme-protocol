'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { ArrowLeft, CheckCircle2, KeyRound, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import {
    registerSandboxExternalProgram,
    type SandboxExternalProgramRegistrationResponse,
} from '@/lib/api/externalApps';
import {
    bytesToBase64,
    computeSandboxExternalProgramManifestHash,
    encodeExternalProgramOwnerAssertionPayload,
    normalizeSandboxExternalProgramManifest,
    type SandboxExternalProgramManifestInput,
} from '@/lib/external-program/sandboxRegistration.mjs';
import { useWalletAction } from '@/lib/wallet/WalletActionProvider';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';
import styles from './page.module.css';

const DEFAULT_CAPABILITIES = ['communication.rooms'];

export default function ExternalProgramDeveloperPage() {
    const router = useRouter();
    const wallet = useWallet();
    const { requestWalletConnection } = useWalletAction();
    const { signMessageForAction } = useWalletActionRunner();
    const { identityState, sessionUser } = useIdentityOnboarding();
    const [form, setForm] = useState({
        appId: '',
        name: '',
        homeUrl: '',
        serverPublicKey: '',
        serverKeyProof: '',
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [registered, setRegistered] = useState<SandboxExternalProgramRegistrationResponse | null>(null);

    const walletPubkey = wallet.publicKey?.toBase58() ?? null;
    const walletMatchesSession = Boolean(
        walletPubkey && sessionUser?.pubkey && walletPubkey === sessionUser.pubkey,
    );
    const shortWallet = walletPubkey
        ? `${walletPubkey.slice(0, 5)}…${walletPubkey.slice(-5)}`
        : 'Not connected';
    const originPreview = useMemo(() => {
        try {
            return new URL(form.homeUrl).origin;
        } catch {
            return 'Derived from the Home URL';
        }
    }, [form.homeUrl]);

    const updateField = (field: keyof typeof form, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
        setError(null);
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!walletPubkey) {
            requestWalletConnection({ source: 'external_program_registration' });
            return;
        }
        if (!wallet.signMessage) {
            setError('The connected wallet cannot sign messages.');
            return;
        }
        if (identityState !== 'registered' || !walletMatchesSession) {
            setError('Connect the same registered wallet shown in your Alcheme profile before registering a program.');
            return;
        }

        setSubmitting(true);
        try {
            new PublicKey(form.serverPublicKey.trim());
            const origin = new URL(form.homeUrl.trim()).origin;
            const ownerWallet = `solana:devnet:${walletPubkey}`;
            const manifestInput: SandboxExternalProgramManifestInput = {
                version: '1',
                appId: form.appId,
                name: form.name,
                homeUrl: form.homeUrl,
                ownerWallet,
                serverPublicKey: form.serverPublicKey,
                allowedOrigins: [origin],
                capabilities: DEFAULT_CAPABILITIES,
            };
            const manifest = normalizeSandboxExternalProgramManifest(manifestInput);
            const manifestHash = await computeSandboxExternalProgramManifestHash(manifest);
            const serverKeyProof = parseServerKeyProof(form.serverKeyProof, {
                appId: manifest.appId,
                manifestHash,
            });
            const assertionInput = {
                appId: manifest.appId,
                ownerWallet: manifest.ownerWallet,
                manifestHash,
                expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
                nonce: crypto.randomUUID(),
            };
            const payload = encodeExternalProgramOwnerAssertionPayload(assertionInput);
            const signatureBytes = await signMessageForAction({
                kind: 'signed_server_mutation',
                source: 'external_program_registration',
                key: `external-program-register:${manifest.appId}`,
                message: payload,
            });
            const result = await registerSandboxExternalProgram({
                manifest,
                ownerAssertion: {
                    payload,
                    signature: bytesToBase64(signatureBytes),
                },
                serverKeyProof,
            });
            setRegistered(result);
        } catch (cause) {
            setError(normalizeRegistrationError(cause));
        } finally {
            setSubmitting(false);
        }
    };

    if (registered) {
        const app = registered.registration.app;
        return (
            <main className={styles.page}>
                <section className={styles.successCard} aria-live="polite">
                    <div className={styles.successIcon}><CheckCircle2 aria-hidden="true" /></div>
                    <p className={styles.eyebrow}>Registration complete</p>
                    <h1>{app.name}</h1>
                    <p>
                        <code>{app.id}</code> is registered to the connected Owner wallet.
                        The next governed step is to bind its Primary Circle.
                    </p>
                    <div className={styles.successFacts}>
                        <span>Sandbox</span>
                        <span>{app.registryStatus}</span>
                        <span>Next: bind Primary Circle</span>
                    </div>
                    <div className={styles.successActions}>
                        <Button onClick={() => router.push(`/apps/${encodeURIComponent(app.id)}`)}>
                            Continue to Circle binding
                        </Button>
                        <Link href="/apps">Back to directory</Link>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <Link href="/apps" className={styles.backLink}>
                    <ArrowLeft size={16} aria-hidden="true" /> External Programs
                </Link>
                <div className={styles.titleBlock}>
                    <p className={styles.eyebrow}><Sparkles size={14} aria-hidden="true" /> Developer portal</p>
                    <h1>Register an External Program</h1>
                    <p>
                        Establish the program Owner, trusted server key, and allowed web origin.
                        Circle access is requested separately and remains governed by the target Circle.
                    </p>
                </div>
            </header>

            <div className={styles.layout}>
                <form className={styles.formCard} onSubmit={handleSubmit}>
                    <section className={styles.section}>
                        <div className={styles.sectionHeading}>
                            <span className={styles.step}>01</span>
                            <div><h2>Program identity</h2><p>Public names and the runtime origin.</p></div>
                        </div>
                        <label>
                            <span>Program name</span>
                            <input
                                required
                                value={form.name}
                                onChange={(event) => updateField('name', event.target.value)}
                                placeholder="Last Ignition"
                                autoComplete="off"
                            />
                        </label>
                        <label>
                            <span>Program ID</span>
                            <input
                                required
                                value={form.appId}
                                onChange={(event) => updateField('appId', event.target.value.toLowerCase())}
                                placeholder="last-ignition"
                                pattern="[a-z0-9][a-z0-9-]{1,47}"
                                autoCapitalize="none"
                                autoComplete="off"
                            />
                            <small>Permanent lowercase identifier. It cannot be renamed after registration.</small>
                        </label>
                        <label>
                            <span>Home URL</span>
                            <input
                                required
                                type="url"
                                value={form.homeUrl}
                                onChange={(event) => updateField('homeUrl', event.target.value)}
                                placeholder="https://game.example.com"
                                autoCapitalize="none"
                                autoComplete="url"
                            />
                            <small>Allowed origin: <code>{originPreview}</code></small>
                        </label>
                    </section>

                    <section className={styles.section}>
                        <div className={styles.sectionHeading}>
                            <span className={styles.step}>02</span>
                            <div><h2>Server trust</h2><p>The public half of the Game server signing key.</p></div>
                        </div>
                        <label>
                            <span>Server public key</span>
                            <textarea
                                required
                                value={form.serverPublicKey}
                                onChange={(event) => updateField('serverPublicKey', event.target.value)}
                                placeholder="Base58 Ed25519 public key"
                                rows={3}
                                spellCheck={false}
                            />
                            <small>Public key only. Never paste the server private key here.</small>
                        </label>
                        <label>
                            <span>Server key proof</span>
                            <textarea
                                required
                                value={form.serverKeyProof}
                                onChange={(event) => updateField('serverKeyProof', event.target.value)}
                                placeholder='{"payload":"…","signature":"…"}'
                                rows={5}
                                spellCheck={false}
                            />
                            <small>Generate this short-lived proof on the Game server. It contains no private key.</small>
                        </label>
                    </section>

                    <section className={styles.section}>
                        <div className={styles.sectionHeading}>
                            <span className={styles.step}>03</span>
                            <div><h2>Owner assertion</h2><p>One wallet signature binds this manifest to its Owner.</p></div>
                        </div>
                        <div className={styles.walletRow}>
                            <div className={styles.walletIcon}><KeyRound aria-hidden="true" /></div>
                            <div><span>Connected Owner wallet</span><strong>{shortWallet}</strong></div>
                            <span className={walletMatchesSession ? styles.ready : styles.notReady}>
                                {walletMatchesSession ? 'Profile matched' : 'Not ready'}
                            </span>
                        </div>
                        {!walletPubkey ? (
                            <Button type="button" variant="secondary" fullWidth onClick={() => requestWalletConnection({ source: 'external_program_registration' })}>
                                Connect Owner wallet
                            </Button>
                        ) : null}
                        {error ? <p className={styles.error} role="alert">{error}</p> : null}
                        <Button type="submit" fullWidth loading={submitting} disabled={!walletPubkey || !walletMatchesSession}>
                            Sign manifest and register
                        </Button>
                        <p className={styles.signatureNote}>
                            Phantom signs the manifest hash once. No transaction or token transfer is created.
                        </p>
                    </section>
                </form>

                <aside className={styles.trustRail} aria-label="Registration trust boundaries">
                    <div className={styles.railCard}>
                        <ShieldCheck aria-hidden="true" />
                        <h2>Two authorities, kept separate</h2>
                        <p>The Owner wallet authorizes registration. The Game server separately proves it holds the private half of the submitted public key.</p>
                    </div>
                    <div className={styles.flowCard}>
                        <div><KeyRound aria-hidden="true" /><span><strong>Owner wallet</strong><small>Signs this registration once</small></span></div>
                        <i />
                        <div><Server aria-hidden="true" /><span><strong>Game server</strong><small>Signs short-lived runtime claims</small></span></div>
                        <i />
                        <div><ShieldCheck aria-hidden="true" /><span><strong>Circle governance</strong><small>Approves the later binding request</small></span></div>
                    </div>
                    <p className={styles.boundaryNote}>Sandbox registration creates no Circle permission by itself.</p>
                </aside>
            </div>
        </main>
    );
}

function normalizeRegistrationError(error: unknown): string {
    const code = error instanceof Error ? error.message : String(error || 'registration_failed');
    const messages: Record<string, string> = {
        external_app_id_unavailable: 'This Program ID is already registered.',
        invalid_external_app_appId: 'Use 2–48 lowercase letters, numbers, or hyphens for the Program ID.',
        invalid_external_app_manifest: 'Check the Home URL, allowed origin, and server public key.',
        invalid_external_app_owner_assertion_signature_invalid: 'The Owner wallet signature could not be verified.',
        external_app_owner_assertion_signature_invalid: 'The Owner wallet signature could not be verified.',
        external_app_server_key_proof_required: 'Generate and paste the Game server key proof before registering.',
        external_app_server_key_proof_signature_invalid: 'The Game server key proof does not match the submitted public key.',
        external_app_server_key_proof_mismatch: 'The Game server key proof was generated for a different manifest.',
        external_app_server_key_proof_expired: 'The Game server key proof expired. Generate a new proof.',
        external_app_registration_rate_limited: 'This wallet has reached the sandbox registration limit.',
    };
    if (messages[code]) return messages[code];
    if (code.toLowerCase().includes('public key')) return 'Enter a valid Base58 Ed25519 server public key.';
    if (code.toLowerCase().includes('url')) return 'Enter a valid HTTPS Home URL.';
    return `Registration failed: ${code}`;
}

function parseServerKeyProof(
    value: string,
    expected: { appId: string; manifestHash: string },
): { payload: string; signature: string } {
    try {
        const proof = JSON.parse(value) as { payload?: unknown; signature?: unknown };
        if (typeof proof.payload !== 'string' || typeof proof.signature !== 'string') {
            throw new Error('missing proof fields');
        }
        const encoded = proof.payload.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (encoded.length % 4)) % 4);
        const payload = JSON.parse(atob(`${encoded}${padding}`)) as {
            appId?: unknown;
            manifestHash?: unknown;
        };
        if (payload.appId !== expected.appId || payload.manifestHash !== expected.manifestHash) {
            throw new Error('proof mismatch');
        }
        return { payload: proof.payload, signature: proof.signature };
    } catch {
        throw new Error('external_app_server_key_proof_mismatch');
    }
}
