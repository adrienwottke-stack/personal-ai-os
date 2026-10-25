import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  agentRules:false,
  experimental:{cpus:1},
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter", "@prisma/client", "@prisma/adapter-pg", "pg"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }, { source: "/sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
    ] }, { source: "/offline.html", headers: [
      { key: "Content-Security-Policy", value: "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
    ] }];
  },
};
export default config;
