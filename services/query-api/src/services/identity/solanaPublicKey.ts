import { PublicKey } from "@solana/web3.js";

export function parseCanonicalSolanaPublicKey(value: unknown): PublicKey | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return null;
  }
  try {
    const publicKey = new PublicKey(value);
    return publicKey.toBase58() === value ? publicKey : null;
  } catch {
    return null;
  }
}

export function canonicalSolanaPublicKeyString(value: unknown): string | null {
  return parseCanonicalSolanaPublicKey(value)?.toBase58() ?? null;
}

export function solanaPublicKeysEqual(left: unknown, right: unknown): boolean {
  const leftPublicKey = parseCanonicalSolanaPublicKey(left);
  const rightPublicKey = parseCanonicalSolanaPublicKey(right);
  return !!leftPublicKey && !!rightPublicKey && leftPublicKey.equals(rightPublicKey);
}
