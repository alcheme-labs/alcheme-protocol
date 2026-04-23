'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshTransmissionMaterial, Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import type { CrystalVisualParams } from '@/lib/crystal/visualParams';

/* ══════════════════════════════════════════════════════════════════
 *  Crystal3D v4 — Natural mineral with internal depth + tamed specular.
 *
 *  Fixes from v3:
 *  - backside=true with thin thickness → internal depth without white border
 *  - Lower, more uniform Lightformer intensity → no blown-out faces
 *  - Higher attenuationDistance → lighter, more translucent feel
 *  - Increased toneMappingExposure → brighter overall
 * ══════════════════════════════════════════════════════════════════ */

// ── Seeded PRNG ──────────────────────────────────────────────────
function splitmix32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x9e3779b9) | 0;
        let t = seed ^ (seed >>> 16);
        t = Math.imul(t, 0x21f0aaad);
        t = t ^ (t >>> 15);
        t = Math.imul(t, 0x735a2d97);
        t = t ^ (t >>> 15);
        return (t >>> 0) / 4294967296;
    };
}

// ── Convex hull ──────────────────────────────────────────────────
function buildConvexHull(points: THREE.Vector3[]): THREE.BufferGeometry {
    // Find initial tetrahedron
    const p0 = points[0];
    let p1 = points[1], p2 = points[2], p3 = points[3];

    let maxDist = 0;
    for (let i = 1; i < points.length; i++) {
        const d = p0.distanceTo(points[i]);
        if (d > maxDist) { maxDist = d; p1 = points[i]; }
    }

    const lineDir = new THREE.Vector3().subVectors(p1, p0).normalize();
    maxDist = 0;
    for (const p of points) {
        const v = new THREE.Vector3().subVectors(p, p0);
        const perpDist = v.clone().sub(lineDir.clone().multiplyScalar(v.dot(lineDir))).length();
        if (perpDist > maxDist) { maxDist = perpDist; p2 = p; }
    }

    const planeNormal = new THREE.Vector3()
        .subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).normalize();
    maxDist = 0;
    for (const p of points) {
        const d = Math.abs(new THREE.Vector3().subVectors(p, p0).dot(planeNormal));
        if (d > maxDist) { maxDist = d; p3 = p; }
    }

    type Face = [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    const faces: Face[] = [];
    const tetPoints = [p0, p1, p2, p3];
    const tetCenter = new THREE.Vector3();
    for (const p of tetPoints) tetCenter.add(p);
    tetCenter.divideScalar(4);

    for (const [a, b, c] of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] as [number, number, number][]) {
        const face: Face = [tetPoints[a], tetPoints[b], tetPoints[c]];
        const fn = new THREE.Vector3().subVectors(face[1], face[0])
            .cross(new THREE.Vector3().subVectors(face[2], face[0]));
        if (fn.dot(new THREE.Vector3().subVectors(tetCenter, face[0])) > 0) {
            faces.push([face[0], face[2], face[1]]);
        } else {
            faces.push(face);
        }
    }

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p === p0 || p === p1 || p === p2 || p === p3) continue;

        const visibleIndices: number[] = [];
        for (let fi = 0; fi < faces.length; fi++) {
            const f = faces[fi];
            const fN = new THREE.Vector3().subVectors(f[1], f[0])
                .cross(new THREE.Vector3().subVectors(f[2], f[0])).normalize();
            if (new THREE.Vector3().subVectors(p, f[0]).dot(fN) > 0.001) {
                visibleIndices.push(fi);
            }
        }
        if (visibleIndices.length === 0) continue;

        const horizonEdges: [THREE.Vector3, THREE.Vector3][] = [];
        for (const fi of visibleIndices) {
            const f = faces[fi];
            const edges: [THREE.Vector3, THREE.Vector3][] = [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]];
            for (const [ea, eb] of edges) {
                let shared = false;
                for (const fj of visibleIndices) {
                    if (fj === fi) continue;
                    if (faces[fj].includes(ea) && faces[fj].includes(eb)) { shared = true; break; }
                }
                if (!shared) horizonEdges.push([ea, eb]);
            }
        }

        const sorted = [...visibleIndices].sort((a, b) => b - a);
        for (const fi of sorted) faces.splice(fi, 1);
        for (const [ea, eb] of horizonEdges) faces.push([ea, eb, p]);
    }

    const vertices: number[] = [];
    const normals: number[] = [];
    for (const [a, b, c] of faces) {
        const fn = new THREE.Vector3().subVectors(b, a)
            .cross(new THREE.Vector3().subVectors(c, a)).normalize();
        vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        normals.push(fn.x, fn.y, fn.z, fn.x, fn.y, fn.z, fn.x, fn.y, fn.z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geo;
}

// ── Generate mineral geometry ────────────────────────────────────
function createMineralGeometry(facets: number, seed: number): THREE.BufferGeometry {
    const rand = splitmix32(seed);
    const pointCount = Math.max(16, Math.min(40, facets * 3 + 8));

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < pointCount; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / pointCount);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const baseR = 0.4 + rand() * 0.25;
        const yScale = 0.7 + rand() * 0.4;
        points.push(new THREE.Vector3(
            baseR * Math.sin(phi) * Math.cos(theta) * (0.8 + rand() * 0.4),
            baseR * Math.sin(phi) * Math.sin(theta) * yScale,
            baseR * Math.cos(phi) * (0.8 + rand() * 0.4),
        ));
    }
    return buildConvexHull(points);
}

// ── Inner structure geometry ─────────────────────────────────────
function createInnerGeometry(seed: number): THREE.BufferGeometry {
    const rand = splitmix32(seed + 7777);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
        const phi = Math.acos(1 - (2 * (i + 0.5)) / 8);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const r = 0.12 + rand() * 0.1;
        points.push(new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi),
        ));
    }
    return buildConvexHull(points);
}

// ── HSL → Color ──────────────────────────────────────────────────
function hslColor(h: number, s: number, l: number): THREE.Color {
    return new THREE.Color().setHSL(h / 360, s, l);
}

// ── Outer crystal shell ──────────────────────────────────────────
function CrystalShell({ params }: { params: CrystalVisualParams }) {
    const meshRef = useRef<THREE.Mesh>(null);
    const seedNum = Number(params.seed & BigInt(0xFFFFFFFF));

    const geometry = useMemo(
        () => createMineralGeometry(params.facets, seedNum),
        [params.facets, seedNum],
    );

    // Crystal color — use moderate saturation, avoid black
    const crystalColor = useMemo(
        () => hslColor(params.hue, 0.55 + params.clarity * 0.3, 0.5 + params.clarity * 0.15),
        [params.hue, params.clarity],
    );

    // Patina shifts toward amber
    const finalColor = useMemo(() => {
        const warm = hslColor(38, 0.5, 0.4);
        return crystalColor.clone().lerp(warm, params.patina * 0.2);
    }, [crystalColor, params.patina]);

    useFrame((state) => {
        if (!meshRef.current) return;
        const t = state.clock.elapsedTime;
        meshRef.current.scale.setScalar(1 + Math.sin((t / 18) * Math.PI * 2) * 0.012);
        meshRef.current.rotation.y = t * 0.05;
    });

    return (
        <mesh ref={meshRef} geometry={geometry}>
            <MeshTransmissionMaterial
                color={finalColor}
                transmission={0.97}
                /* CLARITY MAPPING (spec: clarity = transparency, higher = clearer)
                 * High clarity → thin material = more light passes through
                 * Low clarity  → thick material = more absorption/turbidity */
                thickness={1.8 - params.clarity * 1.2}
                roughness={0.06 + params.texture * 0.15}
                ior={2.0 + params.clarity * 0.15}
                chromaticAberration={0.03 + params.radiance * 0.06}
                /* No distortion = sharp, clean */
                distortion={0}
                distortionScale={0}
                temporalDistortion={0}
                /* Thin backside for internal depth */
                backside={true}
                backsideThickness={0.12}
                /* High clarity → longer attenuation = lighter/more translucent */
                attenuationColor={finalColor}
                attenuationDistance={1.5 + params.clarity * 4.0}
                anisotropy={0.1}
                samples={10}
                resolution={512}
                toneMapped={true}
            />
        </mesh>
    );
}

// ── Inner inclusions ─────────────────────────────────────────────
function CrystalInner({ params }: { params: CrystalVisualParams }) {
    const seedNum = Number(params.seed & BigInt(0xFFFFFFFF));
    const geometry = useMemo(() => createInnerGeometry(seedNum), [seedNum]);
    const innerColor = useMemo(
        () => hslColor(params.hue, 0.4, 0.3),
        [params.hue],
    );

    return (
        <mesh geometry={geometry}>
            <meshStandardMaterial
                color={innerColor}
                metalness={0.15}
                roughness={0.5}
                transparent
                opacity={(0.5 - params.clarity * 0.3) + params.clarity * 0.1}
            />
        </mesh>
    );
}

// ── Subtle glow ──────────────────────────────────────────────────
function CrystalGlow({ params }: { params: CrystalVisualParams }) {
    const glowRef = useRef<THREE.Mesh>(null);
    const glowColor = useMemo(() => hslColor(params.hue, 0.5, 0.6), [params.hue]);

    useFrame((state) => {
        if (!glowRef.current) return;
        const pulse = 0.5 + Math.sin(state.clock.elapsedTime * 0.25) * 0.2 * params.radiance;
        (glowRef.current.material as THREE.MeshBasicMaterial).opacity =
            0.02 + params.radiance * 0.04 * pulse;
    });

    return (
        <mesh ref={glowRef} scale={1.15}>
            <sphereGeometry args={[0.7, 16, 16]} />
            <meshBasicMaterial
                color={glowColor}
                transparent
                opacity={0.03}
                depthWrite={false}
                side={THREE.BackSide}
            />
        </mesh>
    );
}

// ── Public component ─────────────────────────────────────────────

interface Crystal3DProps {
    params: CrystalVisualParams;
    size?: number;
    className?: string;
    animate?: boolean;
}

export default function Crystal3D({
    params,
    size = 280,
    className,
    animate = true,
}: Crystal3DProps) {
    return (
        <div
            className={className}
            style={{
                width: size,
                height: size,
                position: 'relative',
                borderRadius: 16,
                overflow: 'hidden',
                border: '1px solid rgba(199, 168, 107, 0.12)',
            }}
        >
            <Canvas
                camera={{ position: [0, 0.15, 2.8], fov: 40 }}
                gl={{
                    antialias: true,
                    alpha: true,
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.6,
                }}
                style={{ background: 'transparent' }}
                frameloop={animate ? 'always' : 'demand'}
            >
                {/* Uniform, softer environment — avoids blowing out flat faces */}
                <Environment background={false} resolution={512}>
                    {/* Key: warm but not too bright */}
                    <Lightformer intensity={2} position={[3, 5, 4]} scale={[8, 4, 1]} color="#fff8f0" />
                    {/* Fill: cool ambient */}
                    <Lightformer intensity={1.5} position={[-4, 3, -2]} scale={[6, 5, 1]} color="#e0e8f8" />
                    {/* Bottom bounce: warm */}
                    <Lightformer intensity={1.2} position={[0, -4, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} color="#f0e8d8" />
                    {/* Back: broad, moderate */}
                    <Lightformer intensity={1.8} position={[0, 2, -5]} scale={[12, 6, 1]} color="#f8f4f0" />
                    {/* Ambient wrap: big, soft ring */}
                    <Lightformer form="ring" intensity={1.2} position={[0, 0, 0]} scale={18} color="#f5f0e8" />
                    {/* Side accents: subtle */}
                    <Lightformer intensity={1} position={[5, 0, 2]} scale={[3, 8, 1]} color="#ffe8d0" />
                    <Lightformer intensity={0.8} position={[-5, -1, 3]} scale={[3, 8, 1]} color="#d8e8ff" />
                </Environment>

                <ambientLight intensity={0.06} />

                <Float
                    speed={animate ? 1.0 : 0}
                    rotationIntensity={animate ? 0.08 : 0}
                    floatIntensity={animate ? 0.15 : 0}
                >
                    <CrystalShell params={params} />
                    <CrystalInner params={params} />
                    <CrystalGlow params={params} />
                </Float>
            </Canvas>
        </div>
    );
}
