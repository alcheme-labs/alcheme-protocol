'use client';

import {
    NATIVE_WALLET_BRIDGE_NAME,
    NATIVE_WALLET_CALLBACK_EVENT_NAME,
    NATIVE_WALLET_IOS_MESSAGE_HANDLER,
} from '../../../config/nativeWalletBridge.mjs';

export interface NativeWalletBridgeMessage {
    type: 'openExternalUrl';
    url: string;
}

declare global {
    interface Window {
        AlchemeNativeBridge?: {
            postMessage?: (payload: string) => void;
        };
        __ALCHEME_NATIVE_WALLET_PENDING_CALLBACK_URL__?: string | null;
        webkit?: {
            messageHandlers?: {
                alchemeNativeBridge?: {
                    postMessage: (payload: string) => void;
                };
            };
        };
    }
}

function resolveNativePostMessage():
    | ((payload: string) => void)
    | null {
    if (typeof window === 'undefined') return null;

    const iosBridge = window.webkit?.messageHandlers?.alchemeNativeBridge;
    if (iosBridge?.postMessage) {
        return (payload: string) => iosBridge.postMessage(payload);
    }

    const androidBridge = window.AlchemeNativeBridge;
    if (androidBridge?.postMessage) {
        return (payload: string) => androidBridge.postMessage?.call(androidBridge, payload);
    }

    return null;
}

export function isNativeWalletBridgeAvailable(): boolean {
    return resolveNativePostMessage() !== null;
}

export function postNativeWalletMessage(message: NativeWalletBridgeMessage): boolean {
    const postMessage = resolveNativePostMessage();
    if (!postMessage) {
        return false;
    }

    postMessage(JSON.stringify(message));
    return true;
}

export function requestNativeOpenExternalUrl(url: string): boolean {
    return postNativeWalletMessage({
        type: 'openExternalUrl',
        url,
    });
}

export function dispatchNativeWalletCallback(url: string): void {
    if (typeof window === 'undefined') return;

    window.__ALCHEME_NATIVE_WALLET_PENDING_CALLBACK_URL__ = url;
    window.dispatchEvent(
        new CustomEvent(NATIVE_WALLET_CALLBACK_EVENT_NAME, {
            detail: { url },
        }),
    );
}

export function consumePendingNativeWalletCallback(): string | null {
    if (typeof window === 'undefined') return null;

    const pending = window.__ALCHEME_NATIVE_WALLET_PENDING_CALLBACK_URL__ ?? null;
    window.__ALCHEME_NATIVE_WALLET_PENDING_CALLBACK_URL__ = null;
    return pending;
}

export function onNativeWalletCallback(listener: (url: string) => void): () => void {
    if (typeof window === 'undefined') {
        return () => {};
    }

    const pending = consumePendingNativeWalletCallback();
    if (pending) {
        listener(pending);
    }

    const handleEvent = (event: Event) => {
        const customEvent = event as CustomEvent<{ url?: string }>;
        const url = customEvent.detail?.url;
        if (typeof url === 'string' && url.length > 0) {
            listener(url);
        }
    };

    window.addEventListener(NATIVE_WALLET_CALLBACK_EVENT_NAME, handleEvent);

    return () => {
        window.removeEventListener(NATIVE_WALLET_CALLBACK_EVENT_NAME, handleEvent);
    };
}

export const NATIVE_WALLET_BRIDGE_GLOBAL = NATIVE_WALLET_BRIDGE_NAME;
export const NATIVE_WALLET_IOS_HANDLER = NATIVE_WALLET_IOS_MESSAGE_HANDLER;
