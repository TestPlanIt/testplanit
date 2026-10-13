import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPresignClient,
  getS3Client,
  resolveCredentials,
  resolveRegion,
} from "./s3Client";

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_ENDPOINT_URL;
  delete process.env.AWS_PUBLIC_ENDPOINT_URL;
  delete process.env.AWS_REGION;
  delete process.env.AWS_BUCKET_REGION;
});

afterEach(() => {
  process.env = originalEnv;
});

describe("resolveCredentials", () => {
  it("returns static credentials when both key and secret are set", () => {
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

    expect(resolveCredentials()).toEqual({
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    });
  });

  // The next four all assert the SAME thing: no `credentials` key whatsoever.
  // That omission is what hands resolution to the SDK's default provider chain;
  // returning `{ credentials: { accessKeyId: undefined } }` would instead fail
  // with "Resolved credential object is not valid".
  it("omits credentials entirely when both are missing", () => {
    expect(resolveCredentials()).toEqual({});
    expect(resolveCredentials()).not.toHaveProperty("credentials");
  });

  it("omits credentials when only the key is set", () => {
    process.env.AWS_ACCESS_KEY_ID = "test-key";

    expect(resolveCredentials()).not.toHaveProperty("credentials");
  });

  it("omits credentials when only the secret is set", () => {
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

    expect(resolveCredentials()).not.toHaveProperty("credentials");
  });

  it("treats empty strings as absent rather than as valid credentials", () => {
    process.env.AWS_ACCESS_KEY_ID = "";
    process.env.AWS_SECRET_ACCESS_KEY = "";

    expect(resolveCredentials()).not.toHaveProperty("credentials");
  });
});

describe("resolveRegion", () => {
  it("prefers AWS_REGION", () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_BUCKET_REGION = "eu-west-1";

    expect(resolveRegion()).toBe("us-east-1");
  });

  it("falls back to the legacy AWS_BUCKET_REGION alias", () => {
    process.env.AWS_BUCKET_REGION = "eu-west-1";

    expect(resolveRegion()).toBe("eu-west-1");
  });

  it("is undefined when neither is set", () => {
    expect(resolveRegion()).toBeUndefined();
  });
});

describe("getS3Client", () => {
  it("uses path-style addressing against a custom endpoint (MinIO)", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = "http://minio:9000";

    const client = getS3Client();

    expect(client.config.forcePathStyle).toBe(true);
    expect((await client.config.endpoint!()).hostname).toBe("minio");
  });

  it("uses virtual-hosted addressing when no endpoint is set (real S3)", () => {
    process.env.AWS_REGION = "us-east-1";

    expect(getS3Client().config.forcePathStyle).toBe(false);
  });

  it("ignores the public endpoint for server-side access", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = "http://minio:9000";
    process.env.AWS_PUBLIC_ENDPOINT_URL = "https://files.example.com";

    expect((await getS3Client().config.endpoint!()).hostname).toBe("minio");
  });

  it("passes static credentials through to the client when configured", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "test-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

    const creds = await getS3Client().config.credentials();

    expect(creds.accessKeyId).toBe("test-key");
  });
});

describe("getPresignClient", () => {
  it("signs against the public endpoint so browsers can resolve the URL", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = "http://minio:9000";
    process.env.AWS_PUBLIC_ENDPOINT_URL = "https://files.example.com";

    const endpoint = await getPresignClient().config.endpoint!();

    expect(endpoint.hostname).toBe("files.example.com");
  });

  it("falls back to the internal endpoint when no public one is set", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = "http://minio:9000";

    const endpoint = await getPresignClient().config.endpoint!();

    expect(endpoint.hostname).toBe("minio");
  });

  it("keeps path-style addressing tied to the internal endpoint", () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ENDPOINT_URL = "http://minio:9000";
    process.env.AWS_PUBLIC_ENDPOINT_URL = "https://files.example.com";

    expect(getPresignClient().config.forcePathStyle).toBe(true);
  });
});
