// Runs in the browser before the app hydrates (Next's instrumentation-client
// hook). Under a path-prefixed install it rewrites root-relative fetch URLs
// so every call reaches the app instead of the host root; at the root the
// install is a no-op. See lib/basePath.ts.
import { z } from "zod";
import { installBasePathFetch } from "~/lib/basePath";

installBasePathFetch(globalThis);

// Zod compiles fast paths with `new Function` unless told not to, and probes
// for that with an eval the Content-Security-Policy refuses. The probe is
// caught and Zod falls back by itself, but every page load would report a
// violation. Skip the JIT in the browser, before any schema runs.
z.config({ jitless: true });
