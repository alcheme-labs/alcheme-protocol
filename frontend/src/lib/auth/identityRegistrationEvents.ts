'use client';

export const IDENTITY_REGISTERED_EVENT_NAME = 'alcheme:identity-registered';

export interface IdentityRegisteredEventDetail {
    pubkey: string;
    handle: string;
    signature: string;
}

export function notifyIdentityRegistered(detail: IdentityRegisteredEventDetail): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<IdentityRegisteredEventDetail>(
        IDENTITY_REGISTERED_EVENT_NAME,
        { detail },
    ));
}

export function subscribeIdentityRegistered(
    listener: (detail: IdentityRegisteredEventDetail) => void,
): () => void {
    if (typeof window === 'undefined') return () => {};

    const handleEvent = (event: Event) => {
        listener((event as CustomEvent<IdentityRegisteredEventDetail>).detail);
    };
    window.addEventListener(IDENTITY_REGISTERED_EVENT_NAME, handleEvent);
    return () => window.removeEventListener(IDENTITY_REGISTERED_EVENT_NAME, handleEvent);
}
