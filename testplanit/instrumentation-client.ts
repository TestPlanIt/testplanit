// Runs in the browser before the app hydrates (Next's instrumentation-client
// hook). Under a path-prefixed install it rewrites root-relative fetch URLs
// so every call reaches the app instead of the host root; at the root the
// install is a no-op. See lib/basePath.ts.
import { installBasePathFetch } from "~/lib/basePath";

installBasePathFetch(globalThis);
