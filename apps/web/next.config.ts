import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Referrer-Policy",
    value: "no-referrer"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  }
];

const nextConfig: NextConfig = {
  distDir: process.env.VERA_NEXT_DIST_DIR?.trim() || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
  // Next auto-externalizes pg. Turbopack can encode that external as a build-local
  // package identity that pnpm's production deploy cannot resolve, so keep pg in
  // the server bundle while better-sqlite3 remains an explicit native external.
  transpilePackages: ["@vera/connectors", "@vera/db", "@vera/domain", "@vera/policy", "pg"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
