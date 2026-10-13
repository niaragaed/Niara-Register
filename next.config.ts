import type { NextConfig } from "next";

/**
 * The site's routes are in English and the same in both languages: the
 * language comes from the cookie, not the URL.
 *
 * The old Portuguese paths were shared before the rename, so they answer with
 * a permanent redirect (308) instead of a 404. `permanent: true` emits 308,
 * which preserves the request method; the classic 301 does not guarantee that.
 * Do not remove them before the old links have had time to fall out of use.
 */
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/registro-pmes", destination: "/sme-registry", permanent: true },
      { source: "/registro-global", destination: "/global-registry", permanent: true },
      { source: "/assinatura", destination: "/signatures", permanent: true },
    ];
  },
};

export default nextConfig;
