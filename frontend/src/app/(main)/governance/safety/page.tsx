'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import {
    appendPlatformSafetyLegalStatus,
    approvePlatformSafetyAuthorityChange,
    bootstrapPlatformSafety,
    capturePlatformSafetyEvidence,
    closePlatformSafetyIncident,
    declarePlatformSafetyIncident,
    extendPlatformSafetyIncident,
    fetchPlatformSafetyPolicy,
    fetchPlatformSafetyIncidents,
    fetchPlatformSafetyWorkspace,
    openPlatformSafetyAppeal,
    proposePlatformSafetyAuthorityChange,
    quarantinePlatformSafetyPost,
    releasePlatformSafetyPost,
    recordPlatformSafetyBreakGlassAccess,
    mergePlatformSafetyIncidents,
    openPlatformSafetyIncidentActivationAppeal,
    openPlatformSafetyLegalStatusAppeal,
    resolvePlatformSafetyIncidentActivation,
    resolvePlatformSafetyIncidentActivationAppeal,
    resolvePlatformSafetyAppeal,
    reviewPlatformSafetyIncident,
    upgradePlatformSafetyIncident,
    type PlatformSafetyPolicy,
    type PlatformSafetyRole,
    type PlatformSafetySafetyIncident,
    type PlatformSafetyWorkspace,
} from '@/lib/api/platformSafety';
import styles from './page.module.css';

async function sha256(value: string): Promise<string> {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function positiveInteger(form: FormData, key: string): number {
    return Number(String(form.get(key) || '').trim());
}

export default function PlatformSafetyPage() {
    const t = useI18n('PlatformSafety');
    const releaseT = useI18n('PlatformSafetyRelease');
    const appealT = useI18n('PlatformSafetyAppeal');
    const incidentT = useI18n('PlatformSafetyIncident');
    const incidentAppealT = useI18n('PlatformSafetyIncidentAppeal');
    const [policy, setPolicy] = useState<PlatformSafetyPolicy | null>(null);
    const [workspace, setWorkspace] = useState<PlatformSafetyWorkspace | null>(null);
    const [safetyIncidents, setSafetyIncidents] = useState<PlatformSafetySafetyIncident[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        const nextPolicy = await fetchPlatformSafetyPolicy();
        setPolicy(nextPolicy);
        try {
            const nextWorkspace = await fetchPlatformSafetyWorkspace();
            setWorkspace(nextWorkspace);
            setSafetyIncidents(await fetchPlatformSafetyIncidents());
        } catch {
            setWorkspace(null);
            setSafetyIncidents([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh().catch(() => {
            setMessage(t('loadError'));
            setLoading(false);
        });
    }, [refresh, t]);

    const configure = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setMessage(null);
        const form = new FormData(event.currentTarget);
        try {
            await bootstrapPlatformSafety({
                policyAdminCircleId: positiveInteger(form, 'policyAdminCircleId'),
                caseResponderCircleId: positiveInteger(form, 'caseResponderCircleId'),
                emergencyResponderCircleId: positiveInteger(form, 'emergencyResponderCircleId'),
                appealReviewCircleId: positiveInteger(form, 'appealReviewCircleId'),
                auditReviewCircleId: positiveInteger(form, 'auditReviewCircleId'),
                legalOperatorCircleId: positiveInteger(form, 'legalOperatorCircleId'),
                legalAppealCircleId: positiveInteger(form, 'legalAppealCircleId'),
            });
            setMessage(t('configured'));
            await refresh();
        } catch {
            setMessage(t('configureError'));
        } finally {
            setSaving(false);
        }
    };

    const proposeAuthorityChange = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const evidence = String(form.get('authorityEvidence') || '').trim();
            const excludedActorPubkeys = String(form.get('excludedActorPubkeys') || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            const result = await proposePlatformSafetyAuthorityChange({
                targetRoleKey: String(form.get('targetRoleKey') || '') as PlatformSafetyRole,
                targetCircleId: positiveInteger(form, 'targetCircleId'),
                reasonCode: String(form.get('authorityReasonCode') || '').trim(),
                evidenceDigest: await sha256(evidence),
                idempotencyKey: crypto.randomUUID(),
                excludedActorPubkeys,
            });
            setMessage(`Authority change proposal receipt: ${result.receipt.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage('Authority change proposal was rejected. Check policy-admin authority, target Circle, and conflict separation.');
        } finally {
            setSaving(false);
        }
    };

    const approveAuthorityChange = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const evidence = String(form.get('approvalEvidence') || '').trim();
            const result = await approvePlatformSafetyAuthorityChange(
                String(form.get('proposalReceiptId') || '').trim(),
                {
                    reasonCode: String(form.get('approvalReasonCode') || '').trim(),
                    evidenceDigest: await sha256(evidence),
                    idempotencyKey: crypto.randomUUID(),
                },
            );
            setMessage(`Authority change approved: ${result.binding.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage('Authority change approval was rejected. A distinct policy admin and active proposal receipt are required.');
        } finally {
            setSaving(false);
        }
    };

    const captureEvidence = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const result = await capturePlatformSafetyEvidence({
                subjectType: String(form.get('evidenceSubjectType') || '') as 'report_url' | 'screenshot' | 'attachment' | 'feed_post_snapshot',
                subjectRef: String(form.get('evidenceSubjectRef') || '').trim(),
                sourceDigest: await sha256(String(form.get('restrictedEvidence') || '').trim()),
                malwareScanStatus: String(form.get('malwareScanStatus') || '') as 'clean' | 'blocked' | 'not_applicable',
                piiRedactionStatus: String(form.get('piiRedactionStatus') || '') as 'none' | 'redacted' | 'blocked',
                retentionSeconds: positiveInteger(form, 'evidenceRetentionSeconds'),
                reasonCode: String(form.get('evidenceReasonCode') || '').trim(),
                idempotencyKey: crypto.randomUUID(),
            });
            setMessage(`Restricted evidence captured: ${result.receipt.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage('Restricted evidence capture was rejected. Check case responder authority, digest input, scan status, and retention window.');
        } finally {
            setSaving(false);
        }
    };

    const recordBreakGlassAccess = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const justification = String(form.get('breakGlassJustification') || '').trim();
            const result = await recordPlatformSafetyBreakGlassAccess(
                String(form.get('breakGlassEvidenceReceiptId') || '').trim(),
                {
                    requesterPubkey: String(form.get('breakGlassRequesterPubkey') || '').trim(),
                    safetyIncidentId: String(form.get('breakGlassIncidentId') || '').trim(),
                    purposeCode: String(form.get('breakGlassPurposeCode') || '').trim(),
                    accessJustificationDigest: await sha256(justification),
                    durationSeconds: positiveInteger(form, 'breakGlassDurationSeconds'),
                    idempotencyKey: crypto.randomUUID(),
                },
            );
            setMessage(`Break-glass access recorded: ${result.receipt.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage('Break-glass access was rejected. Active incident, case responder request, independent audit approval, duration, and protected evidence receipt are required.');
        } finally {
            setSaving(false);
        }
    };

    const appendLegalStatus = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const [
                authorityDigest,
                publicTombstoneDigest,
                redactedSummaryDigest,
                lifecyclePlanDigest,
            ] = await Promise.all([
                sha256(String(form.get('legalAuthority') || '').trim()),
                sha256(String(form.get('publicTombstone') || '').trim()),
                sha256(String(form.get('redactedSummary') || '').trim()),
                sha256(String(form.get('lifecyclePlan') || '').trim()),
            ]);
            const result = await appendPlatformSafetyLegalStatus({
                contentId: String(form.get('legalContentId') || '').trim(),
                status: String(form.get('legalStatus') || '') as any,
                jurisdiction: 'US',
                authorityDigest,
                publicTombstoneDigest,
                redactedSummaryDigest,
                lifecyclePlanDigest,
                noticeRequired: form.get('noticeRequired') === 'on',
                        appealWindowSeconds: 30 * 24 * 60 * 60,
                reasonCode: String(form.get('legalReasonCode') || '').trim(),
                idempotencyKey: crypto.randomUUID(),
            });
            setMessage(`Legal status appended: ${result.receipt.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage('Legal status append was rejected. Check legal-operator authority, target content, digest fields, and independent appeal role.');
        } finally {
            setSaving(false);
        }
    };

    const openLegalAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const result = await openPlatformSafetyLegalStatusAppeal(
                String(form.get('legalAppealContentId') || '').trim(),
                {
                    reasonCode: String(form.get('legalAppealReasonCode') || '').trim(),
                    evidenceDigest: await sha256(String(form.get('legalAppealEvidence') || '').trim()),
                },
            );
            setMessage(`Legal appeal opened: ${result.appeal.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage('Legal appeal was rejected. Only the content author can appeal an active legal status inside the appeal window.');
        } finally {
            setSaving(false);
        }
    };

    const quarantine = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSaving(true);
        setMessage(null);
        const form = new FormData(event.currentTarget);
        try {
            const evidence = String(form.get('evidence') || '').trim();
            const result = await quarantinePlatformSafetyPost({
                circleId: positiveInteger(form, 'circleId'),
                contentId: String(form.get('contentId') || '').trim(),
                category: String(form.get('category') || '').trim(),
                severity: String(form.get('severity') || '') as 'sev2' | 'sev1',
                durationSeconds: positiveInteger(form, 'durationSeconds'),
                reasonCode: String(form.get('reasonCode') || '').trim(),
                evidenceDigest: await sha256(evidence),
                idempotencyKey: crypto.randomUUID(),
                safetyIncidentId: String(form.get('safetyIncidentId') || '').trim() || null,
            });
            setMessage(`${t('quarantined')} ${result.receipt.id}`);
            event.currentTarget.reset();
            await refresh();
        } catch {
            setMessage(t('quarantineError'));
        } finally {
            setSaving(false);
        }
    };

    const release = async (contentId: string, circleId: number) => {
        setSaving(true);
        setMessage(null);
        try {
            const result = await releasePlatformSafetyPost(contentId, {
                circleId,
                reasonCode: 'platform_safety_review_complete',
                idempotencyKey: crypto.randomUUID(),
            });
            setMessage(`${releaseT('success')} ${result.receipt.id}`);
            await refresh();
        } catch {
            setMessage(releaseT('error'));
        } finally {
            setSaving(false);
        }
    };

    const openAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const evidence = String(form.get('appealEvidence') || '').trim();
            const result = await openPlatformSafetyAppeal(
                String(form.get('appealContentId') || '').trim(),
                {
                    reasonCode: String(form.get('appealReasonCode') || '').trim(),
                    evidenceDigest: await sha256(evidence),
                },
            );
            setMessage(`${appealT('opened')} ${result.appeal.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage(appealT('openError'));
        } finally {
            setSaving(false);
        }
    };

    const resolveAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const outcome = submitter?.value as 'uphold' | 'revoke';
        setSaving(true);
        setMessage(null);
        try {
            const evidence = String(form.get('reviewEvidence') || '').trim();
            const result = await resolvePlatformSafetyAppeal(
                String(form.get('appealId') || '').trim(),
                {
                    outcome,
                    reasonCode: outcome === 'revoke'
                        ? 'independent_review_revoke'
                        : 'independent_review_uphold',
                    evidenceDigest: await sha256(evidence),
                },
            );
            setMessage(`${appealT('resolved')} ${result.resolutionReceipt.id}`);
            await refresh();
        } catch {
            setMessage(appealT('resolveError'));
        } finally {
            setSaving(false);
        }
    };

    const declareIncident = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        setSaving(true);
        setMessage(null);
        try {
            const result = await declarePlatformSafetyIncident({
                targetCircleId: positiveInteger(form, 'incidentCircleId'),
                category: String(form.get('incidentCategory') || '').trim(),
                severity: String(form.get('incidentSeverity') || '') as 'sev2' | 'sev1',
                maxDurationSeconds: positiveInteger(form, 'incidentDuration'),
                reasonCode: String(form.get('incidentReasonCode') || '').trim(),
                evidenceDigest: await sha256(String(form.get('incidentEvidence') || '').trim()),
                idempotencyKey: crypto.randomUUID(),
            });
            setMessage(`${incidentT('declared')} ${result.incident.id}`);
            formElement.reset();
            await refresh();
        } catch {
            setMessage(incidentT('declareError'));
        } finally {
            setSaving(false);
        }
    };

    const resolveIncidentActivation = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const outcome = submitter?.value as 'approve' | 'reject';
        setSaving(true);
        setMessage(null);
        try {
            const result = await resolvePlatformSafetyIncidentActivation(
                String(form.get('incidentId') || ''),
                {
                    outcome,
                    reasonCode: outcome === 'approve'
                        ? 'independent_incident_activation_approved'
                        : 'independent_incident_activation_rejected',
                    evidenceDigest: await sha256(String(form.get('activationEvidence') || '').trim()),
                    idempotencyKey: crypto.randomUUID(),
                },
            );
            setMessage(`${incidentT('activationRecorded')} ${result.incident.id}`);
            await refresh();
        } catch {
            setMessage(incidentT('activationError'));
        } finally {
            setSaving(false);
        }
    };

    const closeIncident = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setSaving(true);
        setMessage(null);
        try {
            const result = await closePlatformSafetyIncident(
                String(form.get('incidentId') || ''),
                {
                    reasonCode: 'incident_scope_restored',
                    evidenceDigest: await sha256(String(form.get('closeEvidence') || '').trim()),
                    idempotencyKey: crypto.randomUUID(),
                },
            );
            setMessage(`${incidentT('closed')} ${result.incident.id}`);
            await refresh();
        } catch {
            setMessage(incidentT('closeError'));
        } finally {
            setSaving(false);
        }
    };

    const mutateIncidentLifecycle = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const action = submitter?.value as 'upgrade' | 'extend' | 'merge';
        const incidentId = String(form.get('incidentId') || '');
        const evidenceDigest = await sha256(String(form.get('lifecycleEvidence') || '').trim());
        const common = {
            evidenceDigest,
            idempotencyKey: crypto.randomUUID(),
        };
        setSaving(true);
        setMessage(null);
        try {
            const result = action === 'upgrade'
                ? await upgradePlatformSafetyIncident(incidentId, {
                    ...common,
                    severity: 'sev1',
                    reasonCode: 'independent_incident_upgrade',
                })
                : action === 'extend'
                    ? await extendPlatformSafetyIncident(incidentId, {
                        ...common,
                        additionalDurationSeconds: positiveInteger(form, 'additionalDurationSeconds'),
                        reasonCode: 'independent_incident_extension',
                    })
                    : await mergePlatformSafetyIncidents(incidentId, {
                        ...common,
                        sourceIncidentId: String(form.get('sourceIncidentId') || '').trim(),
                        reasonCode: 'independent_incident_merge',
                    });
            setMessage(`${incidentT('lifecycleRecorded')} ${result.incident.id}`);
            await refresh();
        } catch {
            setMessage(incidentT('lifecycleError'));
        } finally {
            setSaving(false);
        }
    };

    const openIncidentActivationAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setSaving(true);
        setMessage(null);
        try {
            const result = await openPlatformSafetyIncidentActivationAppeal(
                String(form.get('incidentId') || ''),
                {
                    reasonCode: 'commander_reports_wrong_activation',
                    evidenceDigest: await sha256(String(form.get('activationAppealEvidence') || '').trim()),
                },
            );
            setMessage(`${incidentAppealT('opened')} ${result.appeal.id}`);
            await refresh();
        } catch {
            setMessage(incidentAppealT('openError'));
        } finally {
            setSaving(false);
        }
    };

    const resolveIncidentActivationAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const outcome = submitter?.value as 'uphold' | 'revoke';
        setSaving(true);
        setMessage(null);
        try {
            const result = await resolvePlatformSafetyIncidentActivationAppeal(
                String(form.get('appealId') || ''),
                {
                    outcome,
                    reasonCode: outcome === 'revoke'
                        ? 'wrong_activation_independently_revoked'
                        : 'activation_independently_upheld',
                    evidenceDigest: await sha256(String(form.get('activationAppealReviewEvidence') || '').trim()),
                },
            );
            setMessage(`${incidentAppealT('resolved')} ${result.resolutionReceipt.id}`);
            await refresh();
        } catch {
            setMessage(incidentAppealT('resolveError'));
        } finally {
            setSaving(false);
        }
    };

    const reviewIncident = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setSaving(true);
        setMessage(null);
        try {
            const result = await reviewPlatformSafetyIncident(
                String(form.get('incidentId') || ''),
                {
                    reasonCode: 'after_action_review_complete',
                    evidenceDigest: await sha256(String(form.get('reviewEvidence') || '').trim()),
                    idempotencyKey: crypto.randomUUID(),
                },
            );
            setMessage(`${incidentT('reviewed')} ${result.incident.id}`);
            await refresh();
        } catch {
            setMessage(incidentT('reviewError'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className={styles.page}>
            <Link className={styles.back} href="/governance"><ArrowLeft size={17} />{t('back')}</Link>
            <header className={styles.header}>
                <ShieldAlert size={28} aria-hidden="true" />
                <div>
                    <p>{t('eyebrow')}</p>
                    <h1>{t('title')}</h1>
                    <span>{t('boundary')}</span>
                </div>
            </header>

            <section className={styles.scope} aria-labelledby="platform-safety-scope">
                <div>
                    <p>{t('scope')}</p>
                    <h2 id="platform-safety-scope">{policy ? `${policy.jurisdiction} · ${policy.minimumAge}+ · Solana Devnet` : t('loading')}</h2>
                    <span>{t('assetBoundary')}</span>
                </div>
                <button type="button" onClick={() => void refresh()} disabled={loading}>
                    <RefreshCw size={16} className={loading ? styles.spin : undefined} />{t('refresh')}
                </button>
            </section>

            {policy?.policy?.rules.automation ? (
                <section className={styles.scope} aria-labelledby="platform-safety-automation">
                    <div>
                        <p>Moderation automation policy</p>
                        <h2 id="platform-safety-automation">{policy.policy.rules.automation.signalMode} · {policy.policy.rules.automation.killSwitch.state}</h2>
                        <span>
                            Rule {policy.policy.rules.automation.ruleVersion} · model {policy.policy.rules.automation.modelVersion} · batch cap {policy.policy.rules.automation.batchMaximumSubjects} · permanent disposition {policy.policy.rules.automation.thresholds.permanentDisposition}
                        </span>
                    </div>
                    <small>Automated enforcement is disabled; sampling is required; rollback and appeal stay governed.</small>
                </section>
            ) : null}

            {message ? <p className={styles.message} role="status">{message}</p> : null}

            <section className={styles.grid}>
                <form className={styles.card} onSubmit={configure}>
                    <p>{t('setupEyebrow')}</p>
                    <h2>{t('setupTitle')}</h2>
                    <span>{t('setupBoundary')}</span>
                    <label>{t('policyCircle')}<input name="policyAdminCircleId" inputMode="numeric" required /></label>
                    <label>{t('caseResponderCircle')}<input name="caseResponderCircleId" inputMode="numeric" required /></label>
                    <label>{t('emergencyResponderCircle')}<input name="emergencyResponderCircleId" inputMode="numeric" required /></label>
                    <label>{t('appealReviewCircle')}<input name="appealReviewCircleId" inputMode="numeric" required /></label>
                    <label>{t('auditReviewCircle')}<input name="auditReviewCircleId" inputMode="numeric" required /></label>
                    <label>{t('legalOperatorCircle')}<input name="legalOperatorCircleId" inputMode="numeric" required /></label>
                    <label>{t('legalAppealCircle')}<input name="legalAppealCircleId" inputMode="numeric" required /></label>
                    <button disabled={saving} type="submit">{saving ? t('saving') : t('configure')}</button>
                </form>

                <form className={styles.card} onSubmit={proposeAuthorityChange}>
                    <p>Authority change</p>
                    <h2>Propose role Circle update</h2>
                    <span>Requires current policy-admin authority. The proposal records a governed receipt and waits for a distinct policy admin.</span>
                    <div className={styles.twoColumns}>
                        <label>Target role
                            <select name="targetRoleKey" required>
                                {policy?.roles.map((role) => (
                                    <option value={role.roleKey} key={role.roleKey}>{role.roleKey}</option>
                                ))}
                            </select>
                        </label>
                        <label>New Secret governance Circle ID
                            <input name="targetCircleId" inputMode="numeric" required />
                        </label>
                    </div>
                    <label>Conflict exclusions
                        <input name="excludedActorPubkeys" placeholder="comma-separated wallet pubkeys" />
                    </label>
                    <label>{t('reason')}
                        <input name="authorityReasonCode" defaultValue="platform_safety_authority_rotation" required />
                    </label>
                    <label>{t('evidence')}
                        <textarea name="authorityEvidence" rows={4} required />
                    </label>
                    <small>Target actors must be disjoint from other Platform Safety roles and cannot include the proposer or excluded conflict actors.</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_policy_admin')} type="submit">
                        {saving ? t('saving') : 'Propose authority change'}
                    </button>
                </form>

                <form className={styles.card} onSubmit={approveAuthorityChange}>
                    <p>Dual control</p>
                    <h2>Approve authority proposal</h2>
                    <span>A second policy admin consumes the proposal receipt and atomically supersedes the old role binding.</span>
                    <label>Proposal receipt ID
                        <input name="proposalReceiptId" required />
                    </label>
                    <label>{t('reason')}
                        <input name="approvalReasonCode" defaultValue="platform_safety_authority_second_approval" required />
                    </label>
                    <label>{t('evidence')}
                        <textarea name="approvalEvidence" rows={4} required />
                    </label>
                    <small>Self-approval, target-role actor approval, and conflicted actor sets fail closed.</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_policy_admin')} type="submit">
                        {saving ? t('saving') : 'Approve authority change'}
                    </button>
                </form>

                <form className={styles.card} onSubmit={captureEvidence}>
                    <p>Protected evidence</p>
                    <h2>Capture restricted evidence digest</h2>
                    <span>Stores a governed receipt/effect with scan, redaction, retention, and no public/AI/knowledge export.</span>
                    <div className={styles.twoColumns}>
                        <label>Subject type
                            <select name="evidenceSubjectType" defaultValue="feed_post_snapshot" required>
                                <option value="feed_post_snapshot">Feed post snapshot</option>
                                <option value="report_url">Report URL</option>
                                <option value="screenshot">Screenshot</option>
                                <option value="attachment">Attachment</option>
                            </select>
                        </label>
                        <label>Subject reference
                            <input name="evidenceSubjectRef" required />
                        </label>
                        <label>Malware scan
                            <select name="malwareScanStatus" defaultValue="clean" required>
                                <option value="clean">Clean</option>
                                <option value="blocked">Blocked</option>
                                <option value="not_applicable">Not applicable</option>
                            </select>
                        </label>
                        <label>PII redaction
                            <select name="piiRedactionStatus" defaultValue="redacted" required>
                                <option value="none">None</option>
                                <option value="redacted">Redacted</option>
                                <option value="blocked">Blocked</option>
                            </select>
                        </label>
                        <label>Retention
                            <select name="evidenceRetentionSeconds" defaultValue="604800" required>
                                <option value="3600">1 hour</option>
                                <option value="86400">1 day</option>
                                <option value="604800">7 days</option>
                                <option value="2592000">30 days</option>
                            </select>
                        </label>
                        <label>{t('reason')}
                            <input name="evidenceReasonCode" defaultValue="platform_safety_restricted_evidence_capture" required />
                        </label>
                    </div>
                    <label>Restricted evidence summary
                        <textarea name="restrictedEvidence" rows={4} required />
                    </label>
                    <small>Only the SHA-256 digest and retention/readback metadata are persisted in the governed effect.</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_case_responder')} type="submit">
                        {saving ? t('saving') : 'Capture evidence'}
                    </button>
                </form>

                <form className={styles.card} onSubmit={recordBreakGlassAccess}>
                    <p>Break-glass audit</p>
                    <h2>Record protected evidence access</h2>
                    <span>Requires an active IncidentActivationPolicy context, a case-responder request, and a distinct audit-reviewer approval.</span>
                    <div className={styles.twoColumns}>
                        <label>Evidence receipt
                            <input name="breakGlassEvidenceReceiptId" required />
                        </label>
                        <label>Requester pubkey
                            <input name="breakGlassRequesterPubkey" defaultValue={workspace?.viewer.pubkey ?? ''} required />
                        </label>
                        <label>Active incident
                            <select name="breakGlassIncidentId" defaultValue="" required>
                                <option value="">Select active incident</option>
                                {safetyIncidents.filter((incident) => incident.state === 'active').map((incident) => (
                                    <option value={incident.id} key={incident.id}>
                                        {incident.category} · Circle {incident.targetCircleId}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>Access duration
                            <select name="breakGlassDurationSeconds" defaultValue="300" required>
                                <option value="300">5 min</option>
                                <option value="900">15 min</option>
                            </select>
                        </label>
                        <label>{t('reason')}
                            <input name="breakGlassPurposeCode" defaultValue="platform_safety_incident_break_glass_read" required />
                        </label>
                    </div>
                    <label>Access justification
                        <textarea name="breakGlassJustification" rows={4} required />
                    </label>
                    <small>The access receipt persists only digests, request/approval actors, expiry, alert metadata, and after-action review requirement.</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_audit_reviewer')} type="submit">
                        {saving ? t('saving') : 'Record break-glass access'}
                    </button>
                </form>

                <form className={styles.card} onSubmit={appendLegalStatus}>
                    <p>Legal lifecycle</p>
                    <h2>Append legal-safe content status</h2>
                    <span>Appends a governed legal status without mutating historical quarantine, appeal, or governance receipts.</span>
                    <div className={styles.twoColumns}>
                        <label>{t('content')}
                            <input name="legalContentId" required />
                        </label>
                        <label>Status
                            <select name="legalStatus" defaultValue="legal_hold" required>
                                <option value="legal_hold">Legal hold</option>
                                <option value="legal_takedown">Legal takedown</option>
                                <option value="legal_redaction">Legal redaction</option>
                                <option value="retention_authorized">Retention authorized</option>
                                <option value="destruction_authorized">Destruction authorized</option>
                            </select>
                        </label>
                        <label>Appeal window
                            <input value="30 days" readOnly />
                        </label>
                        <label>{t('reason')}
                            <input name="legalReasonCode" defaultValue="platform_safety_legal_status_append" required />
                        </label>
                    </div>
                    <label><input name="noticeRequired" type="checkbox" defaultChecked /> Notify the content author</label>
                    <label>Legal authority summary
                        <textarea name="legalAuthority" rows={3} required />
                    </label>
                    <label>Public tombstone copy
                        <textarea name="publicTombstone" rows={3} required />
                    </label>
                    <label>Redacted summary
                        <textarea name="redactedSummary" rows={3} required />
                    </label>
                    <label>Lifecycle plan
                        <textarea name="lifecyclePlan" rows={3} required />
                    </label>
                    <small>Detail reads return legal hold notices or 451 tombstones; feed/circle lists exclude tombstoned statuses.</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_legal_operator')} type="submit">
                        {saving ? t('saving') : 'Append legal status'}
                    </button>
                </form>

                <form className={styles.card} onSubmit={openLegalAppeal}>
                    <p>Legal appeal</p>
                    <h2>Appeal active legal status</h2>
                    <span>Content author opens a distinct legal appeal; legal appeal reviewers resolve without using Circle moderator authority.</span>
                    <label>{t('content')}
                        <input name="legalAppealContentId" required />
                    </label>
                    <label>{appealT('reason')}
                        <input name="legalAppealReasonCode" defaultValue="author_requests_legal_status_review" required />
                    </label>
                    <label>{appealT('evidence')}
                        <textarea name="legalAppealEvidence" rows={4} required />
                    </label>
                    <button disabled={saving} type="submit">
                        {saving ? t('saving') : 'Open legal appeal'}
                    </button>
                </form>

                <form className={styles.card} onSubmit={quarantine}>
                    <p>{t('actionEyebrow')}</p>
                    <h2>{t('actionTitle')}</h2>
                    <span>{t('actionBoundary')}</span>
                    <div className={styles.twoColumns}>
                        <label>{t('circle')}<input name="circleId" inputMode="numeric" required /></label>
                        <label>{t('content')}<input name="contentId" required /></label>
                        <label>{t('category')}
                            <select name="category" required>
                                {policy?.policy?.rules.taxonomy.categories.map((item) => (
                                    <option value={item.code} key={item.code}>{item.code}</option>
                                ))}
                            </select>
                        </label>
                        <label>{t('severity')}
                            <select name="severity" defaultValue="sev2"><option value="sev2">SEV2</option><option value="sev1">SEV1</option></select>
                        </label>
                        <label>{t('duration')}
                            <select name="durationSeconds" defaultValue="900">
                                <option value="300">5 min</option><option value="900">15 min</option>
                                <option value="1800">30 min</option><option value="3600">60 min</option>
                            </select>
                        </label>
                        <label>{t('reason')}<input name="reasonCode" defaultValue="platform_safety_reviewed" required /></label>
                        <label>{incidentT('context')}
                            <select name="safetyIncidentId" defaultValue="">
                                <option value="">{incidentT('noContext')}</option>
                                {safetyIncidents.filter((incident) => incident.state === 'active').map((incident) => (
                                    <option value={incident.id} key={incident.id}>
                                        {incident.category} · Circle {incident.targetCircleId}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <label>{t('evidence')}<textarea name="evidence" rows={4} required /></label>
                    <small>{t('evidenceBoundary')}</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_case_responder')} type="submit">
                        {saving ? t('saving') : t('quarantine')}
                    </button>
                </form>

                <form className={styles.card} onSubmit={openAppeal}>
                    <p>{appealT('eyebrow')}</p>
                    <h2>{appealT('title')}</h2>
                    <span>{appealT('boundary')}</span>
                    <label>{t('content')}<input name="appealContentId" required /></label>
                    <label>{appealT('reason')}
                        <input name="appealReasonCode" defaultValue="author_requests_independent_review" required />
                    </label>
                    <label>{appealT('evidence')}<textarea name="appealEvidence" rows={4} required /></label>
                    <small>{appealT('evidenceBoundary')}</small>
                    <button disabled={saving} type="submit">
                        {saving ? t('saving') : appealT('open')}
                    </button>
                </form>

                <form className={styles.card} onSubmit={declareIncident}>
                    <p>{incidentT('eyebrow')}</p>
                    <h2>{incidentT('declareTitle')}</h2>
                    <span>{incidentT('boundary')}</span>
                    <div className={styles.twoColumns}>
                        <label>{t('circle')}<input name="incidentCircleId" inputMode="numeric" required /></label>
                        <label>{t('category')}
                            <select name="incidentCategory" required>
                                {policy?.policy?.rules.taxonomy.categories.map((item) => (
                                    <option value={item.code} key={item.code}>{item.code}</option>
                                ))}
                            </select>
                        </label>
                        <label>{t('severity')}
                            <select name="incidentSeverity" defaultValue="sev2">
                                <option value="sev2">SEV2</option><option value="sev1">SEV1</option>
                            </select>
                        </label>
                        <label>{incidentT('duration')}
                            <select name="incidentDuration" defaultValue="900">
                                <option value="900">15 min</option>
                                <option value="3600">60 min</option>
                                <option value="14400">4 h</option>
                            </select>
                        </label>
                    </div>
                    <label>{t('reason')}<input name="incidentReasonCode" defaultValue="credible_threat_incident_declared" required /></label>
                    <label>{t('evidence')}<textarea name="incidentEvidence" rows={4} required /></label>
                    <small>{incidentT('dualControl')}</small>
                    <button disabled={saving || !workspace?.viewer.roles.includes('platform_safety_emergency_responder')} type="submit">
                        {saving ? t('saving') : incidentT('declare')}
                    </button>
                </form>
            </section>

            <section className={styles.incidents} aria-labelledby="safety-incidents">
                <div className={styles.sectionTitle}>
                    <div><p>{incidentT('eyebrow')}</p><h2 id="safety-incidents">{incidentT('title')}</h2></div>
                    <span>{safetyIncidents.length}</span>
                </div>
                {safetyIncidents.map((incident) => (
                    <article className={styles.incident} key={incident.id}>
                        <div><strong>{incident.category}</strong><span>{incident.severity} · {incident.state}</span></div>
                        <dl>
                            <div><dt>{t('circle')}</dt><dd>{incident.targetCircleId}</dd></div>
                            <div><dt>{incidentT('commander')}</dt><dd>{incident.commanderPubkey}</dd></div>
                            <div><dt>{incidentT('deadline')}</dt><dd>{new Date(incident.expiresAt ?? incident.activationDeadline).toLocaleString()}</dd></div>
                            <div><dt>{t('receipt')}</dt><dd>{incident.declarationReceiptId}</dd></div>
                        </dl>
                        <small data-creates-new-authority={incident.createsNewAuthority}>
                            {incidentT('noAuthority')}
                        </small>
                        {incident.state === 'pending_approval'
                            && workspace?.viewer.roles.includes('platform_safety_audit_reviewer') ? (
                            <form className={styles.reviewForm} onSubmit={resolveIncidentActivation}>
                                <input type="hidden" name="incidentId" value={incident.id} />
                                <label>{incidentT('activationEvidence')}
                                    <textarea name="activationEvidence" rows={3} required />
                                </label>
                                <div>
                                    <button disabled={saving} type="submit" name="outcome" value="approve">{incidentT('approve')}</button>
                                    <button disabled={saving} type="submit" name="outcome" value="reject">{incidentT('reject')}</button>
                                </div>
                            </form>
                        ) : null}
                        {incident.state === 'active'
                            && workspace?.viewer.pubkey === incident.commanderPubkey ? (
                            <form className={styles.reviewForm} onSubmit={closeIncident}>
                                <input type="hidden" name="incidentId" value={incident.id} />
                                <label>{incidentT('closeEvidence')}<textarea name="closeEvidence" rows={3} required /></label>
                                <button disabled={saving} type="submit">{incidentT('close')}</button>
                            </form>
                        ) : null}
                        {incident.state === 'active'
                            && workspace?.viewer.pubkey === incident.commanderPubkey
                            && !incident.activationAppeal ? (
                            <form className={styles.reviewForm} onSubmit={openIncidentActivationAppeal}>
                                <input type="hidden" name="incidentId" value={incident.id} />
                                <label>{incidentAppealT('evidence')}
                                    <textarea name="activationAppealEvidence" rows={3} required />
                                </label>
                                <button disabled={saving} type="submit">
                                    {incidentAppealT('open')}
                                </button>
                            </form>
                        ) : null}
                        {incident.activationAppeal?.state === 'open'
                            && workspace?.viewer.roles.includes('platform_safety_policy_admin') ? (
                            <form className={styles.reviewForm} onSubmit={resolveIncidentActivationAppeal}>
                                <input type="hidden" name="appealId" value={incident.activationAppeal.id} />
                                <label>{incidentAppealT('reviewEvidence')}
                                    <textarea name="activationAppealReviewEvidence" rows={3} required />
                                </label>
                                <div>
                                    <button disabled={saving} type="submit" value="uphold">
                                        {incidentAppealT('uphold')}
                                    </button>
                                    <button disabled={saving} type="submit" value="revoke">
                                        {incidentAppealT('revoke')}
                                    </button>
                                </div>
                            </form>
                        ) : null}
                        {incident.state === 'active'
                            && workspace?.viewer.roles.includes('platform_safety_audit_reviewer') ? (
                            <form className={styles.reviewForm} onSubmit={mutateIncidentLifecycle}>
                                <input type="hidden" name="incidentId" value={incident.id} />
                                <label>{incidentT('extension')}
                                    <select name="additionalDurationSeconds" defaultValue="900">
                                        <option value="900">15 min</option>
                                        <option value="3600">60 min</option>
                                    </select>
                                </label>
                                <label>{incidentT('mergeSource')}
                                    <select name="sourceIncidentId" defaultValue="">
                                        <option value="">{incidentT('mergeSelect')}</option>
                                        {safetyIncidents.filter((candidate) => (
                                            candidate.id !== incident.id
                                            && candidate.state === 'active'
                                            && candidate.targetCircleId === incident.targetCircleId
                                        )).map((candidate) => (
                                            <option value={candidate.id} key={candidate.id}>
                                                {candidate.category} · {candidate.id}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label>{incidentT('lifecycleEvidence')}
                                    <textarea name="lifecycleEvidence" rows={3} required />
                                </label>
                                <div>
                                    <button disabled={saving || incident.severity === 'sev1'} type="submit" value="upgrade">
                                        {incidentT('upgrade')}
                                    </button>
                                    <button disabled={saving} type="submit" value="extend">
                                        {incidentT('extend')}
                                    </button>
                                    <button disabled={saving} type="submit" value="merge">
                                        {incidentT('merge')}
                                    </button>
                                </div>
                            </form>
                        ) : null}
                        {incident.state === 'review_required'
                            && workspace?.viewer.roles.includes('platform_safety_audit_reviewer') ? (
                            <form className={styles.reviewForm} onSubmit={reviewIncident}>
                                <input type="hidden" name="incidentId" value={incident.id} />
                                <label>{incidentT('reviewEvidence')}<textarea name="reviewEvidence" rows={3} required /></label>
                                <button disabled={saving} type="submit">{incidentT('review')}</button>
                            </form>
                        ) : null}
                    </article>
                ))}
                {workspace && safetyIncidents.length === 0 ? <p className={styles.empty}>{incidentT('empty')}</p> : null}
            </section>

            <section className={styles.incidents} aria-labelledby="legal-statuses">
                <div className={styles.sectionTitle}>
                    <div><p>Legal lifecycle</p><h2 id="legal-statuses">Active legal statuses</h2></div>
                    <span>{workspace?.legalStatuses.length ?? 0}</span>
                </div>
                {workspace?.legalStatuses.map((status) => (
                    <article className={styles.incident} key={status.effectId}>
                        <div><strong>{status.status}</strong><span>{status.state} · {status.jurisdiction}</span></div>
                        <dl>
                            <div><dt>{t('content')}</dt><dd>{status.contentId}</dd></div>
                            <div><dt>{t('receipt')}</dt><dd>{status.receiptId}</dd></div>
                            <div><dt>{t('effect')}</dt><dd>{status.effectId}</dd></div>
                            <div><dt>Projection</dt><dd>{status.legalSafeProjection.ordinaryRead} / {status.legalSafeProjection.listRead}</dd></div>
                            <div><dt>Appeal deadline</dt><dd>{status.appealWindowEndsAt ? new Date(status.appealWindowEndsAt).toLocaleString() : 'none'}</dd></div>
                            <div><dt>Legal digest</dt><dd>{status.legalStatusDigest}</dd></div>
                            <div><dt>Previous</dt><dd>{status.previousLegalStatusDigest ?? 'none'}</dd></div>
                        </dl>
                        <small>Original material export: disabled · AI export: disabled · Knowledge export: disabled</small>
                    </article>
                ))}
                {workspace && workspace.legalStatuses.length === 0 ? <p className={styles.empty}>No active legal status effect.</p> : null}
            </section>

            <section className={styles.incidents} aria-labelledby="break-glass-audit">
                <div className={styles.sectionTitle}>
                    <div><p>Break-glass audit</p><h2 id="break-glass-audit">Protected evidence access</h2></div>
                    <span>{workspace?.breakGlassAccesses.length ?? 0}</span>
                </div>
                {workspace?.breakGlassAccesses.map((access) => (
                    <article className={styles.incident} key={access.id}>
                        <div><strong>{access.evidenceSubjectType}</strong><span>{access.state} · {access.purposeCode}</span></div>
                        <dl>
                            <div><dt>Evidence receipt</dt><dd>{access.evidenceReceiptId}</dd></div>
                            <div><dt>Incident</dt><dd>{access.safetyIncidentId}</dd></div>
                            <div><dt>Requester</dt><dd>{access.requesterPubkey}</dd></div>
                            <div><dt>Approver</dt><dd>{access.approverPubkey}</dd></div>
                            <div><dt>Actual access</dt><dd>{new Date(access.actualAccessRecordedAt).toLocaleString()}</dd></div>
                            <div><dt>{t('expiry')}</dt><dd>{new Date(access.expiresAt).toLocaleString()}</dd></div>
                            <div><dt>{t('receipt')}</dt><dd>{access.receiptId}</dd></div>
                        </dl>
                        <small>
                            Alert required: {access.alertRequired ? 'yes' : 'no'} · after-action review required: {access.afterActionReviewRequired ? 'yes' : 'no'} · raw evidence export: {access.originalMaterialExport ? 'enabled' : 'disabled'}
                        </small>
                    </article>
                ))}
                {workspace && workspace.breakGlassAccesses.length === 0 ? <p className={styles.empty}>No break-glass evidence access has been recorded.</p> : null}
            </section>

            <section className={styles.incidents} aria-labelledby="active-incidents">
                <div className={styles.sectionTitle}>
                    <div><p>{t('readbackEyebrow')}</p><h2 id="active-incidents">{t('readbackTitle')}</h2></div>
                    <span>{workspace?.incidents.length ?? 0}</span>
                </div>
                {!workspace ? <p className={styles.empty}>{t('roleRequired')}</p> : null}
                {workspace?.incidents.map((incident) => (
                    <article className={styles.incident} key={incident.incidentRef}>
                        <div><strong>{incident.category}</strong><span>{incident.severity} · {incident.state}</span></div>
                        <dl>
                            <div><dt>{t('content')}</dt><dd>{incident.contentId}</dd></div>
                            <div><dt>{t('expiry')}</dt><dd>{new Date(incident.expiresAt).toLocaleString()}</dd></div>
                            <div><dt>{t('receipt')}</dt><dd>{incident.receiptId}</dd></div>
                            <div><dt>{t('effect')}</dt><dd>{incident.effectId}</dd></div>
                        </dl>
                        {workspace.viewer.roles.includes('platform_safety_case_responder') ? (
                            <button type="button" disabled={saving} onClick={() => void release(incident.contentId, incident.circleId)}>
                                {releaseT('action')}
                            </button>
                        ) : null}
                        {incident.appeal?.state === 'open'
                            && workspace.viewer.roles.includes('platform_safety_appeal_reviewer') ? (
                            <form className={styles.reviewForm} onSubmit={resolveAppeal}>
                                <input type="hidden" name="appealId" value={incident.appeal.id} />
                                <label>{appealT('reviewEvidence')}
                                    <textarea name="reviewEvidence" rows={3} required />
                                </label>
                                <div>
                                    <button disabled={saving} type="submit" name="outcome" value="uphold">
                                        {appealT('uphold')}
                                    </button>
                                    <button disabled={saving} type="submit" name="outcome" value="revoke">
                                        {appealT('revoke')}
                                    </button>
                                </div>
                            </form>
                        ) : null}
                    </article>
                ))}
                {workspace && workspace.incidents.length === 0 ? <p className={styles.empty}>{t('empty')}</p> : null}
            </section>
        </main>
    );
}
