'use client';

import { Landmark } from 'lucide-react';

import { BottomSheet } from '@/components/alcheme/BottomSheet';

export interface NativeGovernanceProposalSheetProps {
    open: boolean;
    operationName: string;
    namespace: string;
    operationId: string;
    operationVersion: string;
    payloadDigest: string;
    executionTargetRef: string;
    executionMode: string;
    quorum: string;
    threshold: string;
    timelock: string;
    veto: string;
    payer?: string | null;
    cost?: string | null;
    irreversibleEffects: string[];
    receiptType: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function NativeGovernanceProposalSheet(props: NativeGovernanceProposalSheetProps) {
    return (
        <BottomSheet open={props.open} title="Governance Proposal" closeLabel="Cancel" onClose={props.onCancel}>
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Landmark size={18} aria-hidden="true" />
                    <strong>{props.operationName}</strong>
                </div>
                <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
                    <Field label="Namespace" value={props.namespace} />
                    <Field label="Operation" value={`${props.operationId} · ${props.operationVersion}`} />
                    <Field label="Payload digest" value={props.payloadDigest} />
                    <Field label="Target system" value={props.executionTargetRef} />
                    <Field label="Execution mode" value={props.executionMode} />
                    <Field label="Quorum" value={props.quorum} />
                    <Field label="Threshold" value={props.threshold} />
                    <Field label="Timelock" value={props.timelock} />
                    <Field label="Veto window" value={props.veto} />
                    {props.payer ? <Field label="Payer" value={props.payer} /> : null}
                    {props.cost ? <Field label="Cost" value={props.cost} /> : null}
                    <Field label="Receipt" value={props.receiptType} />
                </dl>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {props.irreversibleEffects.map((effect) => (
                        <li key={effect}>{effect}</li>
                    ))}
                </ul>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button type="button" onClick={props.onCancel}>Cancel</button>
                    <button type="button" onClick={props.onConfirm}>Create proposal</button>
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
