export function computeBackingLevel(amountsRaw: string[]): number {
  return amountsRaw.reduce((sum, raw) => {
    const amount = Math.max(0, Number(raw));
    return sum + Math.sqrt(amount);
  }, 0);
}

export function computeChallengePressure(input: {
  backingRaw: string;
  challengeRaw: string;
}): number {
  const backing = Math.max(0, Number(input.backingRaw));
  const challenge = Math.max(0, Number(input.challengeRaw));
  if (backing === 0) return challenge > 0 ? 1 : 0;
  return challenge / backing;
}
