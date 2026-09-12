'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/components/ui/Select';
import type { ExternalAppCircleBinding } from '@/lib/api/externalApps';
import { authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import { useI18n } from '@/i18n/useI18n';
import styles from './ExternalProgramDetail.module.css';

const PRIMARY_BIND = 'external_app_primary_circle_bind';
const PRIMARY_CHANGE = 'external_app_primary_circle_change';
const ATTACHED_BIND = 'external_app_attached_circle_bind';
const ATTACHED_REVOKE = 'external_app_attached_circle_revoke';

type OwnerAction =
  | typeof PRIMARY_BIND
  | typeof PRIMARY_CHANGE
  | typeof ATTACHED_BIND
  | typeof ATTACHED_REVOKE;

type CircleOption = { id: number; name: string };

export function ExternalProgramCircleBindingPanel(props: {
  appId: string;
  primaryCircle: ExternalAppCircleBinding | null;
  attachedCircles: ExternalAppCircleBinding[];
  circleBindings: ExternalAppCircleBinding[];
  reviewCircle: { circleId: number } | null;
  canManageCircleBindings: boolean;
  availableCircles: CircleOption[];
  circlesLoading: boolean;
  circlesError: boolean;
  onRetryCircles: () => void;
  onApplicationSubmitted: () => Promise<void>;
}) {
  const t = useI18n('ExternalPrograms.bindingManagement');
  const primaryAction: OwnerAction = props.primaryCircle?.status === 'active'
    ? PRIMARY_CHANGE
    : PRIMARY_BIND;
  const [actionType, setActionType] = useState<OwnerAction>(primaryAction);
  const [targetRef, setTargetRef] = useState('');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [readbackDelayed, setReadbackDelayed] = useState(false);
  const [refreshingReadback, setRefreshingReadback] = useState(false);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (actionType === PRIMARY_BIND && primaryAction === PRIMARY_CHANGE) {
      setActionType(PRIMARY_CHANGE);
      setTargetRef('');
    } else if (actionType === PRIMARY_CHANGE && primaryAction === PRIMARY_BIND) {
      setActionType(PRIMARY_BIND);
      setTargetRef('');
    }
  }, [actionType, primaryAction]);

  const activeAttached = useMemo(
    () => props.attachedCircles.filter((binding) => binding.status === 'active'),
    [props.attachedCircles],
  );
  const activeCircleIds = useMemo(
    () => new Set([
      ...(props.primaryCircle?.status === 'active' ? [props.primaryCircle.circleId] : []),
      ...activeAttached.map((binding) => binding.circleId),
    ]),
    [activeAttached, props.primaryCircle],
  );
  const targetCircles = useMemo(() => {
    if (actionType === ATTACHED_REVOKE) return [];
    return props.availableCircles.filter((circle) => {
      if (actionType === PRIMARY_CHANGE) {
        return circle.id !== props.primaryCircle?.circleId;
      }
      if (actionType === ATTACHED_BIND) return !activeCircleIds.has(circle.id);
      return true;
    });
  }, [actionType, activeCircleIds, props.availableCircles, props.primaryCircle]);
  const selectedBinding = actionType === ATTACHED_REVOKE
    ? activeAttached.find((binding) => binding.id === targetRef) ?? null
    : null;
  const selectedCircleId = selectedBinding?.circleId ?? Number(targetRef);
  const selectionReady = Number.isSafeInteger(selectedCircleId) && selectedCircleId > 0;

  const refreshApplicationStatus = async () => {
    setRefreshingReadback(true);
    setReadbackDelayed(false);
    try {
      await props.onApplicationSubmitted();
    } catch {
      setReadbackDelayed(true);
    } finally {
      setRefreshingReadback(false);
    }
  };

  const requestApplication = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!selectionReady) {
      setError(t('targetRequired'));
      setSuccess(null);
      return;
    }
    const trimmedRationale = rationale.trim();
    if (trimmedRationale.length < 10) {
      setError(t('rationaleTooShort'));
      setSuccess(null);
      rationaleRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setReadbackDelayed(false);
    try {
      const route = await resolveNodeRoute('governance');
      const isPrimary = actionType === PRIMARY_BIND || actionType === PRIMARY_CHANGE;
      const path = isPrimary
        ? `primary-circle-bind/requests`
        : 'circle-binding-owner-applications';
      const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/external-apps/${encodeURIComponent(props.appId)}/${path}`,
        {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              circleId: selectedCircleId,
              rationale: trimmedRationale,
              ...(!isPrimary ? { actionType } : {}),
              ...(selectedBinding ? { bindingId: selectedBinding.id } : {}),
            }),
          },
        },
      );
      if (!response.ok) {
        setError(submitErrorMessage(t, response.status));
        return;
      }
      // A successful HTTP status is the durable-write boundary.  Do not turn an
      // already-recorded application into an apparent submission failure merely
      // because an optional acknowledgement body is empty or malformed.
      const acknowledgement = await response.json().catch(() => null) as { replayed?: boolean } | null;
      setSuccess(acknowledgement?.replayed ? t('alreadyRecorded') : t('recorded'));
      setTargetRef('');
      setRationale('');
    } catch {
      setError(t('submitErrors.unavailable'));
      return;
    } finally {
      setSubmitting(false);
    }
    await refreshApplicationStatus();
  };

  const pendingBindings = props.circleBindings.filter((binding) => binding.status === 'pending');

  return (
    <section className={styles.section}>
      <h2>{t('title')}</h2>
      <div className={styles.list}>
        <BindingRow label={t('primaryCircle')} binding={props.primaryCircle} circles={props.availableCircles} emptyLabel={t('noActiveBinding')} circleFallback={t('circleFallback')} />
        {activeAttached.length > 0 ? (
          activeAttached.map((binding) => (
            <BindingRow
              key={binding.id}
              label={t('attachedCircle')}
              binding={binding}
              circles={props.availableCircles}
              emptyLabel={t('noActiveBinding')}
              circleFallback={t('circleFallback')}
            />
          ))
        ) : (
          <p className={styles.muted}>{t('noAttached')}</p>
        )}
        {pendingBindings.length > 0 ? (
          <div className={styles.pendingNotice} role="status">
            {t('pendingGovernance', { count: pendingBindings.length })}
          </div>
        ) : null}
        {props.reviewCircle ? (
          <div className={styles.row}>
            <strong>{t('reviewCircle')}</strong>
            <span>{circleLabel(props.reviewCircle.circleId, props.availableCircles, t('circleFallback'))}</span>
          </div>
        ) : (
          <p className={styles.muted}>{t('noReviewCircle')}</p>
        )}
      </div>

      {!props.canManageCircleBindings ? (
        <p className={styles.muted}>{t('ownerOnlyExplanation')}</p>
      ) : (
        <form className={styles.bindingApplication} onSubmit={requestApplication}>
          <div className={styles.applicationHeading}>
            <div>
              <h3>{t('applicationTitle')}</h3>
              <p>{t('applicationHelp')}</p>
            </div>
            <span className={styles.ownerBadge}>{t('ownerOnly')}</span>
          </div>
          <label>
            <span>{t('requestedAction')}</span>
            <Select
              ariaLabel={t('requestedAction')}
              value={actionType}
              onChange={(next) => {
                setActionType(next as OwnerAction);
                setTargetRef('');
                setError(null);
                setSuccess(null);
                setReadbackDelayed(false);
              }}
              disabled={submitting}
              options={[
                {
                  value: primaryAction,
                  label: primaryAction === PRIMARY_CHANGE
                    ? t('actions.changePrimary')
                    : t('actions.bindPrimary'),
                },
                { value: ATTACHED_BIND, label: t('actions.attach') },
                {
                  value: ATTACHED_REVOKE,
                  label: t('actions.revokeAttached'),
                  disabled: activeAttached.length === 0,
                },
              ]}
            />
          </label>

          {actionType === ATTACHED_REVOKE ? (
            <label>
              <span>{t('attachedToRevoke')}</span>
              <Select
                ariaLabel={t('attachedToRevoke')}
                value={targetRef}
                onChange={(next) => {
                  setTargetRef(next);
                  setError(null);
                  setSuccess(null);
                  setReadbackDelayed(false);
                }}
                disabled={submitting || activeAttached.length === 0}
                options={[
                  { value: '', label: t('selectAttached') },
                  ...activeAttached.map((binding) => ({
                    value: binding.id,
                    label: circleLabel(binding.circleId, props.availableCircles, t('circleFallback')),
                  })),
                ]}
              />
            </label>
          ) : (
            <label>
              <span>{t('targetCircle')}</span>
              <Select
                ariaLabel={t('targetCircle')}
                value={targetRef}
                onChange={(next) => {
                  setTargetRef(next);
                  setError(null);
                  setSuccess(null);
                  setReadbackDelayed(false);
                }}
                disabled={submitting || props.circlesLoading || props.circlesError || targetCircles.length === 0}
                options={[
                  { value: '', label: props.circlesLoading ? t('loadingCircles') : t('selectCircle') },
                  ...targetCircles.map((circle) => ({
                    value: String(circle.id),
                    label: `${circle.name} · #${circle.id}`,
                  })),
                ]}
              />
            </label>
          )}

          {props.circlesError && actionType !== ATTACHED_REVOKE ? (
            <div className={styles.inlineError} role="alert">
              <span>{t('directoryUnavailable')}</span>
              <button type="button" onClick={props.onRetryCircles}>{t('retry')}</button>
            </div>
          ) : null}
          {!props.circlesLoading && !props.circlesError
          && actionType !== ATTACHED_REVOKE && targetCircles.length === 0 ? (
            <p className={styles.muted}>{t('noEligibleCircle')}</p>
          ) : null}

          <label>
            <span>{t('rationale')}</span>
            <textarea
              ref={rationaleRef}
              name="external-program-binding-rationale"
              autoComplete="off"
              value={rationale}
              onChange={(event) => {
                setRationale(event.target.value);
                setError(null);
              }}
              aria-describedby="external-program-binding-rationale-hint"
              minLength={10}
              maxLength={2000}
              disabled={submitting}
              required
            />
          </label>
          <p id="external-program-binding-rationale-hint" className={styles.muted}>
            {t('rationaleHint')}
          </p>
          {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
          {success ? <p className={styles.successNotice} role="status">{success}</p> : null}
          {readbackDelayed ? (
            <div className={styles.readbackWarning} role="status" aria-live="polite">
              <span>{t('recordedRefreshDelayed')}</span>
              <button type="button" disabled={refreshingReadback} onClick={() => { void refreshApplicationStatus(); }}>
                {refreshingReadback ? t('refreshing') : t('retryRefresh')}
              </button>
            </div>
          ) : null}
          <button type="submit" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </button>
        </form>
      )}
    </section>
  );
}

type TranslationFunction = ReturnType<typeof useI18n>;

function submitErrorMessage(t: TranslationFunction, status: number): string {
  if (status === 401 || status === 403) return t('submitErrors.notAuthorized');
  if (status === 409) return t('submitErrors.conflict');
  if (status === 429) return t('submitErrors.rateLimited');
  return t('submitErrors.unavailable');
}

function BindingRow(props: {
  label: string;
  binding: ExternalAppCircleBinding | null;
  circles: CircleOption[];
  emptyLabel: string;
  circleFallback: string;
}) {
  const t = useI18n('ExternalPrograms.bindingManagement');
  if (!props.binding) {
    return (
      <div className={styles.row}>
        <strong>{props.label}</strong>
        <span className={styles.muted}>{props.emptyLabel}</span>
      </div>
    );
  }
  return (
    <div className={styles.row}>
      <strong>{props.label}</strong>
      <span>{circleLabel(props.binding.circleId, props.circles, props.circleFallback)}</span>
      <span className={styles.muted}>
        {t(`bindingStatus.${props.binding.status}`)} · {bindingSourceLabel(t, props.binding.source)}
      </span>
    </div>
  );
}

function bindingSourceLabel(t: TranslationFunction, source: string | null | undefined): string {
  if (source === 'governance-approved') return t('bindingSource.governanceApproved');
  if (source === 'review-pending') return t('bindingSource.reviewPending');
  return t('bindingSource.recorded');
}

function circleLabel(circleId: number, circles: CircleOption[], fallback: string): string {
  const circle = circles.find((item) => item.id === circleId);
  return circle ? `${circle.name} · #${circleId}` : `${fallback} #${circleId}`;
}
