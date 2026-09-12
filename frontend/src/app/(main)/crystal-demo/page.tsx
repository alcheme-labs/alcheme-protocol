'use client';

import dynamic from 'next/dynamic';
import { useState, Suspense } from 'react';
import type { CrystalVisualParams } from '@/lib/crystal/visualParams';
import { useI18n } from '@/i18n/useI18n';

// Lazy-load Crystal3D + CrystalDisplay to avoid SSR issues with Three.js
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);

const PRESETS: { key: 'gold' | 'sapphire' | 'amethyst' | 'jade'; params: CrystalVisualParams }[] = [
    {
        key: 'gold',
        params: {
            seed: BigInt(0xA1B2C3D4),
            hue: 42,          // warm amber/gold
            clarity: 0.15,
            facets: 4,
            texture: 0.1,
            radiance: 0.05,
            patina: 0.0,
            warmth: 0.5,
        },
    },
    {
        key: 'sapphire',
        params: {
            seed: BigInt(0xF0E1D2C3),
            hue: 220,          // deep blue
            clarity: 0.82,
            facets: 8,
            texture: 0.3,
            radiance: 0.45,
            patina: 0.15,
            warmth: 0.3,
        },
    },
    {
        key: 'amethyst',
        params: {
            seed: BigInt(0x12345678),
            hue: 280,          // purple/violet
            clarity: 0.7,
            facets: 10,
            texture: 0.5,
            radiance: 0.35,
            patina: 0.85,
            warmth: 0.4,
        },
    },
    {
        key: 'jade',
        params: {
            seed: BigInt(0xDEADBEEF),
            hue: 145,          // green jade
            clarity: 0.45,
            facets: 6,
            texture: 0.4,
            radiance: 0.25,
            patina: 0.3,
            warmth: 0.6,
        },
    },
];

function ParamBar({ label, value, max = 1 }: { label: string; value: number | bigint; max?: number }) {
    const numVal = typeof value === 'bigint' ? 0 : value;
    const pct = Math.min(100, (numVal / max) * 100);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 72, opacity: 0.7 }}>{label}</span>
            <div style={{ flex: 1, height: 4, background: '#333', borderRadius: 2 }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#c4a35a', borderRadius: 2 }} />
            </div>
            <span style={{ width: 48, textAlign: 'right', fontFamily: 'monospace', opacity: 0.8 }}>
                {typeof value === 'bigint' ? '—' : typeof value === 'number' && value % 1 !== 0 ? value.toFixed(3) : value}
            </span>
        </div>
    );
}

export default function CrystalDemoPage() {
    const t = useI18n('CrystalDemoPage');
    const [activeIdx, setActiveIdx] = useState(0);

    const params = PRESETS[activeIdx].params;

    return (
        <div
            style={{
                minHeight: '100dvh',
                background: 'var(--color-bg-base, #1F2421)',
                color: 'var(--color-text-primary, #E7E4DD)',
                fontFamily: 'Inter, system-ui, sans-serif',
                padding: '24px 16px',
            }}
        >
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6, color: 'var(--color-accent-gold, #C7A86B)' }}>
                {t('title')}
            </h1>
            <p style={{ fontSize: 13, opacity: 0.5, marginBottom: 24 }}>
                {t('subtitle')}
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
                {PRESETS.map((p, i) => (
                    <button
                        key={i}
                        onClick={() => setActiveIdx(i)}
                        style={{
                            padding: '8px 14px',
                            fontSize: 13,
                            border: activeIdx === i ? '1px solid var(--color-accent-gold, #C7A86B)' : '1px solid var(--color-border-medium, rgba(231,228,221,0.14))',
                            borderRadius: 8,
                            background: activeIdx === i ? 'rgba(199, 168, 107, 0.12)' : 'var(--color-bg-surface, #262D29)',
                            color: activeIdx === i ? 'var(--color-accent-gold, #C7A86B)' : 'var(--color-text-secondary, #B4B0A8)',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        {t(`presets.${p.key}.label`)}
                    </button>
                ))}
            </div>

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 24,
                }}
            >
                <CrystalDisplay params={params} size={320}>
                    <Suspense
                        fallback={
                            <div style={{ width: 320, height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
                                {t('loading')}
                            </div>
                        }
                    >
                        <Crystal3D params={params} size={320} />
                    </Suspense>
                </CrystalDisplay>

                {/* ── Parameter readout ── */}
                <div
                    style={{
                        width: 320,
                        padding: 16,
                        borderRadius: 12,
                        background: 'var(--color-bg-surface, #262D29)',
                        border: '1px solid var(--color-border-soft, rgba(231,228,221,0.08))',
                    }}
                >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, opacity: 0.7 }}>
                        {t('parameters.title')}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <ParamBar label={t('parameters.hue')} value={params.hue} max={360} />
                        <ParamBar label={t('parameters.clarity')} value={params.clarity} />
                        <ParamBar label={t('parameters.facets')} value={params.facets} max={12} />
                        <ParamBar label={t('parameters.texture')} value={params.texture} />
                        <ParamBar label={t('parameters.radiance')} value={params.radiance} />
                        <ParamBar label={t('parameters.patina')} value={params.patina} />
                        <ParamBar label={t('parameters.warmth')} value={params.warmth} />
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 40 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: 'var(--color-accent-gold, #C7A86B)' }}>
                    {t('variants.title')}
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                    {PRESETS.map((p, i) => (
                        <div key={i} style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => setActiveIdx(i)}>
                            <CrystalDisplay
                                params={PRESETS[i].params}
                                size={160}
                                particles={false}
                                style={{
                                    border: activeIdx === i ? '1px solid var(--color-accent-gold, #C7A86B)' : '1px solid transparent',
                                    borderRadius: 16,
                                }}
                            >
                                <Suspense fallback={null}>
                                    <Crystal3D params={PRESETS[i].params} size={160} />
                                </Suspense>
                            </CrystalDisplay>
                            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.5 }}>
                                {t(`presets.${p.key}.circleName`)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
