'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchExtensionCapabilities } from '@/lib/api/extensions';
import { getHomeExtensionEntries } from '@/lib/extensions/entryRegistry';
import {
    buildExtensionCapabilityCardModel,
    buildMissingCapabilityCardModel,
    normalizeExtensionCapabilityState,
} from '@/lib/extensions/normalize';
import type { ExtensionCapabilitiesResponse, ExtensionCardModel } from '@/lib/extensions/types';
import { resolveExtensionGateConfig } from '@/lib/config/extensions';
import ExtensionCapabilityCard from './ExtensionCapabilityCard';
import styles from './ExtensionCapabilitySection.module.css';

type SectionSnapshot =
    | { kind: 'idle' | 'loading' }
    | { kind: 'ready'; catalog: ExtensionCapabilitiesResponse }
    | { kind: 'error' };

function buildCardModels(snapshot: SectionSnapshot, gateConfig = resolveExtensionGateConfig()): ExtensionCardModel[] {
    const entries = getHomeExtensionEntries(gateConfig);
    if (entries.length === 0) {
        return [];
    }

    if (snapshot.kind === 'ready') {
        const catalogMap = new Map(snapshot.catalog.capabilities.map((capability) => [capability.extensionId, capability]));
        return entries.map((entry) => {
            const capability = catalogMap.get(entry.extensionId);
            if (!capability) {
                return buildMissingCapabilityCardModel(entry);
            }
            return buildExtensionCapabilityCardModel(entry, normalizeExtensionCapabilityState(snapshot.catalog, capability));
        });
    }

    if (snapshot.kind === 'error') {
        return entries.map((entry) => buildExtensionCapabilityCardModel(entry, {
            extensionId: entry.extensionId,
            displayName: entry.title,
            state: 'temporarily_unavailable',
            reasonCode: 'runtime_lookup_failed',
            indexedSlot: 0,
        }));
    }

    return [];
}

export default function ExtensionCapabilitySection() {
    const gateConfig = useMemo(() => resolveExtensionGateConfig(), []);
    const entries = useMemo(() => getHomeExtensionEntries(gateConfig), [gateConfig]);
    const [snapshot, setSnapshot] = useState<SectionSnapshot>({ kind: 'idle' });

    const loadCatalog = useCallback(async () => {
        setSnapshot({ kind: 'loading' });
        try {
            const catalog = await fetchExtensionCapabilities();
            setSnapshot({ kind: 'ready', catalog });
        } catch {
            setSnapshot({ kind: 'error' });
        }
    }, []);

    useEffect(() => {
        if (!gateConfig.enabled) {
            return;
        }
        if (entries.length === 0) {
            return;
        }
        void loadCatalog();
    }, [entries.length, gateConfig.enabled, loadCatalog]);

    const cards = useMemo(() => buildCardModels(snapshot, gateConfig), [snapshot, gateConfig]);

    if (!gateConfig.enabled || entries.length === 0) {
        return null;
    }

    return (
        <section className={styles.section} data-testid="extension-capability-section">
            <div className={styles.sectionHeader}>
                <p className={styles.eyebrow}>第三方应用</p>
                <h2 className={styles.title}>受控接入应用</h2>
                <p className={styles.subtitle}>只展示已批准、已接入且当前可解释状态明确的第三方能力。</p>
            </div>
            {snapshot.kind === 'loading' && <p className={styles.loading}>正在检查应用能力…</p>}
            <div className={styles.cardList}>
                {cards.map((model) => (
                    <ExtensionCapabilityCard
                        key={model.extensionId}
                        model={model}
                        onRetry={loadCatalog}
                    />
                ))}
            </div>
        </section>
    );
}
