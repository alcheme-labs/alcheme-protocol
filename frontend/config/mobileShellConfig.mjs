import os from 'node:os';

export const DEFAULT_ALLOWED_DEV_ORIGINS = ['127.0.0.1', 'localhost'];

const PRIVATE_LAN_PATTERNS = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

function isIpv4Family(family) {
  return family === 'IPv4' || family === 4;
}

function isPrivateLanIpv4(address) {
  return PRIVATE_LAN_PATTERNS.some((pattern) => pattern.test(address));
}

function scoreCandidate(interfaceName, address) {
  let score = 0;

  if (isPrivateLanIpv4(address)) {
    score += 100;
  }

  if (/^en\d/i.test(interfaceName)) {
    score += 40;
  } else if (/^(wl|wlan|wifi|eth)/i.test(interfaceName)) {
    score += 30;
  } else if (/^(utun|tun|tap|bridge|vboxnet|docker)/i.test(interfaceName)) {
    score -= 30;
  }

  if (address.startsWith('192.168.')) {
    score += 10;
  }

  return score;
}

export function normalizeMobileServerUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function getAllowedDevOrigins(mobileServerUrl) {
  const origins = new Set(DEFAULT_ALLOWED_DEV_ORIGINS);
  const normalizedUrl = normalizeMobileServerUrl(mobileServerUrl);

  if (!normalizedUrl) {
    return [...origins];
  }

  origins.add(new URL(normalizedUrl).hostname);

  return [...origins];
}

export function getCapacitorServerConfig(mobileServerUrl) {
  const normalizedUrl = normalizeMobileServerUrl(mobileServerUrl);

  if (!normalizedUrl) {
    throw new Error(
      'ALCHEME_MOBILE_SERVER_URL must be a valid http(s) URL, for example http://192.168.50.23:3000',
    );
  }

  return {
    url: normalizedUrl,
    cleartext: normalizedUrl.startsWith('http://'),
  };
}

export function pickLanIpv4(networkInterfacesMap) {
  const candidates = [];

  for (const [interfaceName, entries] of Object.entries(networkInterfacesMap ?? {})) {
    for (const entry of entries ?? []) {
      if (!isIpv4Family(entry.family) || entry.internal || !entry.address) {
        continue;
      }

      candidates.push({
        interfaceName,
        address: entry.address,
        score: scoreCandidate(interfaceName, entry.address),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  return candidates[0]?.address ?? null;
}

export function resolveLanServerUrl({
  env = process.env,
  networkInterfaces = os.networkInterfaces,
  defaultPort = 3000,
} = {}) {
  const explicitUrl = normalizeMobileServerUrl(env.ALCHEME_MOBILE_SERVER_URL);

  if (explicitUrl) {
    return explicitUrl;
  }

  const lanIpv4 = pickLanIpv4(
    typeof networkInterfaces === 'function' ? networkInterfaces() : networkInterfaces,
  );

  if (!lanIpv4) {
    throw new Error(
      'Unable to detect a LAN IPv4 address. Set ALCHEME_MOBILE_SERVER_URL=http://<your-ip>:3000 explicitly.',
    );
  }

  const parsedPort = Number.parseInt(String(env.PORT ?? defaultPort), 10);
  const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : defaultPort;

  return `http://${lanIpv4}:${port}`;
}
