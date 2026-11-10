import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/settings/backups": ["./lib/backups.mjs"],
    "/api/backups": ["./lib/backups.mjs"],
    "/api/backups/*": ["./lib/backups.mjs"],
  },
  // Lets other PCs on the local network load dev scripts (clicks do nothing without them).
  // The public Cloudflare Tunnel domain needs the same permission.
  allowedDevOrigins: ["172.16.200.87", "172.16.200.120", "172.16.*.*", "192.168.*.*", "10.*.*.*", "restaurant.cubedevsys.com"],
  // Server Actions reject a request whose Origin differs from the Host; listed in case the tunnel rewrites the Host header.
  experimental: { serverActions: { bodySizeLimit: "6mb", allowedOrigins: ["restaurant.cubedevsys.com"] } },
  images: { unoptimized: true },
  poweredByHeader: false,
  // Browsers also ask for /favicon.ico directly; answer with the logo icon.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/api/app-icon?size=32" }];
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};

export default nextConfig;
