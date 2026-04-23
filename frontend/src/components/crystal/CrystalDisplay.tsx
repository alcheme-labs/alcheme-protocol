'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { CrystalVisualParams } from '@/lib/crystal/visualParams';

/* ══════════════════════════════════════════════════════════════════
 *  CrystalDisplay — Integration wrapper for Crystal3D.
 *
 *  Wraps a Crystal3D with ambient glow, grounding reflection, and
 *  particle dust that match the crystal's hue + the app's warm dark
 *  design language. The crystal itself is NOT modified.
 *
 *  Usage:
 *    <CrystalDisplay params={params} size={280}>
 *      <Crystal3D params={params} size={280} />
 *    </CrystalDisplay>
 * ══════════════════════════════════════════════════════════════════ */

// ── HSL color helper ─────────────────────────────────────────────
function hslToRgba(h: number, s: number, l: number, a: number): string {
    const sNorm = s / 100;
    const lNorm = l / 100;
    const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = lNorm - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return `rgba(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)}, ${a})`;
}

// ── Floating particles (CSS animation) ───────────────────────────
// Particles ONLY appear in the outer glow zone (corners/edges),
// never overlapping the crystal body in the center.
function Particles({ hue, size, count = 8 }: { hue: number; size: number; count?: number }) {
    const particles = useMemo(() => {
        const items: { id: number; x: number; y: number; pxSize: number; delay: number; duration: number; opacity: number }[] = [];
        for (let i = 0; i < count; i++) {
            const golden = (i * 0.618033988749895) % 1;
            // Place particles in the MARGIN zone (edges/corners) using polar coords
            // Angle around the container, radius pushed toward edges (70-95%)
            const angle = (i / count) * Math.PI * 2 + golden * 0.5;
            const radius = 0.38 + golden * 0.12; // 38-50% from center = near edges
            const cx = 0.5 + Math.cos(angle) * radius;
            const cy = 0.5 + Math.sin(angle) * radius;
            items.push({
                id: i,
                x: cx * 100,
                y: cy * 100,
                pxSize: 2 + golden * 1.5, // 2-3.5px — visible
                delay: -(i * 2.3),
                duration: 8 + golden * 10, // slow, lazy drift
                opacity: 0.2 + golden * 0.3, // visible but gentle
            });
        }
        return items;
    }, [count]);

    // Mix crystal hue with app gold for cohesion
    const particleColor = hslToRgba((hue + 42) / 2, 40, 65, 1);

    return (
        <>
            <style>{`
                @keyframes crystal-dust-drift {
                    0%, 100% { transform: translate(0, 0) scale(1); opacity: 0; }
                    20% { opacity: var(--dust-opacity); }
                    50% { transform: translate(5px, -12px) scale(1.3); opacity: var(--dust-opacity); }
                    80% { opacity: var(--dust-opacity); }
                }
            `}</style>
            {particles.map(p => (
                <div
                    key={p.id}
                    style={{
                        position: 'absolute',
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                        width: p.pxSize,
                        height: p.pxSize,
                        borderRadius: '50%',
                        background: particleColor,
                        pointerEvents: 'none',
                        ['--dust-opacity' as string]: p.opacity,
                        animation: `crystal-dust-drift ${p.duration}s ease-in-out ${p.delay}s infinite`,
                    } as CSSProperties}
                />
            ))}
        </>
    );
}

// ── Public component ─────────────────────────────────────────────

interface CrystalDisplayProps {
    params: CrystalVisualParams;
    size?: number;
    children: ReactNode;
    /** Show floating particles */
    particles?: boolean;
    className?: string;
    style?: CSSProperties;
}

export default function CrystalDisplay({
    params,
    size = 280,
    children,
    particles = true,
    className,
    style,
}: CrystalDisplayProps) {
    const hue = params.hue;
    const radiance = params.radiance;

    // Glow colors — blend crystal hue with app's gold to maintain cohesion
    const glowPrimary = hslToRgba(hue, 40, 50, 0.08 + radiance * 0.06);
    const glowSecondary = hslToRgba((hue + 42) / 2, 35, 45, 0.04);

    return (
        <div
            className={className}
            style={{
                position: 'relative',
                width: size,
                height: size,
                ...style,
            }}
        >
            {/* ── Ambient glow halo (visible around crystal) ── */}
            <div
                style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: size,
                    height: size,
                    borderRadius: 20,
                    background: `radial-gradient(ellipse at center, ${glowPrimary} 0%, ${glowSecondary} 60%, transparent 100%)`,
                    pointerEvents: 'none',
                    filter: 'blur(10px)',
                }}
            />

            {/* ── Floating particles in the OUTER GLOW zone ── */}
            {particles && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: size,
                        height: size,
                        pointerEvents: 'none',
                        zIndex: 3,
                    }}
                >
                    <Particles hue={hue} size={size} />
                </div>
            )}

            {/* ── Crystal (no container box — transparent canvas on glow) ── */}
            <div
                style={{
                    position: 'relative',
                    width: size,
                    height: size,
                    zIndex: 1,
                }}
            >
                {children}
            </div>
        </div>
    );
}
