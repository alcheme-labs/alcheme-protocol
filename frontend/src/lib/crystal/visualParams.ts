/**
 * Crystal Visual Parameters
 *
 * Maps knowledge data to 8 visual dimensions that drive crystal rendering.
 *
 * Active contract:
 * - frozen params follow `docs/architecture/DATA_DOMAIN_MAP.md`
 * - `warmth` is a dynamic crystal property whose initial value inherits from
 *   the crystallized draft / alloy heat, then may later absorb knowledge-side
 *   signals such as citation or discussion resonance
 *
 * Parameter lifecycle:
 *   FROZEN at crystallization (stored in DB crystal_params):
 *     seed, hue, facets
 *
 *   DYNAMIC (computed from latest data):
 *     clarity    ← stats.qualityScore  (0-100 → 0-1)
 *     texture    ← version             (1-N → 0-1)
 *     radiance   ← stats.citationCount (0-N → 0-1)
 *     patina     ← createdAt + stats.citationCount
 *     warmth     ← stats.heatScore     (0-100 → 0-1)
 */

// ── Colour anchors (HSL hue degrees) ──────────────────────────────
const HUE_ANCHORS = [42, 200, 280, 150] as const; // gold, sapphire, amethyst, jade

// ── FNV-1a 32-bit hash ────────────────────────────────────────────
function fnv1a(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0; // unsigned
}

// ── Helper: clamp to [0, 1] ───────────────────────────────────────
function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

// ── Public interface ──────────────────────────────────────────────

export interface CrystalVisualParams {
    /** PRNG seed for geometry uniqueness (BigInt from knowledgeId). */
    seed: bigint;
    /** HSL hue degree (one of 4 colour anchors). */
    hue: number;
    /** Transparency / inner glow intensity [0, 1]. */
    clarity: number;
    /** Number of facets [3, 12]. */
    facets: number;
    /** Surface texture roughness [0, 1]. */
    texture: number;
    /** Emission / glow brightness [0, 1]. */
    radiance: number;
    /** Age patina level [0, 1]. */
    patina: number;
    /** Heat intensity [0, 1]. */
    warmth: number;
}

export interface CrystalDataInput {
    knowledgeId: string;
    circleName: string;
    qualityScore: number;
    contributorsCount: number;
    version: number;
    citationCount: number;
    createdAt: string; // ISO-8601
    /** Dynamic crystal heat from backend (0-100). */
    heatScore?: number;
}

/** Frozen crystal params stored at crystallization time. */
export interface FrozenCrystalParams {
    seed: string; // hex string like "0xa1b2c3d4e5f67890"
    hue: number;
    facets: number;
}

/**
 * Compute all 8 visual parameters from knowledge data.
 *
 * Pure function — no side effects, fully deterministic.
 *
 * @param data - Live knowledge data
 * @param frozen - Optional frozen params from DB (overrides seed/hue/facets computation)
 */
export function computeCrystalVisualParams(
    data: CrystalDataInput,
    frozen?: FrozenCrystalParams | null,
): CrystalVisualParams {
    // ── Frozen params (use stored values if available, else compute) ──

    let seed: bigint;
    let hue: number;
    let facets: number;

    if (frozen) {
        // Use frozen values from DB
        seed = BigInt(frozen.seed);
        hue = frozen.hue;
        facets = frozen.facets;
    } else {
        // Compute from live data (for preview / before crystallization)
        const seedHex = data.knowledgeId.slice(0, 16) || '0';
        seed = BigInt('0x' + seedHex);
        hue = HUE_ANCHORS[fnv1a(data.circleName) % HUE_ANCHORS.length];
        facets = Math.min(12, Math.max(3, 3 + data.contributorsCount));
    }

    // ── Dynamic params (always computed from latest data) ──

    // Clarity — quality score normalised to [0, 1]
    const clarity = clamp01(data.qualityScore / 100);

    // Texture — version → asymptotic [0, 1]
    const texture = clamp01(1 - 1 / Math.max(1, data.version));

    // Radiance — citation count → logarithmic [0, 1]
    const radiance = clamp01(Math.log2(1 + data.citationCount) / 10);

    // Patina — age in days modulated by citation activity
    const ageDays = Math.max(0, (Date.now() - new Date(data.createdAt).getTime()) / 86_400_000);
    const patina = clamp01(
        (Math.log2(1 + ageDays) / 8) * (1 + 0.05 * Math.min(data.citationCount, 20)),
    );

    // Warmth — heat score normalised to [0, 1]
    const warmth = clamp01((data.heatScore ?? 0) / 100);

    return { seed, hue, clarity, facets, texture, radiance, patina, warmth };
}

/**
 * Convenience: extract CrystalDataInput from a GQL Knowledge object.
 */
export function knowledgeToCrystalInput(knowledge: {
    knowledgeId: string;
    circle: { name: string } | null;
    contributorsCount: number;
    version: number;
    stats: { qualityScore: number; citationCount: number; heatScore?: number };
    createdAt: string;
}): CrystalDataInput {
    return {
        knowledgeId: knowledge.knowledgeId,
        circleName: knowledge.circle?.name ?? 'unknown',
        qualityScore: knowledge.stats.qualityScore,
        contributorsCount: knowledge.contributorsCount,
        version: knowledge.version,
        citationCount: knowledge.stats.citationCount,
        createdAt: knowledge.createdAt,
        heatScore: knowledge.stats.heatScore ?? 0,
    };
}
