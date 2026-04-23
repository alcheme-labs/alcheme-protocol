import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { getAllowedDevOrigins } from "./config/mobileShellConfig.mjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(process.env.ALCHEME_MOBILE_SERVER_URL),
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/static/:path*",
          destination: "/_next/static/:path*",
        },
      ];
    }
    return [];
  },
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
