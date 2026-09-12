'use client';

import { UploadCloud } from 'lucide-react';

import { BottomSheet } from '@/components/alcheme/BottomSheet';

export interface PublishCeremonySheetProps {
    open: boolean;
    objectDigest: string;
    objectSize: string;
    visibility: string;
    permanence: string;
    retention: string;
    providerPolicy: string;
    quoteDigest: string;
    paymentAuthorizationRef: string;
    publishGrantDigest: string;
    nativeCeremonyVersion: string;
    payer: string;
    refundPolicy: string;
    nonPaymentPolicy: string;
    moderationStatus: string;
    deletionSemanticsAcknowledged: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function PublishCeremonySheet(props: PublishCeremonySheetProps) {
    return (
        <BottomSheet open={props.open} title="Publish" closeLabel="Cancel" onClose={props.onCancel}>
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <UploadCloud size={18} aria-hidden="true" />
                    <strong>{props.visibility}</strong>
                </div>
                <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
                    <Field label="Object" value={`${props.objectDigest} · ${props.objectSize}`} />
                    <Field label="Permanence" value={props.permanence} />
                    <Field label="Retention" value={props.retention} />
                    <Field label="Provider policy" value={props.providerPolicy} />
                    <Field label="Cost quote" value={props.quoteDigest} />
                    <Field label="Payment authorization" value={props.paymentAuthorizationRef} />
                    <Field label="Publish grant" value={props.publishGrantDigest} />
                    <Field label="Ceremony" value={props.nativeCeremonyVersion} />
                    <Field label="Payer" value={props.payer} />
                    <Field label="Refund policy" value={props.refundPolicy} />
                    <Field label="Non-payment policy" value={props.nonPaymentPolicy} />
                    <Field label="Moderation" value={props.moderationStatus} />
                    <Field
                        label="Deletion semantics"
                        value={props.deletionSemanticsAcknowledged ? 'Acknowledged' : 'Required'}
                    />
                </dl>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={props.onCancel}>Cancel</button>
                    <button type="button" onClick={props.onConfirm}>Publish</button>
                </div>
            </div>
        </BottomSheet>
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
