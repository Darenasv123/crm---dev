// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// BUILD_TARGET controls the Nitro preset:
//   - "node"  → produces a standalone Node.js HTTP server (.output/server/index.mjs)
//               used for Virtualmin / any Linux VPS deployment.
//   - default → "cloudflare-module" (Lovable sandbox / Wrangler deploy)
//
// Usage:
//   npm run build                  → cloudflare-module (default, Lovable / Wrangler)
//   BUILD_TARGET=node npm run build → node preset (Virtualmin production)
const buildTarget = process.env.BUILD_TARGET;
const isNodeBuild = buildTarget === "node";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // When BUILD_TARGET=node, override the default cloudflare-module preset so that
  // Nitro emits a standalone Node HTTP server instead of a Cloudflare Worker module.
  ...(isNodeBuild
    ? {
        nitro: {
          preset: "node",
        },
      }
    : {}),
});
