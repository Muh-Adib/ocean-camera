import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // NEXT_DIST_DIR lets CI verify the production build in isolation
  // (NEXT_DIST_DIR=.next-prod bunx next build) without clobbering dev.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // ---------------------------------------------------------------
  // DEPLOYMENT FIX — "Cannot find module
  // 'next/dist/compiled/webpack/webpack-lib'" in production containers.
  // The turbopack build never loads webpack, so the standalone file
  // trace omits next/dist/compiled/webpack/* — but the programmatic
  // `next()` API used by our custom server.js requires it lazily when
  // reading this config at boot. Force-include the compiled loaders so
  // any standalone output is self-sufficient.
  //
  // Same failure class, round 2 — "Cannot find module
  // 'baseline-browser-mapping'": loading next.config.ts at boot pulls
  // in next/dist/compiled/browserslist, which require()s the external
  // packages baseline-browser-mapping and caniuse-lite through
  // optional-style requires that the file trace skips. Force-include
  // them so standalone boots without the Dockerfile whitelist.
  // ---------------------------------------------------------------
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/next/dist/compiled/webpack/**",
      "./node_modules/baseline-browser-mapping/**",
      "./node_modules/caniuse-lite/**",
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
