import {
    createHostedAppActionIntent,
    queryHostedAppCapability,
    requestHostedAppRuntimeAttestation,
} from '@/lib/api/hostedApps';

type RuntimeBridgeMethod =
    | 'queryCapability'
    | 'createActionIntent'
    | 'requestRuntimeAttestation'
    | 'requestSignatureIntent';

interface RuntimeBridgeMessage {
    source: 'alcheme-hosted-app';
    requestId: string;
    bridgeSessionToken?: string;
    method: RuntimeBridgeMethod;
    payload?: Record<string, unknown>;
}

export interface HostedAppRuntimeBridgeInput {
    appId: string;
    releaseId: string;
    circleId: number;
    manifestHash: string;
    releaseOrigin: string;
    bridgeSessionToken: string;
    sessionDigest: string;
    getTargetWindow: () => Window | null;
    requestSignatureIntent?: (payload: Record<string, unknown>) => Promise<unknown>;
}

interface RuntimeBridgeResponse {
    source: 'alcheme-host';
    requestId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

export function createHostedAppRuntimeBridge(input: HostedAppRuntimeBridgeInput) {
    async function handleMessage(event: MessageEvent) {
        if (event.source !== input.getTargetWindow()) return;

        const message = parseRuntimeBridgeMessage(event.data);
        if (!message) return;
        if (message.bridgeSessionToken !== input.bridgeSessionToken) return;
        if (event.origin !== input.releaseOrigin) return;

        try {
            const payload = {
                ...(message.payload || {}),
                releaseId: input.releaseId,
                circleId: input.circleId,
                manifestHash: input.manifestHash,
                runtimeSessionDigest: input.sessionDigest,
            };
            const result = await dispatch(input, message.method, payload);
            postBridgeResponse(event, input.releaseOrigin, {
                source: 'alcheme-host',
                requestId: message.requestId,
                ok: true,
                result,
            });
        } catch (error) {
            postBridgeResponse(event, input.releaseOrigin, {
                source: 'alcheme-host',
                requestId: message.requestId,
                ok: false,
                error: error instanceof Error ? error.message : 'hosted_app_bridge_failed',
            });
        }
    }

    return { handleMessage };
}

export function assertManagedAppOriginIsIsolated(input: {
    appOrigin: string;
    forbiddenOrigins: string[];
    requiredSuffix: string;
}): void {
    const origin = new URL(input.appOrigin).origin;
    const forbiddenOrigins = input.forbiddenOrigins.map((value) => new URL(value).origin);
    if (forbiddenOrigins.includes(origin)) {
        throw new Error('hosted_app_origin_not_isolated');
    }
    if (!new URL(origin).hostname.endsWith(input.requiredSuffix)) {
        throw new Error('hosted_app_origin_not_managed');
    }
}

function parseRuntimeBridgeMessage(value: unknown): RuntimeBridgeMessage | null {
    if (!value || typeof value !== 'object') return null;
    const message = value as Partial<RuntimeBridgeMessage>;
    if (message.source !== 'alcheme-hosted-app') return null;
    if (typeof message.requestId !== 'string' || !message.requestId) return null;
    if (!isRuntimeBridgeMethod(message.method)) return null;
    if (message.payload !== undefined && !isPlainRecord(message.payload)) return null;
    return message as RuntimeBridgeMessage;
}

function isRuntimeBridgeMethod(value: unknown): value is RuntimeBridgeMethod {
    return (
        value === 'queryCapability' ||
        value === 'createActionIntent' ||
        value === 'requestRuntimeAttestation' ||
        value === 'requestSignatureIntent'
    );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function dispatch(
    input: HostedAppRuntimeBridgeInput,
    method: RuntimeBridgeMethod,
    payload: Record<string, unknown>,
) {
    if (method === 'queryCapability') {
        return queryHostedAppCapability(input.appId, payload);
    }
    if (method === 'createActionIntent') {
        if (payload.actionId === 'request_signature_intent') {
            if (!input.requestSignatureIntent) {
                throw new Error('hosted_app_signature_proxy_unavailable');
            }
            return input.requestSignatureIntent(payload);
        }
        return createHostedAppActionIntent(input.appId, payload);
    }
    if (method === 'requestRuntimeAttestation') {
        return requestHostedAppRuntimeAttestation(input.appId, payload);
    }
    if (method === 'requestSignatureIntent') {
        if (!input.requestSignatureIntent) {
            throw new Error('hosted_app_signature_proxy_unavailable');
        }
        return input.requestSignatureIntent(payload);
    }
    throw new Error('hosted_app_bridge_method_denied');
}

function postBridgeResponse(event: MessageEvent, targetOrigin: string, response: RuntimeBridgeResponse) {
    const source = event.source;
    if (!source || !('postMessage' in source)) return;
    source.postMessage(response, { targetOrigin });
}
