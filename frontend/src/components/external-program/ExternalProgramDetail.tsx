'use client';

import type {
  CircleExternalAppBindingRecord,
  ExternalAppDetail,
} from '@/lib/api/externalApps';
import { useI18n } from '@/i18n/useI18n';
import { ExternalProgramCircleBindingPanel } from './ExternalProgramCircleBindingPanel';
import { ExternalProgramRoomsPanel } from './ExternalProgramRoomsPanel';
import { KnowledgeContextPanel } from './KnowledgeContextPanel';
import styles from './ExternalProgramDetail.module.css';

export interface ExternalProgramDetailContext {
  kind: 'circle';
  bindingCircleId: number;
  binding: CircleExternalAppBindingRecord;
}

export function ExternalProgramDetail(props: {
  detail: ExternalAppDetail;
  context?: ExternalProgramDetailContext;
  canManageCircleBindings: boolean;
  availableCircles: Array<{ id: number; name: string }>;
  circlesLoading: boolean;
  circlesError: boolean;
  onRetryCircles: () => void;
  onApplicationSubmitted: () => Promise<void>;
}) {
  const t = useI18n('ExternalPrograms');
  const { app } = props.detail;
  const publicStatus = props.detail.publicStatus ?? null;
  const registrationStatus = publicStatus?.registrationStatus ?? app.status ?? 'unknown';
  const registryStatus = publicStatus?.registryStatus ?? app.registryStatus ?? 'unknown';
  const discoveryStatus = publicStatus?.discoveryStatus ?? app.discoveryStatus ?? 'unknown';
  const circleBindingActive = !props.context || props.context.binding.status === 'active';
  const capabilityLabels = Object.entries(app.capabilitySummary ?? {})
    .map(([key, value]) => ({
      key,
      label: capabilityLabel(t, key),
      value: capabilityValueLabel(t, value),
    }))
    .slice(0, 8);

  return (
    <div className={styles.shell}>
      <section className={`${styles.section} ${styles.summarySection}`}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>{t('detail.summaryEyebrow')}</span>
          <h2>{app.name}</h2>
          <span className={styles.appId}>{app.id}</span>
        </div>

        <div className={styles.statusGrid}>
          <StatusFact
            label={t('facts.registration')}
            value={statusLabel(t, 'registration', registrationStatus)}
            tone={registrationStatus === 'active' ? 'success' : 'neutral'}
          />
          <StatusFact
            label={t('facts.registry')}
            value={statusLabel(t, 'registry', registryStatus)}
            tone={registryStatus === 'active' ? 'success' : 'neutral'}
          />
          <StatusFact
            label={t('facts.discovery')}
            value={statusLabel(t, 'discovery', discoveryStatus)}
            tone={discoveryStatus === 'listed' || discoveryStatus === 'limited' ? 'success' : 'neutral'}
          />
          {props.context ? (
            <StatusFact
              label={t('facts.binding')}
              value={statusLabel(t, 'binding', props.context.binding.status)}
              tone={props.context.binding.status === 'active' ? 'success' : 'neutral'}
            />
          ) : null}
        </div>

        {props.context ? (
          <div className={`${styles.circleRelationship} ${
            props.context.binding.status === 'pending' ? styles.circleRelationshipPending : ''
          }`}>
            <div>
              <span>{t('circleContext.relationship')}</span>
              <strong>{t(`bindingKinds.${normalizeBindingKind(props.context.binding.bindingKind)}`)}</strong>
            </div>
            <span>{t('circleContext.circleId', { circleId: props.context.bindingCircleId })}</span>
          </div>
        ) : null}

        {props.context?.binding.status === 'pending' ? (
          <p className={styles.connectionPendingNotice} role="status">
            {t('circleContext.pendingConnectionNotice')}
          </p>
        ) : null}

        <div>
          <h3 className={styles.subheading}>
            {props.context?.binding.status === 'pending'
              ? t('detail.declaredCapabilities')
              : t('detail.capabilities')}
          </h3>
          <div className={styles.pillRow}>
            {capabilityLabels.length > 0 ? (
              capabilityLabels.map(({ key, label, value }) => (
                <span key={key} className={styles.pill}>
                  {label} · {value}
                </span>
              ))
            ) : (
              <span className={styles.muted}>{t('detail.noCapabilitySummary')}</span>
            )}
          </div>
        </div>

        <p className={styles.disclaimer}>{t('detail.disclaimer')}</p>
      </section>

      <details className={styles.detailsSection}>
        <summary>{t('detail.technicalDetails')}</summary>
        <div className={styles.detailsBody}>
          <div className={styles.metaGrid}>
            <Meta label={t('facts.programId')} value={app.id} />
            <Meta label={t('facts.registration')} value={registrationStatus} />
            <Meta label={t('facts.registry')} value={registryStatus} />
            <Meta label={t('facts.discovery')} value={discoveryStatus} />
            <Meta label={t('facts.environment')} value={app.environment ?? 'unknown'} />
            <Meta label={t('facts.managedNode')} value={app.managedNodePolicy} />
            <Meta label={t('facts.trustScore')} value={app.trustScore ?? 'n/a'} />
            <Meta label={t('facts.riskScore')} value={app.riskScore ?? 'n/a'} />
            {publicStatus ? (
              <>
                <Meta label={t('facts.productionReview')} value={formatRecordValue(publicStatus.productionReviewStatus)} />
                <Meta label={t('facts.sourceMaterialMode')} value={formatRecordValue(publicStatus.sourceMaterialMode)} />
                <Meta label={t('facts.trustProjection')} value={formatRecordValue(publicStatus.trustProjectionStatus)} />
                <Meta label={t('facts.nextAction')} value={formatRecordValue(publicStatus.nextAction)} />
              </>
            ) : null}
          </div>
          {circleBindingActive ? (
            <>
              <ExternalProgramRoomsPanel appId={app.id} primaryCircle={props.detail.primaryCircle} />
              <KnowledgeContextPanel />
            </>
          ) : null}
        </div>
      </details>

      {props.canManageCircleBindings ? (
        <section className={styles.ownerSection}>
          <div className={styles.ownerHeading}>
            <div>
              <span className={styles.eyebrow}>{t('owner.eyebrow')}</span>
              <h2>{t('owner.title')}</h2>
            </div>
            <span className={styles.ownerBadge}>{t('owner.badge')}</span>
          </div>
          <ExternalProgramCircleBindingPanel
            appId={app.id}
            primaryCircle={props.detail.primaryCircle}
            attachedCircles={props.detail.attachedCircles}
            circleBindings={props.detail.circleBindings}
            reviewCircle={props.detail.reviewCircle}
            canManageCircleBindings
            availableCircles={props.availableCircles}
            circlesLoading={props.circlesLoading}
            circlesError={props.circlesError}
            onRetryCircles={props.onRetryCircles}
            onApplicationSubmitted={props.onApplicationSubmitted}
          />
        </section>
      ) : null}
    </div>
  );
}

function StatusFact(props: {
  label: string;
  value: string;
  tone: 'success' | 'neutral';
}) {
  return (
    <div className={styles.statusFact}>
      <span>{props.label}</span>
      <strong className={props.tone === 'success' ? styles.statusSuccess : undefined}>
        {props.value}
      </strong>
    </div>
  );
}

function Meta(props: { label: string; value: string | number | null | undefined }) {
  return (
    <div className={styles.metaItem}>
      <span>{props.label}</span>
      <span>{props.value ?? 'n/a'}</span>
    </div>
  );
}

type TranslationFunction = ReturnType<typeof useI18n>;

function statusLabel(
  t: TranslationFunction,
  group: 'registration' | 'registry' | 'discovery' | 'binding',
  value: string,
): string {
  const normalized = String(value || 'unknown').toLowerCase();
  const supported: Record<typeof group, Set<string>> = {
    registration: new Set(['pending', 'active', 'suspended', 'revoked']),
    registry: new Set(['pending', 'active', 'suspended', 'revoked']),
    discovery: new Set(['unlisted', 'listed', 'limited', 'hidden', 'delisted']),
    binding: new Set(['pending', 'active', 'superseded', 'revoked']),
  };
  return supported[group].has(normalized)
    ? t(`statuses.${group}.${normalized}`)
    : t('statuses.unknown');
}

function formatRecordValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'enabled' : 'disabled';
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return 'configured';
  return 'recorded';
}

function capabilityLabel(t: TranslationFunction, value: string): string {
  switch (value) {
    case 'sourceMaterialSubmission':
    case 'knowledgeContext':
    case 'voice':
    case 'transcriptRecap':
      return t(`capabilities.names.${value}`);
    default:
      return t('capabilities.names.other');
  }
}

function capabilityValueLabel(t: TranslationFunction, value: unknown): string {
  const normalized = formatRecordValue(value).toLowerCase();
  switch (normalized) {
    case 'enabled':
    case 'disabled':
    case 'configured':
    case 'recorded':
      return t(`capabilities.values.${normalized}`);
    default:
      return t('capabilities.values.unknown');
  }
}

function normalizeBindingKind(value: string): 'primary' | 'attached' {
  return value === 'primary' ? 'primary' : 'attached';
}
