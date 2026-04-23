'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GQLTotem } from '@/lib/apollo/types';
import { useI18n } from '@/i18n/useI18n';
import styles from './TotemDisplay.module.css';

// ── Stage string → number mapping ──
const STAGE_INDEX: Record<string, number> = {
    seed: 0, sprout: 1, bloom: 2, radiant: 3, legendary: 4,
};

const STAGE_KEYS = ['seed', 'sprout', 'bloom', 'radiant', 'legendary'] as const;

// ════════════════════════════════════════════════
//  Canvas Draw Functions (from designer v9.2.2)
// ════════════════════════════════════════════════

function drawLivingEternalSpark(
    ctx: CanvasRenderingContext2D, size: number, elapsed: number, dustFactor: number,
) {
    const t = elapsed * 0.0004;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    const flicker = 0.99 + Math.sin(t * 10) * 0.01;
    const scale = 1.0 * flicker;
    ctx.beginPath();
    ctx.moveTo(0, scale);
    ctx.bezierCurveTo(scale * 1.5, scale, scale * 1, -scale * 2.5, 0, -scale * 4);
    ctx.bezierCurveTo(-scale * 1, -scale * 2.5, -scale * 1.5, scale, 0, scale);
    ctx.fillStyle = dustFactor > 0.85 ? '#949B97' : '#FFFFFF';
    ctx.globalAlpha = 0.35 + (1 - dustFactor) * 0.45;
    ctx.shadowBlur = 12 * (1 - dustFactor * 0.4);
    ctx.shadowColor = '#E5D9BE';
    ctx.fill();
    ctx.restore();
}

function drawPhysicalShadow(
    ctx: CanvasRenderingContext2D, size: number, elapsed: number,
    dustFactor: number, targetStage: number, progress: number,
) {
    const r = size * 0.28;
    const alpha = 0.22 * (1 - dustFactor);
    ctx.save();
    ctx.translate(0, r * 1.25);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.75);
    grad.addColorStop(0, `rgba(0,0,0, ${alpha})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.68, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    if (targetStage === 4) {
        ctx.globalAlpha = 0.1 * progress * (1 - dustFactor);
        const lightSpot = ctx.createRadialGradient(0, r * 0.1, 0, 0, r * 0.1, r * 0.5);
        lightSpot.addColorStop(0, 'rgba(199, 168, 107, 0.4)');
        lightSpot.addColorStop(1, 'transparent');
        ctx.fillStyle = lightSpot;
        ctx.beginPath();
        ctx.ellipse(Math.sin(elapsed / 3000) * 12, 0, r * 0.6, r * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function drawRock(ctx: CanvasRenderingContext2D, r: number, t: number, progress: number) {
    ctx.beginPath();
    for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        const n = Math.sin(a * 15 + t) * 1.6 + Math.cos(a * 6 - t) * 3;
        const x = Math.cos(a) * (r * 0.72 + n);
        const y = Math.sin(a) * (r * 0.72 + n);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 0, 0, 0, r);
    g.addColorStop(0, '#3A423E');
    g.addColorStop(1, '#1A1E1C');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = `rgba(231,228,221,${0.05 * progress})`;
    ctx.stroke();
}

function drawAmber(ctx: CanvasRenderingContext2D, r: number, _t: number, _progress: number) {
    const adjustedR = r * 0.83;
    const g = ctx.createRadialGradient(-adjustedR * 0.3, -adjustedR * 0.4, adjustedR * 0.1, 0, 0, adjustedR * 1.1);
    g.addColorStop(0, '#D4A76A');
    g.addColorStop(0.65, '#B98A54');
    g.addColorStop(1, '#1F2421');
    ctx.beginPath();
    ctx.arc(0, 0, adjustedR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
}

function drawCrystalGeometry(
    ctx: CanvasRenderingContext2D, r: number, t: number,
    isRadiant: boolean, _progress: number, dustFactor: number,
) {
    const sides = isRadiant ? 12 : 6;
    const rotate = t * 0.03;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + rotate;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    g.addColorStop(0.5, isRadiant ? 'rgba(229, 217, 190, 0.15)' : 'rgba(199, 168, 107, 0.15)');
    g.addColorStop(1, 'rgba(31, 36, 33, 0.6)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + rotate;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(0, 0);
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 * (1 - dustFactor)})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
}

function drawLegendary(
    ctx: CanvasRenderingContext2D, r: number, t: number,
    progress: number, dustFactor: number,
) {
    const time = t * 0.08;
    const sides = 12;
    const rotate = t * 0.03;

    const crystalPath = new Path2D();
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + rotate;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) crystalPath.moveTo(x, y); else crystalPath.lineTo(x, y);
    }
    crystalPath.closePath();

    ctx.save();
    const nebula = ctx.createRadialGradient(-r * 0.4, -r * 0.5, r * 0.1, 0, 0, r * 1.8);
    nebula.addColorStop(0, '#E5D9BE');
    nebula.addColorStop(0.3, '#C7A86B');
    nebula.addColorStop(0.7, '#3A3228');
    nebula.addColorStop(1, '#1F2421');
    ctx.fillStyle = nebula;
    ctx.fill(crystalPath);
    ctx.restore();

    ctx.save();
    ctx.clip(crystalPath);

    const intensity = 1 - dustFactor * 0.6;
    const slantAngle = -Math.PI / 4;
    const flowProgress = (1.5 - (time * 1.0) % 3.0) * r;

    // Layer A: organic gold wave ripples
    for (let i = 0; i < 3; i++) {
        ctx.save();
        const lTime = time * (0.5 + i * 0.3);
        const individualOffset = flowProgress + (Math.sin(lTime) * 10);
        ctx.rotate(slantAngle);
        ctx.beginPath();
        ctx.moveTo(-r * 2.5, -r * 2.5);
        for (let lx = -r * 2.5; lx <= r * 2.5; lx += 12) {
            const waveLy = Math.sin(lx * 0.02 + lTime * 8) * (8 + i * 3) + individualOffset;
            ctx.lineTo(lx, waveLy);
        }
        ctx.lineTo(r * 2.5, r * 2.5);
        ctx.lineTo(-r * 2.5, r * 2.5);
        ctx.closePath();
        const shimmer = ctx.createLinearGradient(0, individualOffset - r * 0.3, 0, individualOffset + r * 0.3);
        shimmer.addColorStop(0, 'transparent');
        shimmer.addColorStop(0.5, `rgba(255, 255, 255, ${0.06 * intensity})`);
        shimmer.addColorStop(1, 'transparent');
        ctx.fillStyle = shimmer;
        ctx.globalCompositeOperation = 'screen';
        ctx.fill();
        ctx.restore();
    }

    // Layer B: gold glint lattice
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 24; j++) {
        const seed = (j * 31.7) % Math.PI * 2;
        const baseDist = (Math.cos(j * 1.7) * 0.3 + 0.5) * r;
        const baseX = Math.cos(seed) * baseDist;
        const baseY = Math.sin(seed) * baseDist;
        const glintX = baseX + (flowProgress * 0.65);
        const glintY = baseY + (flowProgress * 0.65);
        const visibilityWeight = Math.min(1, Math.max(0, (glintY + r * 0.4) / (r * 0.9)));
        const rotatedY = glintX * Math.sin(-slantAngle) + glintY * Math.cos(-slantAngle);
        const waveCoupling = Math.pow(Math.abs(Math.sin((rotatedY - flowProgress) * 0.015)), 4);
        const flicker = Math.max(0, Math.sin(time * 12 + j * 4)) * (0.3 + waveCoupling * 0.7);
        const alpha = flicker * 0.28 * intensity * visibilityWeight;
        if (alpha > 0.01) {
            const g = ctx.createRadialGradient(glintX, glintY, 0, glintX, glintY, r * 0.08);
            g.addColorStop(0, `rgba(229, 217, 190, ${alpha})`);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(glintX, glintY, r * 0.08, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();

    // Shell detail
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + rotate;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(0, 0);
    }
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.06 * progress})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    const spec = ctx.createRadialGradient(-r * 0.35, -r * 0.45, 0, -r * 0.35, -r * 0.45, r * 0.5);
    spec.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    spec.addColorStop(1, 'transparent');
    ctx.fillStyle = spec;
    ctx.fill(crystalPath);

    ctx.strokeStyle = `rgba(229, 217, 190, ${0.12 * (1 - dustFactor)})`;
    ctx.stroke(crystalPath);
    ctx.restore();
}

function renderArtisticStage(
    ctx: CanvasRenderingContext2D, stage: number, elapsed: number,
    dustFactor: number, size: number, progress: number,
) {
    const r = size * 0.26;
    const t = elapsed / 1000;
    if (stage === 0) drawRock(ctx, r, t, progress);
    else if (stage === 1) drawAmber(ctx, r, t, progress);
    else if (stage === 2 || stage === 3) drawCrystalGeometry(ctx, r, t, stage === 3, progress, dustFactor);
    else drawLegendary(ctx, r, t, progress, dustFactor);
}

interface Particle {
    x: number; y: number; vx: number; vy: number; size: number; life: number;
}

function updateDust(ctx: CanvasRenderingContext2D, particles: Particle[], deltaTime: number) {
    const step = deltaTime / 16;
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.life -= 0.012 * step;
        if (p.life > 0) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(199, 168, 107, ${p.life * 0.35})`;
            ctx.fill();
        } else {
            particles.splice(i, 1);
        }
    }
}

function createBurstParticles(count: number): Particle[] {
    const p: Particle[] = [];
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + Math.random() * 1.5;
        p.push({
            x: 0, y: 0,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 0.8,
            life: 1.0,
        });
    }
    return p;
}

// ════════════════════════════════════════════════
//  Canvas Renderer Component
// ════════════════════════════════════════════════

const CANVAS_SIZE = 200; // fits mobile profile page

interface TotemCanvasProps {
    dustFactor: number;
    currentStage: number;
    targetStage: number;
    transitionProgress: number;
}

function TotemCanvas({ dustFactor, currentStage, targetStage, transitionProgress }: TotemCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>(0);
    const startTimeRef = useRef(Date.now());
    const lastTimeRef = useRef(Date.now());
    const particles = useRef<Particle[]>([]);
    const prevTarget = useRef(targetStage);

    // Burst particles on stage change
    useEffect(() => {
        if (targetStage !== prevTarget.current) {
            particles.current.push(...createBurstParticles(15));
            prevTarget.current = targetStage;
        }
    }, [targetStage]);

    const animate = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const now = Date.now();
        const deltaTime = now - lastTimeRef.current;
        const elapsed = now - startTimeRef.current;
        lastTimeRef.current = now;

        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        const breathFreq = 16000 + dustFactor * 4000;
        const breathAmp = 0.005 * (1 - dustFactor * 0.6);
        const breath = 1 + Math.sin(elapsed / breathFreq) * breathAmp;

        ctx.save();
        ctx.translate(CANVAS_SIZE / 2, CANVAS_SIZE / 2);
        ctx.scale(breath, breath);

        drawPhysicalShadow(ctx, CANVAS_SIZE, elapsed, dustFactor, targetStage, transitionProgress);

        if (transitionProgress < 1) {
            ctx.save();
            ctx.globalAlpha = 1 - transitionProgress;
            renderArtisticStage(ctx, currentStage, elapsed, dustFactor, CANVAS_SIZE, 1 - transitionProgress);
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = transitionProgress;
            renderArtisticStage(ctx, targetStage, elapsed, dustFactor, CANVAS_SIZE, transitionProgress);
            ctx.restore();
        } else {
            renderArtisticStage(ctx, currentStage, elapsed, dustFactor, CANVAS_SIZE, 1);
        }

        updateDust(ctx, particles.current, deltaTime);
        ctx.restore();

        drawLivingEternalSpark(ctx, CANVAS_SIZE, elapsed, dustFactor);

        requestRef.current = requestAnimationFrame(animate);
    }, [currentStage, targetStage, transitionProgress, dustFactor]);

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, [animate]);

    // Noise SVG for dust texture
    const noiseSvg = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

    return (
        <div className={styles.canvasWrap}>
            {/* Dust noise texture overlay */}
            <div
                className={styles.dustNoiseOverlay}
                style={{
                    opacity: dustFactor * 0.7,
                    background: `radial-gradient(circle at center, transparent 35%, rgba(31,36,33,${dustFactor * 0.6}) 100%), ${noiseSvg}`,
                }}
            />
            {/* Dust blur overlay */}
            <div
                className={styles.dustBlurOverlay}
                style={{
                    opacity: dustFactor * 0.45,
                    backdropFilter: `blur(${dustFactor * 6}px) contrast(0.85)`,
                }}
            />
            {/* Canvas */}
            <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className={styles.canvas}
                style={{
                    filter: `blur(${dustFactor * 16}px) saturate(${1 - dustFactor * 0.95}) contrast(${1 + dustFactor * 0.35}) brightness(${1 - dustFactor * 0.15})`,
                }}
            />
        </div>
    );
}

// ════════════════════════════════════════════════
//  Public Component (accepts GQLTotem, manages transitions)
// ════════════════════════════════════════════════

interface TotemDisplayProps {
    totem: GQLTotem | null | undefined;
}

export default function TotemDisplay({ totem }: TotemDisplayProps) {
    const t = useI18n('TotemDisplay');
    const stageNum = STAGE_INDEX[totem?.stage ?? 'seed'] ?? 0;
    const dustFactor = totem?.dustFactor ?? 0;

    const [currentStage, setCurrentStage] = useState(stageNum);
    const [targetStage, setTargetStage] = useState(stageNum);
    const [transitionProgress, setTransitionProgress] = useState(1);
    const lastTimeRef = useRef(Date.now());

    // Trigger transition when stage changes
    useEffect(() => {
        if (stageNum !== targetStage) {
            setTargetStage(stageNum);
            setTransitionProgress(0);
        }
    }, [stageNum, targetStage]);

    // Animate transition progress
    useEffect(() => {
        let animId: number;
        const update = () => {
            const now = Date.now();
            const deltaTime = now - lastTimeRef.current;
            lastTimeRef.current = now;
            if (transitionProgress < 1) {
                setTransitionProgress(p => {
                    const next = p + 0.005 * (deltaTime / 16);
                    if (next >= 1) {
                        setCurrentStage(targetStage);
                        return 1;
                    }
                    return next;
                });
            }
            animId = requestAnimationFrame(update);
        };
        animId = requestAnimationFrame(update);
        return () => cancelAnimationFrame(animId);
    }, [transitionProgress, targetStage]);

    const stageKey = STAGE_KEYS[targetStage] ?? STAGE_KEYS[0];

    return (
        <div className={styles.container}>
            <TotemCanvas
                dustFactor={dustFactor}
                currentStage={currentStage}
                targetStage={targetStage}
                transitionProgress={transitionProgress}
            />
            <div className={styles.info}>
                <p className={`${styles.stageName} ${transitionProgress < 1 ? styles.stageNameHidden : ''}`}>
                    {t(`stages.${stageKey}.name`)}
                </p>
                <div className={styles.divider} />
                <p className={styles.stageDesc}>{t(`stages.${stageKey}.description`)}</p>
            </div>
        </div>
    );
}
