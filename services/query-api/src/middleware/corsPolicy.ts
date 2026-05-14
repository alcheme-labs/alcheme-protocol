import type { RequestHandler } from "express";

export interface CorsPolicyOptions {
  firstPartyOrigins: string[];
  devExternalOrigins: string[];
  cacheTtlMs: number;
}

interface CorsPolicyPrisma {
  externalApp: {
    findMany(input: unknown): Promise<Array<{ allowedOrigins: unknown }>>;
  };
}

export function createCorsPolicy(
  prisma: CorsPolicyPrisma,
  options: CorsPolicyOptions,
): {
  corsMiddleware: RequestHandler;
  clearCache(): void;
} {
  let cachedExternalOrigins: Set<string> | null = null;
  let cachedAt = 0;

  async function loadExternalOrigins(): Promise<Set<string>> {
    const now = Date.now();
    if (
      cachedExternalOrigins &&
      now - cachedAt < Math.max(0, options.cacheTtlMs)
    ) {
      return cachedExternalOrigins;
    }
    const rows = await prisma.externalApp.findMany({
      where: { status: "active", registryStatus: "active" },
      select: { allowedOrigins: true },
    });
    cachedExternalOrigins = new Set(
      rows.flatMap((row) =>
        Array.isArray(row.allowedOrigins)
          ? row.allowedOrigins.map((origin) => String(origin))
          : [],
      ),
    );
    cachedAt = now;
    return cachedExternalOrigins;
  }

  const corsMiddleware: RequestHandler = (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();

    void (async () => {
      const originValue = String(origin);
      const allowed = new Set([
        ...options.firstPartyOrigins,
        ...options.devExternalOrigins,
        ...(await loadExternalOrigins()),
      ]);
      if (!allowed.has(originValue)) {
        return res.status(403).json({
          error: "origin_not_allowed",
          message: `Origin is not allowed: ${originValue}`,
        });
      }
      res.setHeader("Access-Control-Allow-Origin", originValue);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] ||
          "Authorization,Content-Type",
      );
      if (req.method === "OPTIONS") {
        return res.status(204).end();
      }
      return next();
    })().catch(next);
  };

  return {
    corsMiddleware,
    clearCache() {
      cachedExternalOrigins = null;
      cachedAt = 0;
    },
  };
}

export function parseOriginList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function defaultDevExternalOrigins(nodeEnv = process.env.NODE_ENV): string[] {
  if (nodeEnv === "production") return [];
  return [
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}
