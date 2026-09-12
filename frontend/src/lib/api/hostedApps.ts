import { fetchNodeJson } from './nodeRouting';

function hostedAppPath(appId: string, suffix: string): string {
  return `/api/v1/hosted-apps/${encodeURIComponent(appId)}${suffix}`;
}

export interface HostedAppReleaseBindingParams {
  circleId: number | string;
  releaseId: string;
  manifestHash: string;
}

function hostedAppReleaseBindingQuery(params: HostedAppReleaseBindingParams): string {
  const query = new URLSearchParams({
    circleId: String(params.circleId),
    releaseId: params.releaseId,
    manifestHash: params.manifestHash,
  });
  return `?${query.toString()}`;
}

export async function openHostedAppSession(appId: string, body: Record<string, unknown>) {
  return fetchNodeJson<unknown>('hosted_apps_runtime', hostedAppPath(appId, '/session'), {
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
}

export async function queryHostedAppCapability(appId: string, body: Record<string, unknown>) {
  return fetchNodeJson<unknown>('hosted_apps_runtime', hostedAppPath(appId, '/query-capability'), {
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
}

export async function createHostedAppActionIntent(appId: string, body: Record<string, unknown>) {
  return fetchNodeJson<unknown>('hosted_apps_runtime', hostedAppPath(appId, '/action-intents'), {
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
}

export async function requestHostedAppRuntimeAttestation(appId: string, body: Record<string, unknown>) {
  return fetchNodeJson<unknown>('hosted_apps_runtime', hostedAppPath(appId, '/runtime-attestations'), {
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
}

export async function fetchHostedAppOfflineVerificationBundle(
  appId: string,
  params: HostedAppReleaseBindingParams,
) {
  const suffix = `/offline-verification-bundle${hostedAppReleaseBindingQuery(params)}`;
  return fetchNodeJson<unknown>('hosted_apps_runtime', hostedAppPath(appId, suffix), {
    init: { cache: 'no-store' },
  });
}

export async function createHostedAppAuditExport(appId: string, body: Record<string, unknown>) {
  return fetchNodeJson<unknown>('hosted_apps_runtime', hostedAppPath(appId, '/audit-export'), {
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  });
}
