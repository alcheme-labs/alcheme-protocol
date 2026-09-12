'use client';

import { useEffect, useState } from 'react';

import {
    fetchCircleGovernanceCaseTemplates,
    type GovernanceCaseTemplateCatalog,
    type GovernanceCaseType,
} from '@/lib/api/governance';
import { Select } from '@/components/ui/Select';
import { useI18n } from '@/i18n/useI18n';
import styles from './GovernanceCaseTemplatePicker.module.css';

export type GovernanceExternalActionUserReadiness =
    | 'configurable'
    | 'pending_authorization'
    | 'ready_for_case'
    | 'service_unavailable'
    | 'network_mismatch'
    | 'historical_read_only';

export interface GovernanceCaseTemplateDraft {
    templateId: string;
    actionType: string | null;
    actionUserReadiness?: GovernanceExternalActionUserReadiness | null;
    actionNextStep?: 'configure_governance_binding' | 'select_subject' | 'open_case' | null;
    decisionMechanismKind: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding';
    quadraticVoiceChoices: string[];
    quadraticFundingRound: {
        roundRef: string;
        budgetUnit: string;
        matchingBudget: number;
        commitmentCapPerActorPerProject: number;
        projects: Array<{ label: string; projectRef: string; recipientRef: string; allocationCap: number }>;
        excludedProjects: Array<{ projectRef: string; reason: string }>;
    };
    selectionRanking: null | {
        seatCount: number;
        candidates: Array<{ label: string; candidateRef: string; score: number }>;
        excludedCandidates: Array<{ candidateRef: string; reason: string }>;
    };
}

const EMPTY_QF_ROUND: GovernanceCaseTemplateDraft['quadraticFundingRound'] = {
    roundRef: '',
    budgetUnit: 'allocation_unit',
    matchingBudget: 100,
    commitmentCapPerActorPerProject: 100,
    projects: [],
    excludedProjects: [],
};

export default function GovernanceCaseTemplatePicker({
    circleId,
    caseType,
    value,
    onChange,
    disabled = false,
}: {
    circleId: number;
    caseType: GovernanceCaseType;
    value: GovernanceCaseTemplateDraft | null;
    onChange(value: GovernanceCaseTemplateDraft | null): void;
    disabled?: boolean;
}) {
    const t = useI18n('GovernanceCases');
    const [catalog, setCatalog] = useState<GovernanceCaseTemplateCatalog | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setFailed(false);
        setCatalog(null);
        onChange(null);
        fetchCircleGovernanceCaseTemplates(circleId, caseType)
            .then((result) => {
                if (!active) return;
                setCatalog(result);
                const first = result.availableTemplates[0];
                if (first && caseType !== 'policy') {
                    onChange({
                        templateId: first.templateId,
                        actionType: null,
                        actionUserReadiness: null,
                        actionNextStep: null,
                        decisionMechanismKind: 'equal_weight_threshold',
                        quadraticVoiceChoices: [],
                        quadraticFundingRound: { ...EMPTY_QF_ROUND },
                        selectionRanking: null,
                    });
                }
            })
            .catch(() => {
                if (active) setFailed(true);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [caseType, circleId, onChange]);

    const templateId = value?.templateId ?? '';
    const actionType = value?.actionType ?? '';
    const isDocumentAdoption = actionType === 'circle.policy.document.adopt';
    const decisionMechanismKind = value?.decisionMechanismKind ?? 'equal_weight_threshold';
    const actionLabel = (nextActionType: string) => {
        const key = `template.actionLabels.${nextActionType.replace(/\./g, '_')}`;
        return t.has(key) ? `${t(key)} (${nextActionType})` : nextActionType;
    };
    const reasonLabel = (reason: string) => {
        const key = `template.reason.${reason}`;
        // Provider diagnostics can contain runtime data (for example a profile
        // digest), or a code from a newer server. Preserve it without asking
        // next-intl to translate a key that is not in this client's catalog.
        return t.has(key) ? t(key) : reason;
    };
    const selectedAction = catalog?.actionOptions.find((action) => action.actionType === actionType) ?? null;
    const updateTemplate = (nextTemplateId: string) => {
        onChange(nextTemplateId
            ? {
                templateId: nextTemplateId,
                actionType: caseType === 'policy' ? null : value?.actionType ?? null,
                actionUserReadiness: caseType === 'policy' ? null : value?.actionUserReadiness ?? null,
                actionNextStep: caseType === 'policy' ? null : value?.actionNextStep ?? null,
                decisionMechanismKind: 'equal_weight_threshold',
                quadraticVoiceChoices: [],
                quadraticFundingRound: { ...EMPTY_QF_ROUND },
                selectionRanking: null,
            }
            : null);
    };
    const updateAction = (nextActionType: string) => {
        if (!templateId) return;
        const option = catalog?.actionOptions.find((action) => action.actionType === nextActionType);
        const documentAdoption = nextActionType === 'circle.policy.document.adopt';
        onChange({
            templateId,
            actionType: nextActionType || null,
            actionUserReadiness: option?.userReadiness ?? null,
            actionNextStep: option?.nextStep ?? null,
            decisionMechanismKind: documentAdoption ? 'equal_weight_threshold' : decisionMechanismKind,
            quadraticVoiceChoices: documentAdoption ? [] : value?.quadraticVoiceChoices ?? [],
            quadraticFundingRound: value?.quadraticFundingRound ?? { ...EMPTY_QF_ROUND },
            selectionRanking: documentAdoption ? null : value?.selectionRanking ?? null,
        });
    };
    const updateMechanism = (kind: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding') => {
        if (!templateId) return;
        onChange({
            templateId,
            actionType: value?.actionType ?? null,
            actionUserReadiness: value?.actionUserReadiness ?? null,
            actionNextStep: value?.actionNextStep ?? null,
            decisionMechanismKind: kind,
            quadraticVoiceChoices: kind === 'quadratic_voice_credits'
                ? value?.quadraticVoiceChoices ?? []
                : [],
            quadraticFundingRound: value?.quadraticFundingRound ?? { ...EMPTY_QF_ROUND },
            selectionRanking: kind === 'equal_weight_threshold' ? value?.selectionRanking ?? null : null,
        });
    };
    const bindingSettingsHref = `?tab=governance&settings=governance`;
    const readinessKey = selectedAction?.userReadiness
        ?? value?.actionUserReadiness
        ?? null;
    const actionNextStep = selectedAction?.nextStep
        ?? value?.actionNextStep
        ?? null;
    const selectingSubject = actionNextStep === 'select_subject';

    if (loading) return <p className={styles.status}>{t('template.loading')}</p>;
    if (failed) return <p className={styles.error} role="alert">{t('template.loadError')}</p>;
    if (!catalog || catalog.availableTemplates.length === 0) {
        const reasons = catalog?.excludedTemplates.flatMap((item) => item.reasonCodes) ?? [];
        return (
            <div className={styles.unavailable} role="status">
                <strong>{t('template.unavailable')}</strong>
                <span>{reasons.map(reasonLabel).join(' · ')}</span>
            </div>
        );
    }
    return (
        <div className={styles.root}>
            <label className={styles.field}>
                <span>{t('template.label')}</span>
                <Select
                    ariaLabel={t('template.label')}
                    value={templateId}
                    disabled={disabled}
                    onChange={updateTemplate}
                    options={[
                        { value: '', label: t('template.choose'), disabled: true },
                        ...catalog.availableTemplates.map((template) => ({
                            value: template.templateId,
                            label: t(`template.name.${template.templateId}`),
                        })),
                    ]}
                />
            </label>
            {caseType === 'policy' && templateId && (
                <>
                    <label className={styles.field}>
                        <span>{t('template.action')}</span>
                        <Select
                            ariaLabel={t('template.action')}
                            value={actionType}
                            disabled={disabled}
                            onChange={updateAction}
                            menuClassName={styles.actionMenu}
                            optionClassName={styles.actionOption}
                            options={[
                                { value: '', label: t('template.chooseAction'), disabled: true },
                                ...catalog.actionOptions.map((action) => ({
                                    value: action.actionType,
                                    label: action.userReadiness
                                        ? `${actionLabel(action.actionType)} · ${t(`template.readiness.${action.userReadiness}`)}`
                                        : actionLabel(action.actionType),
                                    disabled: action.userReadiness === 'historical_read_only'
                                        || action.userReadiness === 'service_unavailable'
                                        || action.userReadiness === 'network_mismatch',
                                })),
                            ]}
                        />
                    </label>
                    {readinessKey ? (
                        <div
                            className={styles.participation}
                            role="status"
                            data-action-readiness={readinessKey}
                            data-testid="governance-action-readiness"
                        >
                            <strong>{selectingSubject
                                ? t('template.readinessNextStep.selectSubject')
                                : t(`template.readiness.${readinessKey}`)}</strong>
                            {readinessKey !== 'ready_for_case' ? (
                                <span>{selectingSubject
                                    ? t('template.readinessHint.select_subject')
                                    : isDocumentAdoption && (readinessKey === 'configurable' || readinessKey === 'pending_authorization')
                                        ? t('template.documentAdoptionAuthorityRequired')
                                        : t(`template.readinessHint.${readinessKey}`)}</span>
                            ) : null}
                            {actionNextStep === 'configure_governance_binding' ? (
                                <a href={bindingSettingsHref} data-testid="governance-action-next-step">
                                    {t('template.readinessNextStep.configureBinding')}
                                </a>
                            ) : null}
                        </div>
                    ) : null}
                    {isDocumentAdoption ? (
                        <p className={styles.participation} data-testid="document-adoption-help">
                            {t('template.documentAdoptionHint')}
                        </p>
                    ) : null}
                    {!isDocumentAdoption && decisionMechanismKind === 'equal_weight_threshold' ? (
                        <>
                            <label className={styles.field}>
                                <span>{t('template.decisionOutput')}</span>
                                <Select
                                    ariaLabel={t('template.decisionOutput')}
                                    value={value?.selectionRanking ? 'selection_result' : 'policy_document'}
                                    disabled={disabled}
                                    onChange={(next) => onChange({
                                        ...value!,
                                        selectionRanking: next === 'selection_result'
                                            ? { seatCount: 1, candidates: [], excludedCandidates: [] }
                                            : null,
                                    })}
                                    options={[
                                        { value: 'policy_document', label: t('template.decisionOutputPolicy') },
                                        { value: 'selection_result', label: t('template.decisionOutputSelection') },
                                    ]}
                                />
                            </label>
                            {value?.selectionRanking ? (
                                <div className={styles.root}>
                                    <label>
                                        <span>Seat count</span>
                                        <input type="number" min={1} value={value.selectionRanking.seatCount} onChange={(event) => onChange({
                                            ...value,
                                            selectionRanking: { ...value.selectionRanking!, seatCount: Number(event.target.value) },
                                        })} disabled={disabled} required />
                                    </label>
                                    <label>
                                        <span>Eligible candidates</span>
                                        <textarea value={value.selectionRanking.candidates.map((candidate) => [candidate.label, candidate.candidateRef, candidate.score].join(' | ')).join('\n')} onChange={(event) => onChange({
                                            ...value,
                                            selectionRanking: {
                                                ...value.selectionRanking!,
                                                candidates: event.target.value.split('\n').filter(Boolean).map((line) => {
                                                    const [label = '', candidateRef = '', score = '-1'] = line.split('|').map((item) => item.trim());
                                                    return { label, candidateRef, score: Number(score) };
                                                }),
                                            },
                                        })} placeholder="Label | case:<case-id> / draft:<post-id>:<version> / artifact:<artifact-id> | integer score" disabled={disabled} required />
                                    </label>
                                    <label>
                                        <span>Excluded candidates (optional)</span>
                                        <textarea value={value.selectionRanking.excludedCandidates.map((candidate) => [candidate.candidateRef, candidate.reason].join(' | ')).join('\n')} onChange={(event) => onChange({
                                            ...value,
                                            selectionRanking: {
                                                ...value.selectionRanking!,
                                                excludedCandidates: event.target.value.split('\n').filter(Boolean).map((line) => {
                                                    const [candidateRef = '', reason = ''] = line.split('|').map((item) => item.trim());
                                                    return { candidateRef, reason };
                                                }),
                                            },
                                        })} placeholder="candidate ref | exclusion reason" disabled={disabled} />
                                    </label>
                                    <small>Only existing same-Home Case, Draft snapshot, or Artifact refs are accepted. Ranking uses higher integer score first, then candidate ref; the accepted governance Decision makes the list formal. AI authority is disabled.</small>
                                </div>
                            ) : null}
                        </>
                    ) : null}
                    {!isDocumentAdoption ? <label className={styles.field}>
                        <span>{t('template.mechanism')}</span>
                        <Select
                            ariaLabel={t('template.mechanism')}
                            value={decisionMechanismKind}
                            disabled={disabled}
                            onChange={(next) => updateMechanism(next as typeof decisionMechanismKind)}
                            options={catalog.mechanisms
                                .filter((item) => item.availability === 'available')
                                .map((item) => ({
                                    value: item.kind,
                                    label: t(`template.mechanisms.kind.${item.kind}`),
                                }))}
                        />
                    </label> : null}
                    {decisionMechanismKind === 'quadratic_voice_credits' ? (
                        <label>
                            <span>{t('template.qvChoices')}</span>
                            <textarea
                                value={(value?.quadraticVoiceChoices ?? []).join('\n')}
                                onChange={(event) => onChange({
                                    templateId,
                                    actionType: value?.actionType ?? null,
                                    decisionMechanismKind,
                                    quadraticVoiceChoices: event.target.value.split('\n'),
                                    quadraticFundingRound: value?.quadraticFundingRound ?? { ...EMPTY_QF_ROUND },
                                    selectionRanking: null,
                                })}
                                minLength={3}
                                disabled={disabled}
                                placeholder={t('template.qvChoicesPlaceholder')}
                                required
                            />
                        </label>
                    ) : null}
                    {decisionMechanismKind === 'quadratic_funding' ? (
                        <div className={styles.root}>
                            <label>
                                <span>Round ref</span>
                                <input value={value?.quadraticFundingRound.roundRef ?? ''} onChange={(event) => onChange({
                                    ...value!, quadraticFundingRound: { ...value!.quadraticFundingRound, roundRef: event.target.value },
                                })} disabled={disabled} required />
                            </label>
                            <label>
                                <span>Budget unit</span>
                                <input value={value?.quadraticFundingRound.budgetUnit ?? 'allocation_unit'} onChange={(event) => onChange({
                                    ...value!, quadraticFundingRound: { ...value!.quadraticFundingRound, budgetUnit: event.target.value },
                                })} disabled={disabled} required />
                            </label>
                            <label>
                                <span>Matching budget</span>
                                <input type="number" min={1} value={value?.quadraticFundingRound.matchingBudget ?? 100} onChange={(event) => onChange({
                                    ...value!, quadraticFundingRound: { ...value!.quadraticFundingRound, matchingBudget: Number(event.target.value) },
                                })} disabled={disabled} required />
                            </label>
                            <label>
                                <span>Commitment cap per actor/project</span>
                                <input type="number" min={1} value={value?.quadraticFundingRound.commitmentCapPerActorPerProject ?? 100} onChange={(event) => onChange({
                                    ...value!, quadraticFundingRound: { ...value!.quadraticFundingRound, commitmentCapPerActorPerProject: Number(event.target.value) },
                                })} disabled={disabled} required />
                            </label>
                            <label>
                                <span>Eligible projects</span>
                                <textarea value={(value?.quadraticFundingRound.projects ?? []).map((project) => [project.label, project.projectRef, project.recipientRef, project.allocationCap].join(' | ')).join('\n')} onChange={(event) => onChange({
                                    ...value!, quadraticFundingRound: {
                                        ...value!.quadraticFundingRound,
                                        projects: event.target.value.split('\n').filter(Boolean).map((line) => {
                                            const [label = '', projectRef = '', recipientRef = '', cap = '0'] = line.split('|').map((item) => item.trim());
                                            return { label, projectRef, recipientRef, allocationCap: Number(cap) };
                                        }),
                                    },
                                })} placeholder="Label | case:<case-id> / draft:<post-id>:<version> / artifact:<artifact-id> | recipient-ref | allocation cap" disabled={disabled} required />
                            </label>
                            <label>
                                <span>Excluded candidates (optional)</span>
                                <textarea value={(value?.quadraticFundingRound.excludedProjects ?? []).map((project) => [project.projectRef, project.reason].join(' | ')).join('\n')} onChange={(event) => onChange({
                                    ...value!, quadraticFundingRound: {
                                        ...value!.quadraticFundingRound,
                                        excludedProjects: event.target.value.split('\n').filter(Boolean).map((line) => {
                                            const [projectRef = '', reason = ''] = line.split('|').map((item) => item.trim());
                                            return { projectRef, reason };
                                        }),
                                    },
                                })} placeholder="case:<case-id> / draft:<post-id>:<version> / artifact:<artifact-id> | exclusion reason" disabled={disabled} />
                            </label>
                            <small>Project refs must identify an existing Case, Draft snapshot, or Artifact in this Circle governance Home.</small>
                            <small>Commitments are signed allocation inputs only. This round has no funded resource, escrow, payout, or Provider finality.</small>
                        </div>
                    ) : null}
                </>
            )}
            <p className={styles.profile} data-testid="governance-template-profile-note">
                {t('template.profileReady')}
            </p>
            {catalog.participationPolicy ? (
                <div className={styles.participation} role="note">
                    <strong>{t('template.participation.title')}</strong>
                    <span>{t('template.participation.admission')}</span>
                    <span>{t('template.participation.proposal')}</span>
                    {caseType === 'policy' ? <span>{t('template.participation.voter')}</span> : null}
                    {caseType === 'policy' ? <span>{t(decisionMechanismKind === 'quadratic_voice_credits'
                        ? 'template.mechanisms.kind.quadratic_voice_credits'
                        : 'template.participation.power')}</span> : null}
                    <span>{t('template.participation.contribution')}</span>
                </div>
            ) : null}
            {catalog.mechanisms.length > 0 ? <details className={styles.mechanisms}>
                <summary id="governance-mechanism-catalog-title">{t('template.mechanisms.title')}</summary>
                <p>{t('template.mechanisms.body')}</p>
                <ul>
                    {catalog.mechanisms.map((mechanism) => (
                        <li key={mechanism.kind} data-availability={mechanism.availability}>
                            <strong>{t(`template.mechanisms.kind.${mechanism.kind}`)}</strong>
                            <span>{t(`template.mechanisms.availability.${mechanism.availability}`)}</span>
                            <dl>
                                <div><dt>{t('template.mechanisms.resource')}</dt><dd>{t(`template.mechanisms.value.${mechanism.resource}`)}</dd></div>
                                <div><dt>{t('template.mechanisms.formula')}</dt><dd>{t(`template.mechanisms.value.${mechanism.formula}`)}</dd></div>
                                <div><dt>{t('template.mechanisms.sybilRisk')}</dt><dd>{t(`template.mechanisms.value.${mechanism.sybilRisk}`)}</dd></div>
                                <div><dt>{t('template.mechanisms.result')}</dt><dd>{t(`template.mechanisms.value.${mechanism.resultType}`)}</dd></div>
                                <div><dt>{t('template.mechanisms.provider')}</dt><dd>{mechanism.provider}</dd></div>
                            </dl>
                            {mechanism.reasonCodes.length > 0 ? (
                                <small>{mechanism.reasonCodes.map(reasonLabel).join(' · ')}</small>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </details> : null}
            {catalog.providerReadiness.length > 0 ? <details className={styles.providers}>
                <summary>{t('template.providers.title')}</summary>
                <ul>
                    {catalog.providerReadiness.map((provider) => (
                        <li
                            key={provider.provider}
                            data-provider={provider.provider}
                            data-provider-lifecycle={provider.registry.lifecycle}
                            data-provider-capability-role={provider.registry.capabilityRole}
                            data-provider-evm-dependency={provider.registry.contractPortability.evmDependency}
                            data-provider-decision-authority={provider.registry.authoritySeparation.institutionalDecisionAuthority}
                            data-provider-stage-binding={provider.registry.authoritySeparation.providerStageBinding}
                            data-provider-voting-power-plugin={provider.registry.specializedReadiness.votingPowerPlugin?.availability ?? 'not_applicable'}
                            data-provider-conditional-market={provider.registry.specializedReadiness.conditionalMarket?.terminalEvidence ?? 'not_applicable'}
                            data-provider-enforcement-gateway={provider.registry.specializedReadiness.enforcementGateway.externalProviderConsumption}
                            data-provider-stage-open-gate={provider.stageGate.openStage}
                            data-provider-execute-gate={provider.stageGate.execute}
                        >
                            <div>
                                <span>{provider.provider}</span>
                                <span>{t(`template.mechanisms.availability.${provider.availability}`)}</span>
                            </div>
                            <dl>
                                <div>
                                    <dt>{t('template.providers.lifecycle')}</dt>
                                    <dd>{provider.registry.lifecycle}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.role')}</dt>
                                    <dd>{provider.registry.capabilityRole}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.boundary')}</dt>
                                    <dd>{provider.registry.availabilityBoundary}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.readback')}</dt>
                                    <dd>{provider.registry.requiredReadback.join(' · ') || t('template.providers.readbackCurrent')}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.forbiddenMappings')}</dt>
                                    <dd>{provider.registry.forbiddenMappings.join(' · ') || t('template.providers.forbiddenMappingsNone')}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.portability')}</dt>
                                    <dd>{provider.registry.contractPortability.forbiddenAssumptions.join(' · ')}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.authority')}</dt>
                                    <dd>{provider.registry.authoritySeparation.bindingCondition}</dd>
                                </div>
                                <div>
                                    <dt>{t('template.providers.specialized')}</dt>
                                    <dd>
                                        {[
                                            provider.registry.specializedReadiness.votingPowerPlugin
                                                ? [
                                                    provider.registry.specializedReadiness.votingPowerPlugin.registrarRef,
                                                    provider.registry.specializedReadiness.votingPowerPlugin.pluginProgramRef,
                                                    provider.registry.specializedReadiness.votingPowerPlugin.voterWeightRecord,
                                                    provider.registry.specializedReadiness.votingPowerPlugin.calculatedWeight,
                                                    provider.registry.specializedReadiness.votingPowerPlugin.updatedAt,
                                                    provider.registry.specializedReadiness.votingPowerPlugin.offChainContributionScore,
                                                    provider.registry.specializedReadiness.votingPowerPlugin.customPluginAvailabilityClaim,
                                                ].join(' · ')
                                                : null,
                                            provider.registry.specializedReadiness.conditionalMarket
                                                ? [
                                                    provider.registry.specializedReadiness.conditionalMarket.twap,
                                                    provider.registry.specializedReadiness.conditionalMarket.liquidity,
                                                    provider.registry.specializedReadiness.conditionalMarket.finalization,
                                                    provider.registry.specializedReadiness.conditionalMarket.feeDisclosure,
                                                    provider.registry.specializedReadiness.conditionalMarket.terminalEvidence,
                                                    provider.registry.specializedReadiness.conditionalMarket.alchemeTallyMode,
                                                ].join(' · ')
                                                : null,
                                            [
                                                provider.registry.specializedReadiness.enforcementGateway.nativeSnapshotGate,
                                                provider.registry.specializedReadiness.enforcementGateway.externalProviderConsumption,
                                                provider.registry.specializedReadiness.enforcementGateway.missingGatewayDisposition,
                                                provider.registry.specializedReadiness.enforcementGateway.requiredPolicyMapping,
                                            ].join(' · '),
                                        ].filter(Boolean).join(' · ')}
                                    </dd>
                                </div>
                            </dl>
                            {provider.reasonCodes.length > 0 ? (
                                <small>{provider.reasonCodes.map(reasonLabel).join(' · ')}</small>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </details> : null}
        </div>
    );
}
