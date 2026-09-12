'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Single-instance compose portal: when shouldPortal && targetEl, mount children in Dock;
 * otherwise render in Catalog place (forced return on collapse / missing target).
 */
export function ComposePortal({
    shouldPortal,
    targetEl,
    children,
}: {
    shouldPortal: boolean;
    targetEl: Element | null;
    children: ReactNode;
}) {
    if (shouldPortal && targetEl) {
        return createPortal(children, targetEl);
    }
    return children;
}
