export const CIRCLE_SHORTCUTS_VERSION = 1 as const;
export const CIRCLE_SHORTCUTS_STORAGE_KEY = 'alcheme_circle_shortcuts_v1';
export const CIRCLE_SHORTCUTS_CHANGED_EVENT = 'alcheme:circle-shortcuts-changed';

export type CircleShortcutTab = 'plaza' | 'feed' | 'crucible' | 'sanctuary';
export type CircleShortcutKind = 'main' | 'auxiliary';
export type CircleShortcutMode = 'knowledge' | 'social';

export interface CircleShortcutRecord {
    rootCircleId: number;
    circleId: number;
    circleName: string;
    level: number;
    kind: CircleShortcutKind;
    mode: CircleShortcutMode;
    preferredTab: CircleShortcutTab;
    rank: number;
    isPrimary: boolean;
    autoEnterEnabled: boolean;
    createdAt: string;
    updatedAt: string;
    lastOpenedAt: string | null;
    disabledReason?: string | null;
}

export interface CircleShortcutDraft {
    rootCircleId: number;
    circleId: number;
    circleName: string;
    level: number;
    kind: CircleShortcutKind;
    mode: CircleShortcutMode;
    preferredTab?: CircleShortcutTab | string | null;
}

export interface CircleShortcutsState {
    version: typeof CIRCLE_SHORTCUTS_VERSION;
    shortcuts: CircleShortcutRecord[];
}

export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

interface UpsertCircleShortcutOptions {
    isPrimary?: boolean;
    autoEnterEnabled?: boolean;
    now?: string | Date;
}

interface ShouldAutoEnterInput {
    shortcut: CircleShortcutRecord | null | undefined;
    hasExplicitIntent: boolean;
}

interface ResolveCircleShortcutEntryHrefInput {
    state: CircleShortcutsState;
    fallbackHref?: string;
    hasExplicitIntent?: boolean;
}

const VALID_TABS = new Set<CircleShortcutTab>(['plaza', 'feed', 'crucible', 'sanctuary']);
const VALID_KINDS = new Set<CircleShortcutKind>(['main', 'auxiliary']);
const VALID_MODES = new Set<CircleShortcutMode>(['knowledge', 'social']);

function currentTimestamp(value?: string | Date): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value;
    return new Date().toISOString();
}

function toFiniteNumber(value: unknown): number | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function getBrowserStorage(): StorageLike | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
}

export function createEmptyCircleShortcutsState(): CircleShortcutsState {
    return {
        version: CIRCLE_SHORTCUTS_VERSION,
        shortcuts: [],
    };
}

export function normalizeCircleShortcutTab(
    value: unknown,
    fallback: CircleShortcutTab = 'plaza',
): CircleShortcutTab {
    return typeof value === 'string' && VALID_TABS.has(value as CircleShortcutTab)
        ? value as CircleShortcutTab
        : fallback;
}

export function normalizeCircleShortcutsState(raw: unknown): CircleShortcutsState {
    if (!raw || typeof raw !== 'object') {
        return createEmptyCircleShortcutsState();
    }

    const source = raw as Partial<CircleShortcutsState>;
    const shortcuts = Array.isArray(source.shortcuts) ? source.shortcuts : [];
    const normalized: CircleShortcutRecord[] = [];
    const seenCircleIds = new Set<number>();
    let primaryCircleId: number | null = null;

    shortcuts.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') return;
        const candidate = entry as Partial<CircleShortcutRecord>;
        const rootCircleId = toFiniteNumber(candidate.rootCircleId);
        const circleId = toFiniteNumber(candidate.circleId);
        if (rootCircleId === null || circleId === null || seenCircleIds.has(circleId)) return;

        const circleName = typeof candidate.circleName === 'string' && candidate.circleName.trim()
            ? candidate.circleName.trim()
            : `Circle ${circleId}`;
        const kind = VALID_KINDS.has(candidate.kind as CircleShortcutKind)
            ? candidate.kind as CircleShortcutKind
            : 'main';
        const mode = VALID_MODES.has(candidate.mode as CircleShortcutMode)
            ? candidate.mode as CircleShortcutMode
            : 'knowledge';
        const level = Math.max(0, Number.isFinite(Number(candidate.level)) ? Number(candidate.level) : 0);
        const isPrimary = Boolean(candidate.isPrimary) && primaryCircleId === null;
        if (isPrimary) {
            primaryCircleId = circleId;
        }

        seenCircleIds.add(circleId);
        normalized.push({
            rootCircleId,
            circleId,
            circleName,
            level,
            kind,
            mode,
            preferredTab: normalizeCircleShortcutTab(candidate.preferredTab),
            rank: Number.isFinite(Number(candidate.rank)) ? Number(candidate.rank) : index,
            isPrimary,
            autoEnterEnabled: isPrimary && Boolean(candidate.autoEnterEnabled),
            createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : currentTimestamp(),
            updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : currentTimestamp(),
            lastOpenedAt: typeof candidate.lastOpenedAt === 'string' ? candidate.lastOpenedAt : null,
            disabledReason: typeof candidate.disabledReason === 'string' ? candidate.disabledReason : null,
        });
    });

    return {
        version: CIRCLE_SHORTCUTS_VERSION,
        shortcuts: normalized.sort((a, b) => a.rank - b.rank || a.createdAt.localeCompare(b.createdAt)),
    };
}

export function readCircleShortcuts(storage: StorageLike | null = getBrowserStorage()): CircleShortcutsState {
    if (!storage) return createEmptyCircleShortcutsState();
    try {
        const raw = storage.getItem(CIRCLE_SHORTCUTS_STORAGE_KEY);
        if (!raw) return createEmptyCircleShortcutsState();
        return normalizeCircleShortcutsState(JSON.parse(raw));
    } catch {
        return createEmptyCircleShortcutsState();
    }
}

export function writeCircleShortcuts(
    state: CircleShortcutsState,
    storage: StorageLike | null = getBrowserStorage(),
): CircleShortcutsState {
    const normalized = normalizeCircleShortcutsState(state);
    if (!storage) return normalized;
    try {
        storage.setItem(CIRCLE_SHORTCUTS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
        return normalized;
    }
    return normalized;
}

export function notifyCircleShortcutsChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(CIRCLE_SHORTCUTS_CHANGED_EVENT));
}

export function upsertCircleShortcut(
    state: CircleShortcutsState,
    draft: CircleShortcutDraft,
    options: UpsertCircleShortcutOptions = {},
): CircleShortcutsState {
    const normalized = normalizeCircleShortcutsState(state);
    const now = currentTimestamp(options.now);
    const existing = normalized.shortcuts.find((shortcut) => shortcut.circleId === draft.circleId) || null;
    const isPrimary = options.isPrimary ?? existing?.isPrimary ?? false;
    const autoEnterEnabled = isPrimary && (options.autoEnterEnabled ?? existing?.autoEnterEnabled ?? false);
    const record: CircleShortcutRecord = {
        rootCircleId: draft.rootCircleId,
        circleId: draft.circleId,
        circleName: draft.circleName.trim() || `Circle ${draft.circleId}`,
        level: Math.max(0, Number.isFinite(Number(draft.level)) ? Number(draft.level) : 0),
        kind: VALID_KINDS.has(draft.kind) ? draft.kind : 'main',
        mode: VALID_MODES.has(draft.mode) ? draft.mode : 'knowledge',
        preferredTab: normalizeCircleShortcutTab(draft.preferredTab),
        rank: existing?.rank ?? normalized.shortcuts.length,
        isPrimary,
        autoEnterEnabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastOpenedAt: existing?.lastOpenedAt ?? null,
        disabledReason: existing?.disabledReason ?? null,
    };

    return normalizeCircleShortcutsState({
        version: CIRCLE_SHORTCUTS_VERSION,
        shortcuts: normalized.shortcuts
            .filter((shortcut) => shortcut.circleId !== draft.circleId)
            .map((shortcut) => isPrimary
                ? { ...shortcut, isPrimary: false, autoEnterEnabled: false }
                : shortcut)
            .concat(record),
    });
}

export function setPrimaryCircleShortcut(
    state: CircleShortcutsState,
    circleId: number,
    autoEnterEnabled = true,
): CircleShortcutsState {
    const normalized = normalizeCircleShortcutsState(state);
    const hasTarget = normalized.shortcuts.some((shortcut) => shortcut.circleId === circleId);
    if (!hasTarget) return normalized;

    return normalizeCircleShortcutsState({
        version: CIRCLE_SHORTCUTS_VERSION,
        shortcuts: normalized.shortcuts.map((shortcut) => ({
            ...shortcut,
            isPrimary: shortcut.circleId === circleId,
            autoEnterEnabled: shortcut.circleId === circleId ? autoEnterEnabled : false,
            updatedAt: shortcut.circleId === circleId ? currentTimestamp() : shortcut.updatedAt,
        })),
    });
}

export function removeCircleShortcut(
    state: CircleShortcutsState,
    circleId: number,
): CircleShortcutsState {
    const normalized = normalizeCircleShortcutsState(state);
    return normalizeCircleShortcutsState({
        version: CIRCLE_SHORTCUTS_VERSION,
        shortcuts: normalized.shortcuts
            .filter((shortcut) => shortcut.circleId !== circleId)
            .map((shortcut) => ({ ...shortcut, isPrimary: false, autoEnterEnabled: false })),
    });
}

export function findPrimaryCircleShortcut(
    state: CircleShortcutsState,
): CircleShortcutRecord | null {
    return normalizeCircleShortcutsState(state).shortcuts.find((shortcut) => shortcut.isPrimary) || null;
}

export function buildCircleShortcutHref(shortcut: CircleShortcutRecord): string {
    const params = new URLSearchParams();
    params.set('tab', shortcut.preferredTab);
    if (shortcut.circleId !== shortcut.rootCircleId) {
        params.set('shortcutCircleId', String(shortcut.circleId));
    }
    return `/circles/${shortcut.rootCircleId}?${params.toString()}`;
}

export function shouldAutoEnterCircleShortcut(input: ShouldAutoEnterInput): boolean {
    const shortcut = input.shortcut;
    if (!shortcut) return false;
    if (input.hasExplicitIntent) return false;
    if (shortcut.disabledReason) return false;
    return shortcut.isPrimary && shortcut.autoEnterEnabled;
}

export function resolveCircleShortcutEntryHref({
    state,
    fallbackHref = '/circles',
    hasExplicitIntent = false,
}: ResolveCircleShortcutEntryHrefInput): string {
    const shortcut = findPrimaryCircleShortcut(state);
    if (!shortcut) return fallbackHref;
    if (!shouldAutoEnterCircleShortcut({ shortcut, hasExplicitIntent })) {
        return fallbackHref;
    }
    return buildCircleShortcutHref(shortcut);
}
