/* ═══════════════════════════════════════
   Alchemy Module — Barrel Exports
   All life-feel systems in one place.
   ═══════════════════════════════════════ */

// ── Hooks ──
export { useLifeFeel } from './useLifeFeel';
export type { UseLifeFeelOptions, LifeFeelReturn } from './useLifeFeel';

export { useHeatDecay } from './useHeatDecay';
export type { HeatState, HeatEvent } from './useHeatDecay';

export { useColorTemperature } from './useColorTemperature';
export { usePatina } from './usePatina';
export { useCuriosity } from './useCuriosity';
export { useLongPress } from './useLongPress';

// ── Components ──
export { default as BreathingBg } from './BreathingBg';
export { default as HeatGauge } from './HeatGauge';
