interface DocumentScrollLockSnapshot {
    owners: number;
    bodyOverflow: string;
    bodyOverscroll: string;
    rootOverflow: string;
    rootOverscroll: string;
}

const activeLocks = new WeakMap<Document, DocumentScrollLockSnapshot>();
const lockedDocuments = new Set<Document>();
const pagehideBound = new WeakSet<Window>();

function restoreLock(documentRef: Document, snapshot: DocumentScrollLockSnapshot): void {
    documentRef.documentElement.style.overflow = snapshot.rootOverflow;
    documentRef.documentElement.style.overscrollBehavior = snapshot.rootOverscroll;
    documentRef.body.style.overflow = snapshot.bodyOverflow;
    documentRef.body.style.overscrollBehavior = snapshot.bodyOverscroll;
}

function bindPageHide(windowRef: Window): void {
    if (pagehideBound.has(windowRef)) return;
    if (typeof windowRef.addEventListener !== 'function') return;
    pagehideBound.add(windowRef);
    const onPageHide = () => {
        forceReleaseAllDocumentScrollLocks(windowRef);
    };
    windowRef.addEventListener('pagehide', onPageHide);
}

export function forceReleaseDocumentScrollLock(
    documentRef: Document = document,
    _windowRef: Window = window,
): void {
    const snapshot = activeLocks.get(documentRef);
    if (!snapshot) return;
    activeLocks.delete(documentRef);
    lockedDocuments.delete(documentRef);
    restoreLock(documentRef, snapshot);
}

export function forceReleaseAllDocumentScrollLocks(windowRef: Window = window): void {
    for (const documentRef of [...lockedDocuments]) {
        forceReleaseDocumentScrollLock(documentRef, windowRef);
    }
}

/**
 * Lock background document scroll without `position: fixed` + negative `top`.
 * That pattern flashes the page to y=0 on unlock before a restore scroll.
 * Overlay Select already covers the viewport and uses overscroll containment.
 */
export function acquireDocumentScrollLock(
    documentRef: Document = document,
    windowRef: Window = window,
): () => void {
    bindPageHide(windowRef);

    let snapshot = activeLocks.get(documentRef);
    if (!snapshot) {
        snapshot = {
            owners: 0,
            bodyOverflow: documentRef.body.style.overflow,
            bodyOverscroll: documentRef.body.style.overscrollBehavior,
            rootOverflow: documentRef.documentElement.style.overflow,
            rootOverscroll: documentRef.documentElement.style.overscrollBehavior,
        };
        activeLocks.set(documentRef, snapshot);
        lockedDocuments.add(documentRef);
        documentRef.documentElement.style.overflow = 'hidden';
        documentRef.documentElement.style.overscrollBehavior = 'none';
        documentRef.body.style.overflow = 'hidden';
        documentRef.body.style.overscrollBehavior = 'none';
    }
    snapshot.owners += 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        const current = activeLocks.get(documentRef);
        if (!current) return;
        current.owners -= 1;
        if (current.owners > 0) return;
        if (current.owners < 0) current.owners = 0;
        forceReleaseDocumentScrollLock(documentRef, windowRef);
    };
}
