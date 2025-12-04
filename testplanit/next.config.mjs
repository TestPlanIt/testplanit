import path from 'path';
import { fileURLToPath } from 'url';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin({
  locales: ['en-US', 'es-ES', 'fr-FR'],
  defaultLocale: 'en-US',
  requestConfig: './i18n/request.ts',
  createNextIntlPlugin: {
    createMessagesDeclaration: {
      path: './messages/en-US.json',
      makeParamsOptional: true
    }
  }
});

// Helper function to extract hostname and port from URL
const parseUrlForPattern = (url) => {
  try {
    const parsed = new URL(url);
    return {
      protocol: parsed.protocol.replace(':', ''),
      hostname: parsed.hostname,
      port: parsed.port || '',
    };
  } catch {
    return null;
  }
};

const addUploadPatternsForUrl = (patterns, url, uploadPaths) => {
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
  const dynamicPatterns = [];
  const bucketName = process.env.AWS_BUCKET_NAME || 'testplanit';

  const uploadPaths = [
    `/${bucketName}/uploads/**`,  // MinIO with bucket prefix (via nginx)
    '/uploads/avatars/**',         // Direct S3 or MinIO paths
    '/uploads/document-images/**',
    '/uploads/attachments/**',
    '/uploads/project-icons/**',
  ];

  // Include the public-facing URL that end-users access through nginx/proxy
  const publicEndpointUrl = process.env.AWS_PUBLIC_ENDPOINT_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  addUploadPatternsForUrl(dynamicPatterns, publicEndpointUrl, uploadPaths);

  // Include the direct storage endpoint when different (e.g., MinIO internal URL)
  const endpointUrl = process.env.AWS_ENDPOINT_URL;
  if (endpointUrl && endpointUrl !== publicEndpointUrl) {
    addUploadPatternsForUrl(dynamicPatterns, endpointUrl, uploadPaths);
  }

  // Optionally include an explicit internal MinIO endpoint if provided
  if (process.env.MINIO_INTERNAL_ENDPOINT) {
    addUploadPatternsForUrl(dynamicPatterns, process.env.MINIO_INTERNAL_ENDPOINT, uploadPaths);
  }

  // For multi-tenant deployments: Add wildcard pattern for *.testplanit.com
  // This allows the same Docker image to serve multiple subdomains
  const baseDomain = process.env.BASE_DOMAIN;
  if (baseDomain) {
    uploadPaths.forEach((pathname) => {
      dynamicPatterns.push({
        protocol: 'https',
        hostname: `*.${baseDomain}`,
        port: '',
        pathname,
      });
    });
  }

  return dynamicPatterns;
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  turbopack: {},
  transpilePackages: ['lucide-react'],
  serverExternalPackages: ["@zenstackhq/runtime", "@zenstackhq/server"],
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../"),
  experimental: {
    // Limit number of workers to reduce memory usage during build
    workerThreads: false,
    cpus: 4,
    // Increase body size limit for server actions (file uploads)
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    remotePatterns: [
      // Dynamic patterns from environment variables
      ...buildDynamicRemotePatterns(),

      // Static patterns for third-party services
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**', // Google profile pictures for SSO
      },

      // AWS S3 pattern (only needed if using direct S3, not MinIO)
      // If you're using real AWS S3, you need to update this:
      {
        protocol: 'https',
        hostname: 'testplanitdev.s3.us-east-1.amazonaws.com',
        port: '',
        pathname: '/uploads/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
