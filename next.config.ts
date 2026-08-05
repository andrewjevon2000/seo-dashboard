import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Server Components query Postgres directly; the `postgres` driver must not be
  // bundled into the client. It is only imported from server code, but this makes
  // the intent explicit and avoids accidental edge-runtime bundling.
  serverExternalPackages: ["postgres"],
  // Pin the workspace root to this project. Without it, Next infers the root from
  // the nearest lockfile and picked up a stray one in the parent Downloads folder,
  // which skews build file-tracing.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
};

export default nextConfig;
