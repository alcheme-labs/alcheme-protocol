export type GovernanceCaseActionNotificationKind =
  | 'review'
  | 'vote'
  | 'sign'
  | 'record_outcome'
  | 'review_execution_evidence'
  | 'submit_execution_evidence';

const ACTION_COPY: Record<GovernanceCaseActionNotificationKind, {
  title: string;
  body: string;
  fragment: string;
}> = {
  review: {
    title: 'Governance review requires your action',
    body: 'Open the assigned Case review and record your conclusion.',
    fragment: 'case-responsibility-review',
  },
  vote: {
    title: 'Governance vote requires your action',
    body: 'Open the frozen approval stage and submit your signed ballot before the deadline.',
    fragment: 'case-decision-stages-title',
  },
  sign: {
    title: 'Governance execution requires your action',
    body: 'Open the assigned execution task and review the current authority before acting.',
    fragment: 'case-responsibility-execution',
  },
  record_outcome: {
    title: 'Governance outcome requires your action',
    body: 'Open the assigned outcome task and record the verified result.',
    fragment: 'case-responsibility-outcome',
  },
  review_execution_evidence: {
    title: 'Manual governance execution evidence requires review',
    body: 'Open the controlled execution record and independently review the submitted evidence.',
    fragment: 'case-manual-execution-control',
  },
  submit_execution_evidence: {
    title: 'Manual governance execution evidence requires revision',
    body: 'Open the controlled execution record and submit revised evidence for independent review.',
    fragment: 'case-manual-execution-control',
  },
};

export async function persistGovernanceCaseActionRequiredNotifications(
  tx: any,
  input: {
    caseId: string;
    circleId: number;
    action: GovernanceCaseActionNotificationKind;
    recipientPubkeys: string[];
    sourceVersion: string;
    createdAt: Date;
  },
): Promise<{ recipientCount: number }> {
  const copy = ACTION_COPY[input.action];
  const recipientPubkeys = [...new Set(input.recipientPubkeys.map((value) => value.trim()))]
    .filter(Boolean)
    .sort();
  if (recipientPubkeys.length === 0) return { recipientCount: 0 };
  const recipients = await tx.user.findMany({
    where: { pubkey: { in: recipientPubkeys } },
    select: { id: true, pubkey: true },
    orderBy: { pubkey: 'asc' },
  });
  if (recipients.length === 0) return { recipientCount: 0 };
  const canonicalUrl = `/governance/cases/${encodeURIComponent(input.caseId)}#${copy.fragment}`;
  await tx.notification.createMany({
    data: recipients.map((recipient: any) => ({
      userId: recipient.id,
      type: 'governance_action_required',
      title: copy.title,
      body: copy.body,
      sourceType: 'governance_case',
      sourceId: input.caseId,
      circleId: input.circleId,
      createdAt: input.createdAt,
      metadata: {
        schemaVersion: 1,
        canonicalUrl,
        caseId: input.caseId,
        action: input.action,
        sourceVersion: input.sourceVersion,
        deliveryPolicy: 'responsibility_required_immutable',
      },
    })),
  });
  return { recipientCount: recipients.length };
}
