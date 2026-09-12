import { createHash } from 'node:crypto';

import {
  ExternalGovernedActionIntakeError,
  type GovernedActionEffect,
  type GovernedActionIntakeAdapter,
  type NativeActionPreview,
} from './externalGovernedActionIntakeTypes';

const PRIMARY_CIRCLE_BIND_ACTION = 'external_app_primary_circle_bind';

export function createExternalAppPrimaryCircleBindingAdapter(): GovernedActionIntakeAdapter {
  const effect: GovernedActionEffect = {
    kind: 'local_transactional',
    executorRef: 'external_app_circle_binding',
  };
  return {
    actionType: PRIMARY_CIRCLE_BIND_ACTION,
    effect,
    async listCandidates(context) {
      const externalAppId = String(context.externalAppId || '').trim();
      if (!externalAppId) {
        throw new ExternalGovernedActionIntakeError(400, 'external_app_id_required');
      }
      if (!Number.isSafeInteger(context.circleId) || context.circleId <= 0) {
        throw new ExternalGovernedActionIntakeError(400, 'invalid_circle_id');
      }
      const candidateRef = `${externalAppId}:${context.circleId}:primary`;
      return {
        actionType: PRIMARY_CIRCLE_BIND_ACTION,
        items: [{
          candidateRef,
          displayName: `Primary Circle #${context.circleId}`,
          statusSummary: 'eligible',
          snapshotVersion: `primary-circle-bind:v1:${candidateRef}`,
          snapshotDigest: createHash('sha256').update(candidateRef, 'utf8').digest('hex'),
        }],
        nextCursor: null,
      };
    },
    async resolveCanonicalIntent(
      context,
      candidateRef,
      expectedSnapshotVersion,
      expectedSnapshotDigest,
    ) {
      const page = await this.listCandidates(context);
      const item = page.items.find((entry) => entry.candidateRef === candidateRef);
      if (!item) {
        throw new ExternalGovernedActionIntakeError(404, 'primary_circle_bind_candidate_not_found');
      }
      const expectedDigest = String(expectedSnapshotDigest || '')
        .trim()
        .toLowerCase()
        .replace(/^sha256:/, '');
      if (
        item.snapshotVersion !== expectedSnapshotVersion
        || item.snapshotDigest !== expectedDigest
      ) {
        throw new ExternalGovernedActionIntakeError(409, 'primary_circle_bind_candidate_stale');
      }
      const externalAppId = String(context.externalAppId || '').trim();
      const bindingId = `pending:${candidateRef}`;
      const preview: NativeActionPreview = {
        title: 'Bind primary Circle',
        summary: `Authorize primary Circle #${context.circleId} for this External Program.`,
        displayName: item.displayName,
        statusSummary: item.statusSummary,
        technicalDetailsCollapsed: true,
      };
      return {
        actionType: PRIMARY_CIRCLE_BIND_ACTION,
        effect,
        subjectType: 'external_app_circle_binding',
        subjectRef: bindingId,
        operationPayload: {
          externalAppId,
          circleId: context.circleId,
          bindingKind: 'primary',
          bindingCandidateRef: candidateRef,
        },
        statePrecondition: {
          bindingStatus: 'pending',
          bindingKind: 'primary',
        },
        snapshotVersion: item.snapshotVersion,
        snapshotDigest: item.snapshotDigest,
        preview,
      };
    },
    projectNativePreview(intent) {
      return intent.preview;
    },
  };
}
