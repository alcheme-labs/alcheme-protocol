export interface ExternalAppBondExposureInput {
  ownerBondRaw: string | number;
  activeLockedAmountRaw?: string | number | null;
  requestedAmountRaw?: string | number | null;
  pausedNewBondExposure?: boolean;
}

export function assertBondExposureAvailable(input: ExternalAppBondExposureInput): void {
  if (input.pausedNewBondExposure) {
    throw new Error("external_app_new_bond_exposure_paused");
  }
  const ownerBond = BigInt(normalizeRaw(input.ownerBondRaw));
  const activeLocked = BigInt(normalizeRaw(input.activeLockedAmountRaw ?? "0"));
  const requested = BigInt(normalizeRaw(input.requestedAmountRaw ?? "0"));
  if (requested <= 0n) {
    throw new Error("external_app_bond_exposure_amount_required");
  }
  if (activeLocked + requested > ownerBond) {
    throw new Error("external_app_bond_exposure_exceeds_owner_bond");
  }
}

export function buildBondExposureState(input: {
  ownerBondRaw: string | number;
  activeLockedAmountRaw?: string | number | null;
  totalRoutedAmountRaw?: string | number | null;
  pausedNewBondExposure?: boolean;
}) {
  const ownerBondRaw = normalizeRaw(input.ownerBondRaw);
  const activeLockedAmountRaw = normalizeRaw(input.activeLockedAmountRaw ?? "0");
  const totalRoutedAmountRaw = normalizeRaw(input.totalRoutedAmountRaw ?? "0");
  const availableBondRaw = (
    BigInt(ownerBondRaw) > BigInt(activeLockedAmountRaw)
      ? BigInt(ownerBondRaw) - BigInt(activeLockedAmountRaw)
      : 0n
  ).toString();
  return {
    ownerBondRaw,
    activeLockedAmountRaw,
    totalRoutedAmountRaw,
    availableBondRaw,
    pausedNewBondExposure: Boolean(input.pausedNewBondExposure),
  };
}

function normalizeRaw(value: string | number | null | undefined): string {
  const normalized = String(value ?? "0").trim();
  return /^[0-9]+$/.test(normalized) ? normalized : "0";
}
