'use client';

export interface SignatureIntentReviewProps {
    chainId: string;
    programOrContract: string;
    method: string;
    accounts: string[];
    amount?: string | null;
    spender?: string | null;
    typedDataDomain?: string | null;
    simulationResultDigest: string;
    riskExplanation: string;
    payloadDigest: string;
    previewDigest: string;
    replayDomain: string;
    nonce: string;
    appLabel: string;
    releaseLabel: string;
    circleLabel: string;
    userLabel: string;
    expiresAt: string;
}

export function SignatureIntentReview(props: SignatureIntentReviewProps) {
    return (
        <section aria-label="Signature review" style={{ display: 'grid', gap: 10 }}>
            <Field label="Network" value={props.chainId} />
            <Field label="Program or contract" value={props.programOrContract} />
            <Field label="Method" value={props.method} />
            <Field label="Accounts" value={props.accounts.join(', ')} />
            {props.amount ? <Field label="Amount" value={props.amount} /> : null}
            {props.spender ? <Field label="Spender" value={props.spender} /> : null}
            {props.typedDataDomain ? <Field label="Typed data domain" value={props.typedDataDomain} /> : null}
            <Field label="Simulation" value={props.simulationResultDigest} />
            <Field label="Risk" value={props.riskExplanation} />
            <Field label="Payload digest" value={props.payloadDigest} />
            <Field label="Preview digest" value={props.previewDigest} />
            <Field label="Replay domain" value={props.replayDomain} />
            <Field label="Nonce" value={props.nonce} />
            <Field label="App" value={`${props.appLabel} · ${props.releaseLabel}`} />
            <Field label="Circle" value={props.circleLabel} />
            <Field label="Signer" value={props.userLabel} />
            <Field label="Expires" value={props.expiresAt} />
        </section>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt style={{ fontSize: 12, color: 'var(--color-text-muted, #64748b)' }}>{label}</dt>
            <dd style={{ margin: 0, wordBreak: 'break-word' }}>{value}</dd>
        </div>
    );
}
