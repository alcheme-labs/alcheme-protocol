import { Prisma } from '@prisma/client';

import {
  buildGovernanceCrossInstitutionDisclosureImpact,
  buildGovernanceMandateTerms,
  computeGovernanceMandateTermsDigest,
  listCommitteeEligibleActors,
  normalizeGovernanceMandateMinimumConstraints,
  normalizeGovernanceMandateOperatorPolicyConstraints,
  resolveActiveCircleGovernanceBinding,
  type GovernanceMandateMinimumConstraints,
  type GovernanceMandateOperatorPolicyConstraints,
  type GovernanceMandatePurposeBinding,
  type GovernanceMandateVersionRecord,
  type GovernanceCrossInstitutionDisclosureImpact,
} from './circleGovernanceBindings';
import { createGovernanceCaseIntake } from './governanceCase';
import { resolveCommitteeMemberThresholdConfig } from './strategies/committeeMemberThreshold';

export async function proposeActiveGovernanceMandateSupersede(
  prisma: any,
  input: {
    mandateId: string;
    targetCircleId: number;
    actorPubkey: string;
    actorRole: string;
    effectiveUntil: Date;
    acceptanceExpiresAt: Date;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints;
    crossInstitutionDisclosureDeclaration?: unknown;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ governanceCase: any; mandateVersion: GovernanceMandateVersionRecord; replayed: boolean }> {
  const now = input.now ?? new Date();
  const current = await prisma.governanceMandate.findUnique({
    where: { id: input.mandateId },
    include: {
      binding: true,
      versions: { orderBy: { version: 'desc' } },
    },
  });
  const binding = current?.binding;
  const versions = Array.isArray(current?.versions) ? current.versions : [];
  const currentVersion = versions.find((version: any) => version.version === current?.currentVersion);
  const latestVersion = versions[0] ?? null;
  if (
    !current
    || !binding
    || current.delegatorGovernanceHomeType !== 'circle'
    || current.delegatorGovernanceHomeRef !== String(input.targetCircleId)
    || binding.targetCircleId !== input.targetCircleId
    || binding.mandateId !== current.id
    || current.status !== 'active'
    || current.targetAuthorizationStatus !== 'accepted'
    || current.committeeAcceptanceStatus !== 'accepted'
    || binding.status !== 'active'
    || binding.targetAuthorizationStatus !== 'accepted'
    || binding.committeeMandateStatus !== 'accepted'
    || !currentVersion
    || currentVersion.termsDigest !== current.currentTermsDigest
    || currentVersion.targetAcceptedTermsDigest !== current.currentTermsDigest
    || currentVersion.committeeAcceptedTermsDigest !== current.currentTermsDigest
  ) {
    throw new Error('governance_mandate_supersede_state_mismatch');
  }
  const currentEffectiveUntil = new Date(currentVersion.effectiveUntil);
  const minimumConstraints = normalizeGovernanceMandateMinimumConstraints(
    input.minimumConstraints,
  );
  const existingCase = await prisma.governanceCase.findFirst({
    where: {
      idempotencyKey: input.idempotencyKey,
      subjectType: 'circle_governance_binding',
      subjectRef: binding.id,
    },
    include: {
      homeIdentityBinding: { select: { homeType: true, homeRef: true } },
      primaryRequest: true,
      responsibilities: true,
      timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (existingCase) {
    const payload = asRecord(existingCase.requestedActionPayload);
    const mandateTerms = asRecord(payload.mandateTerms);
    const storedMinimumConstraints = normalizeGovernanceMandateMinimumConstraints(
      mandateTerms.minimumConstraints,
    );
    const mandateVersion = versions.find(
      (version: any) => version.version === Number(payload.mandateVersion),
    );
    if (
      existingCase.openedByPubkey !== input.actorPubkey
      || payload.bindingId !== binding.id
      || payload.mandateId !== current.id
      || payload.targetCircleId !== binding.targetCircleId
      || payload.committeeCircleId !== binding.committeeCircleId
      || payload.acceptanceExpiresAt !== input.acceptanceExpiresAt.toISOString()
      || mandateTerms.effectiveUntil !== input.effectiveUntil.toISOString()
      || storedMinimumConstraints.riskFloor !== minimumConstraints.riskFloor
      || storedMinimumConstraints.minimumApprovalThreshold
        !== minimumConstraints.minimumApprovalThreshold
      || storedMinimumConstraints.minimumTimelockSeconds
        !== minimumConstraints.minimumTimelockSeconds
      || !disclosureDeclarationMatchesImpact(
        input.crossInstitutionDisclosureDeclaration,
        mandateTerms.crossInstitutionDisclosureImpact ?? null,
      )
      || !mandateVersion
      || mandateVersion.termsDigest !== payload.mandateTermsDigest
      || computeGovernanceMandateTermsDigest(mandateTerms as any) !== mandateVersion.termsDigest
    ) {
      throw new Error('governance_mandate_supersede_idempotency_conflict');
    }
    return { governanceCase: existingCase, mandateVersion, replayed: true };
  }
  if (
    Number.isNaN(input.effectiveUntil.getTime())
    || Number.isNaN(input.acceptanceExpiresAt.getTime())
    || input.effectiveUntil <= now
    || input.acceptanceExpiresAt <= now
    || input.acceptanceExpiresAt >= input.effectiveUntil
    || Number.isNaN(currentEffectiveUntil.getTime())
    || input.acceptanceExpiresAt > currentEffectiveUntil
  ) {
    throw new Error('governance_mandate_supersede_window_invalid');
  }
  const eligibleActors = await listCommitteeEligibleActors(prisma, {
    committeeCircleId: binding.committeeCircleId,
  });
  const targetCircle = await prisma.circle.findUnique({
    where: { id: input.targetCircleId },
    select: { circleType: true },
  });
  if (!targetCircle) throw new Error('circle_not_found');
  const hasOperationalPurpose = currentVersion.terms.purposeBindings.some(
    (binding: GovernanceMandatePurposeBinding) => binding.purpose === 'operational_execution',
  );
  const operatorPolicyConstraints = hasOperationalPurpose
    ? normalizeGovernanceMandateOperatorPolicyConstraints(
        input.operatorPolicyConstraints
          ?? currentVersion.terms.purposeBindings.find(
            (binding: GovernanceMandatePurposeBinding) => binding.purpose === 'operational_execution',
          )?.operatorPolicy?.limits,
      )
    : undefined;
  const currentDisclosureImpact = currentVersion.terms.crossInstitutionDisclosureImpact;
  const crossInstitutionDisclosureImpact = buildGovernanceCrossInstitutionDisclosureImpact({
    homeCircleType: String(targetCircle.circleType ?? ''),
    committeeCircleId: binding.committeeCircleId,
    eligibleActors,
    purposeBindings: currentVersion.terms.purposeBindings.map(
      (purposeBinding: GovernanceMandatePurposeBinding) => ({
        purpose: purposeBinding.purpose,
        actionType: purposeBinding.actionSelector.actionType,
        actionPrefix: purposeBinding.actionSelector.actionPrefix,
      }),
    ),
    declaration: input.crossInstitutionDisclosureDeclaration ?? (currentDisclosureImpact
      ? {
        dataCategories: currentDisclosureImpact.dataCategories,
        recipientRegions: currentDisclosureImpact.recipientRegions,
        retentionDays: currentDisclosureImpact.retention.maximumDays,
      }
      : null),
  });
  const mandateTerms = buildGovernanceMandateTerms({
    delegatorGovernanceHome: {
      type: current.delegatorGovernanceHomeType,
      ref: current.delegatorGovernanceHomeRef,
    },
    delegateAuthority: {
      type: current.delegateAuthorityType,
      ref: current.delegateAuthorityRef,
    },
    subject: { ...currentVersion.terms.subject },
    purposeBindings: currentVersion.terms.purposeBindings.map((binding: GovernanceMandatePurposeBinding) => ({
      purpose: binding.purpose,
      actionType: binding.actionSelector.actionType,
      actionPrefix: binding.actionSelector.actionPrefix,
    })),
    actionType: currentVersion.terms.actionSelector.actionType,
    actionPrefix: currentVersion.terms.actionSelector.actionPrefix,
    operatorActors: currentVersion.terms.purposeBindings.some(
      (binding: GovernanceMandatePurposeBinding) => binding.purpose === 'operational_execution',
    )
      ? eligibleActors
      : undefined,
    operatorPolicyConstraints,
    effectiveFrom: now,
    effectiveUntil: input.effectiveUntil,
    network: currentVersion.terms.network,
    minimumConstraints,
    feePolicy: currentVersion.terms.feePolicy,
    effectPolicy: currentVersion.terms.effectPolicy,
    crossInstitutionDisclosureImpact,
  });
  const mandateTermsDigest = computeGovernanceMandateTermsDigest(mandateTerms);
  if (mandateTermsDigest === current.currentTermsDigest) {
    throw new Error('governance_mandate_supersede_terms_unchanged');
  }

  const authority = await resolveActiveCircleGovernanceBinding(prisma, {
    targetCircleId: input.targetCircleId,
    actionType: 'circle.governance_binding.accept_mandate',
    authorityBindingId: binding.id,
    subjectType: 'circle_governance_binding',
    subjectRef: binding.id,
    now,
  });
  if (!authority || authority.binding.id !== binding.id) {
    throw new Error('governance_mandate_supersede_authority_unavailable');
  }
  if (eligibleActors.length < minimumConstraints.minimumApprovalThreshold) {
    throw new Error('governance_mandate_minimum_quorum_unreachable');
  }
  const policyConfig = resolveCommitteeMemberThresholdConfig(
    authority.policyVersion.rules,
    binding.ruleId,
  );
  const configuredThreshold = policyConfig.threshold?.mode === 'unanimity'
    ? eligibleActors.length
    : policyConfig.threshold?.mode === 'fixed_count'
      ? Number(policyConfig.threshold.value)
      : Math.floor(eligibleActors.length / 2) + 1;
  if (configuredThreshold < minimumConstraints.minimumApprovalThreshold) {
    throw new Error('governance_mandate_minimum_quorum_not_met');
  }

  const pendingVersion = latestVersion
    && latestVersion.version > current.currentVersion
    && latestVersion.committeeAcceptedTermsDigest == null
    && latestVersion.sourceDecisionDigest == null
    ? latestVersion
    : null;
  if (pendingVersion && pendingVersion.termsDigest !== mandateTermsDigest) {
    throw new Error('governance_mandate_supersede_pending');
  }
  const nextVersion = pendingVersion?.version ?? Math.max(
    current.currentVersion,
    ...versions.map((version: any) => Number(version.version) || 0),
  ) + 1;
  const versionId = `${current.id}:v${nextVersion}`;
  const requestedActionPayload = {
    bindingId: binding.id,
    mandateId: current.id,
    mandateVersion: nextVersion,
    mandateTermsDigest,
    supersedesMandateVersion: current.currentVersion,
    supersedesMandateTermsDigest: current.currentTermsDigest,
    targetCircleId: binding.targetCircleId,
    committeeCircleId: binding.committeeCircleId,
    actionScope: currentVersion.terms.actionSelector.actionType
      ?? currentVersion.terms.actionSelector.actionPrefix,
    acceptanceExpiresAt: input.acceptanceExpiresAt.toISOString(),
    mandateTerms,
  };

  return prisma.$transaction(async (tx: any) => {
    const mandateVersion = pendingVersion ?? await tx.governanceMandateVersion.create({
      data: {
        id: versionId,
        mandateId: current.id,
        version: nextVersion,
        terms: mandateTerms as unknown as Prisma.InputJsonValue,
        termsDigest: mandateTermsDigest,
        purposeBindings: mandateTerms.purposeBindings as unknown as Prisma.InputJsonValue,
        environment: mandateTerms.environment,
        network: mandateTerms.network,
        subjectType: mandateTerms.subject.type,
        subjectRef: mandateTerms.subject.ref,
        actionType: mandateTerms.actionSelector.actionType,
        actionPrefix: mandateTerms.actionSelector.actionPrefix,
        effectiveFrom: now,
        effectiveUntil: input.effectiveUntil,
        targetAcceptedAt: now,
        targetAcceptedByPubkey: input.actorPubkey,
        targetAcceptedTermsDigest: mandateTermsDigest,
        createdByPubkey: input.actorPubkey,
      },
    });
    const mandateUpdated = await tx.governanceMandate.updateMany({
      where: {
        id: current.id,
        status: 'active',
        currentVersion: current.currentVersion,
        currentTermsDigest: current.currentTermsDigest,
        targetAuthorizationStatus: 'accepted',
        committeeAcceptanceStatus: 'accepted',
      },
      data: { acceptanceExpiresAt: input.acceptanceExpiresAt },
    });
    if (mandateUpdated.count !== 1) {
      throw new Error('governance_mandate_supersede_stale_write');
    }
    const intake = await createGovernanceCaseIntake(tx, {
      circleId: input.targetCircleId,
      title: `Replace active governance Mandate v${current.currentVersion} with v${nextVersion}`,
      requestedDecision: `Approve Mandate v${nextVersion} as the successor to active Mandate v${current.currentVersion}.`,
      requestedActionPayload,
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: 'circle.governance_binding.accept_mandate',
      subjectType: 'circle_governance_binding',
      subjectRef: binding.id,
      authorityBindingId: binding.id,
      decisionMechanismKind: 'equal_weight_threshold',
      originKind: 'manual_item',
      sourceMessageIds: [],
      idempotencyKey: input.idempotencyKey,
      openedByPubkey: input.actorPubkey,
      actorRole: input.actorRole,
      openedAt: now,
    });
    return { governanceCase: intake.governanceCase, mandateVersion, replayed: intake.replayed };
  });
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function disclosureDeclarationMatchesImpact(
  declaration: unknown,
  impact: GovernanceCrossInstitutionDisclosureImpact | null,
): boolean {
  if (declaration === undefined) return true;
  if (impact === null) return declaration === null;
  const record = asRecord(declaration);
  const categoryOrder = [
    'redacted_allegation',
    'subject_reference',
    'evidence_digest',
    'operation_status',
  ];
  const rawCategories = Array.isArray(record.dataCategories)
    ? record.dataCategories.map(String)
    : [];
  const dataCategories = categoryOrder.filter((category) => rawCategories.includes(category));
  const rawRegions = Array.isArray(record.recipientRegions)
    ? record.recipientRegions.map(String)
    : [];
  const recipientRegions = [...new Set(rawRegions.map((region) => region.trim().toUpperCase()))]
    .sort();
  const retentionDays = Number(record.retentionDays);
  return rawCategories.length === dataCategories.length
    && rawRegions.length === recipientRegions.length
    && Number.isSafeInteger(retentionDays)
    && retentionDays === impact.retention.maximumDays
    && sameStrings(dataCategories, impact.dataCategories)
    && sameStrings(recipientRegions, impact.recipientRegions);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
