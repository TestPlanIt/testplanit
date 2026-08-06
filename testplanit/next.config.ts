import path from "path";
import type { NextConfig } from "next";
import type { RemotePattern } from "next/dist/shared/lib/image-config";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin({
  requestConfig: "./i18n/request.ts",
  experimental: {
    createMessagesDeclaration: "./messages/en-US.json",
  },
});

// Helper function to extract hostname and port from URL
const parseUrlForPattern = (url: string) => {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.replace(":", "") as "http" | "https";
    return { protocol, hostname: parsed.hostname, port: parsed.port || "" };
  } catch {
    return null;
  }
};

const addUploadPatternsForUrl = (
  patterns: RemotePattern[],
  url: string | undefined,
  uploadPaths: string[]
) => {
  if (!url) {
    return;
  }

  const parsed = parseUrlForPattern(url);
  if (!parsed) {
    return;
  }

  uploadPaths.forEach((pathname) => {
    patterns.push({ ...parsed, pathname });
  });
};

// Build dynamic remote patterns based on environment configuration
const buildDynamicRemotePatterns = () => {
  const dynamicPatterns: RemotePattern[] = [];
  const bucketName = process.env.AWS_BUCKET_NAME || "testplanit";

  const uploadPaths = [
    `/${bucketName}/uploads/**`, // MinIO with bucket prefix (via nginx)
    "/uploads/avatars/**", // Direct S3 or MinIO paths
    "/uploads/document-images/**",
    "/uploads/attachments/**",
    "/uploads/project-icons/**",
  ];

  // Include the public-facing URL that end-users access through nginx/proxy
  const publicEndpointUrl =
    process.env.AWS_PUBLIC_ENDPOINT_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL;
  addUploadPatternsForUrl(dynamicPatterns, publicEndpointUrl, uploadPaths);

  // Include the direct storage endpoint when different (e.g., MinIO internal URL)
  const endpointUrl = process.env.AWS_ENDPOINT_URL;
  if (endpointUrl && endpointUrl !== publicEndpointUrl) {
    addUploadPatternsForUrl(dynamicPatterns, endpointUrl, uploadPaths);
  }

  // Optionally include an explicit internal MinIO endpoint if provided
  if (process.env.MINIO_INTERNAL_ENDPOINT) {
    addUploadPatternsForUrl(
      dynamicPatterns,
      process.env.MINIO_INTERNAL_ENDPOINT,
      uploadPaths
    );
  }

  // For multi-tenant deployments: Add wildcard pattern for *.testplanit.com
  // This allows the same Docker image to serve multiple subdomains
  const baseDomain = process.env.BASE_DOMAIN;
  if (baseDomain) {
    uploadPaths.forEach((pathname) => {
      dynamicPatterns.push({
        protocol: "https" as const,
        hostname: `*.${baseDomain}`,
        port: "",
        pathname,
      });
    });
  }

  return dynamicPatterns;
};

// In dev, Next.js blocks requests to /_next/* dev resources (HMR + client
// chunks) from any host other than localhost unless it's listed here. When the
// dev server is reached through a tunnel/proxy (e.g. a *.testplanit.com dev
// domain), derive the allowed host from the configured app URLs so client
// assets load and React hydrates. Ignored in production builds.
const buildAllowedDevOrigins = (): string[] => {
  const urls = [
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
  ];
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    const parsed = parseUrlForPattern(url);
    if (parsed?.hostname && parsed.hostname !== "localhost") {
      hosts.add(parsed.hostname);
    }
  }
  return Array.from(hosts);
};

// Turbopack's build cache lives in .next/cache and only speeds anything up when
// that directory survives between builds. CI runners and Docker layers start
// clean, so writing it there is cost without payoff. Local builds keep it.
const enableTurbopackBuildCache =
  !process.env.CI && process.env.DOCKER_BUILD !== "true";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  output: "standalone",
  allowedDevOrigins: buildAllowedDevOrigins(),
  turbopack: {
    resolveAlias: {
      // Fix Turbopack resolution for zod subpath exports (used by @hookform/resolvers)
      "zod/v3": "zod/v3",
      "zod/v4/core": "zod/v4/core",
    },
  },
  transpilePackages: ["lucide-react"],
  serverExternalPackages: [
    "@zenstackhq/orm",
    "@zenstackhq/plugin-policy",
    "@zenstackhq/server",
    "kysely",
    "pg",
    "test-results-parser",
    "jspdf",
    "fflate",
    // The instrumentation boot hook imports apply-triggers, which uses `pg` for raw DDL.
    // Keep it external so the native driver isn't bundled into the server runtime.
    "pg",
  ],
  outputFileTracingRoot: path.join(__dirname, "../"),
  // The instrumentation boot hook reads prisma/audit_row_change.sql at runtime to (re)install the
  // audit triggers. Trace it into the standalone output so it exists wherever the server runs.
  outputFileTracingIncludes: {
    "/**": ["./prisma/audit_row_change.sql"],
  },
  experimental: {
    turbopackFileSystemCacheForBuild: enableTurbopackBuildCache,
    // Limit number of workers to reduce memory usage during build
    workerThreads: false,
    cpus: 2,
    // Increase body size limit for server actions (file uploads)
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    // Self-hosted / OSS images are built with SELF_HOSTED=true, which turns off
    // Next's image optimizer. That makes the build domain-agnostic: <Image>
    // renders a plain <img> pointing straight at the operator's own storage, so
    // no build-time remotePatterns allowlist (and therefore no baked domain) is
    // needed and a single published image runs on any host. The multi-tenant
    // SaaS build leaves this off and relies on the BASE_DOMAIN allowlist below.
    unoptimized: process.env.SELF_HOSTED === "true",
    remotePatterns: [
      // Dynamic patterns from environment variables
      ...buildDynamicRemotePatterns(),

      // Static patterns for third-party services
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        port: "",
        pathname: "/**", // Google profile pictures for SSO
      },

      // AWS S3 pattern (only needed if using direct S3, not MinIO)
      // If you're using real AWS S3, you need to update this:
      {
        protocol: "https",
        hostname: "testplanitdev.s3.us-east-1.amazonaws.com",
        port: "",
        pathname: "/uploads/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
