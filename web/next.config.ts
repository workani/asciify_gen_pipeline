import path from "node:path";
import type { NextConfig } from "next";

/* Static export: the Python bridge serves the built site and the SSE stream
   from one process, so a live run needs no Node runtime. */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // The generator repo above has its own lockfile; pin the root to this app.
  turbopack: { root: path.dirname(new URL(import.meta.url).pathname) },
};

export default nextConfig;
