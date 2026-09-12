const DEFAULT_MAX_STREAM_CONNECTIONS_PER_WALLET = 3;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface CommunicationStreamConnectionLimiter {
  tryAcquire(walletPubkey: string): (() => void) | null;
}

export function createCommunicationStreamConnectionLimiter(
  maxConnectionsPerWallet: number,
): CommunicationStreamConnectionLimiter {
  const activeConnections = new Map<string, number>();

  return {
    tryAcquire(walletPubkey) {
      const actor = walletPubkey.trim();
      const current = activeConnections.get(actor) ?? 0;
      if (current >= maxConnectionsPerWallet) return null;

      activeConnections.set(actor, current + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const remaining = (activeConnections.get(actor) ?? 1) - 1;
        if (remaining <= 0) activeConnections.delete(actor);
        else activeConnections.set(actor, remaining);
      };
    },
  };
}

export function resolveCommunicationStreamMaxConnections(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveInt(
    env.COMMUNICATION_STREAM_MAX_CONNECTIONS_PER_WALLET,
    DEFAULT_MAX_STREAM_CONNECTIONS_PER_WALLET,
  );
}

export const communicationStreamConnectionLimiter =
  createCommunicationStreamConnectionLimiter(
    resolveCommunicationStreamMaxConnections(),
  );
