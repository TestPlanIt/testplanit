// lib/s3Client.ts
// Single place where the S3 / MinIO clients are built.
//
// CREDENTIALS ARE OPTIONAL. When AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
// are both set they are used as static credentials -- the long-standing
// behaviour, and the only thing MinIO accepts. When either is missing we omit
// the `credentials` key ENTIRELY so the AWS SDK falls back to its default
// provider chain: EC2 instance role, EKS IRSA, ECS task role, SSO, or the
// shared config file. That lets a self-hosted deployment on AWS run without
// long-lived keys on disk.
//
// Omitting the key is the whole trick. Passing `{ accessKeyId: undefined }` is
// NOT equivalent to passing nothing: the SDK treats an explicit credentials
// object as static credentials and rejects it with "Resolved credential object
// is not valid" rather than consulting the provider chain. Every call site used
// to build that object unconditionally, which is why role-based auth could not
// work at all before this module existed.
import { S3Client } from "@aws-sdk/client-s3";

/**
 * AWS_REGION is the documented variable; AWS_BUCKET_REGION is an older alias
 * still present in some deployments' .env files.
 *
 * Exported for tests.
 */
export function resolveRegion(): string | undefined {
  return process.env.AWS_REGION || process.env.AWS_BUCKET_REGION;
}

/**
 * Static credentials when both halves are present, otherwise an empty object so
 * the SDK's default provider chain takes over. Spread into the client config.
 *
 * Exported for tests: once this is handed to the SDK it is normalised into an
 * opaque provider function, and on a host that happens to have an instance role
 * the chain resolves successfully -- so asserting through a built client would
 * make the result depend on where the suite runs.
 */
export function resolveCredentials():
  | Record<string, never>
  | { credentials: { accessKeyId: string; secretAccessKey: string } } {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (accessKeyId && secretAccessKey) {
    return { credentials: { accessKeyId, secretAccessKey } };
  }

  return {};
}

/**
 * A custom endpoint means a non-AWS, S3-compatible server (MinIO), which needs
 * path-style addressing. Real S3 uses virtual-hosted style.
 */
function resolveForcePathStyle(): boolean {
  return Boolean(process.env.AWS_ENDPOINT_URL);
}

/**
 * Client for server-side access. Always uses the INTERNAL endpoint, which on a
 * container deployment is reachable only from inside the network
 * (e.g. http://minio:9000).
 */
export function getS3Client(): S3Client {
  return new S3Client({
    region: resolveRegion(),
    ...resolveCredentials(),
    endpoint: process.env.AWS_ENDPOINT_URL,
    forcePathStyle: resolveForcePathStyle(),
  });
}

/**
 * Client for generating presigned URLs handed to a browser. Signs against the
 * PUBLIC endpoint, because a URL signed for the internal hostname is not
 * resolvable by the user's browser -- and the host is part of the signature, so
 * it cannot be rewritten afterwards. Falls back to the internal endpoint when
 * no public one is configured (and to real S3 when neither is set).
 */
export function getPresignClient(): S3Client {
  return new S3Client({
    region: resolveRegion(),
    ...resolveCredentials(),
    endpoint: process.env.AWS_PUBLIC_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL,
    forcePathStyle: resolveForcePathStyle(),
  });
}
