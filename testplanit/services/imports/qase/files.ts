import { PutObjectCommand } from "@aws-sdk/client-s3";
import * as dns from "node:dns/promises";
import { withBasePath } from "~/lib/basePath";
import { getS3Client } from "~/lib/s3Client";
import { sanitizeFileName } from "~/lib/storageUploads";
import {
  getAllowedPrivateHosts,
  isPrivateOrInternalIp,
} from "~/lib/utils/ssrf";

/** Qase's own limit for one attachment. */
export const QASE_MAX_FILE_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

export type QaseFileKind = "attachment" | "docimage";

const FOLDERS: Record<QaseFileKind, string> = {
  attachment: "uploads/attachments",
  docimage: "uploads/document-images",
};

export interface QaseCopiedFile {
  /** Where the copy is served from, as stored on attachments and images. */
  url: string;
  size: number;
  mime: string;
}

export interface QaseFileCopierOptions {
  jobId: string;
  fetchImpl?: typeof fetch;
  lookup?: (hostname: string) => Promise<string[]>;
  upload?: (key: string, body: Buffer, mime: string) => Promise<void>;
  /** Already copied files from an earlier attempt, by `kind:url`. */
  known?: Map<string, QaseCopiedFile>;
  onCopied?: (key: string, file: QaseCopiedFile) => Promise<void>;
}

export const isQaseStorageConfigured = () => !!process.env.AWS_BUCKET_NAME;

const defaultLookup = async (hostname: string) =>
  (await dns.lookup(hostname, { all: true })).map((entry) => entry.address);

async function defaultUpload(key: string, body: Buffer, mime: string) {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: mime,
      ContentLength: body.length,
    })
  );
}

/**
 * Copies files from Qase into TestPlanIt's storage. A file is downloaded once
 * per job and kind; a failure is remembered so the same file is not retried
 * for every case that uses it.
 */
export class QaseFileCopier {
  private readonly jobId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly lookup: (hostname: string) => Promise<string[]>;
  private readonly upload: (
    key: string,
    body: Buffer,
    mime: string
  ) => Promise<void>;
  private readonly done: Map<string, QaseCopiedFile>;
  private readonly failed = new Map<string, string>();
  private readonly onCopied?: QaseFileCopierOptions["onCopied"];
  private counter = 0;

  constructor(options: QaseFileCopierOptions) {
    this.jobId = options.jobId;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.lookup = options.lookup ?? defaultLookup;
    this.upload = options.upload ?? defaultUpload;
    this.done = options.known ?? new Map();
    this.onCopied = options.onCopied;
  }

  /** Why a file could not be copied, when it could not. */
  failureOf(kind: QaseFileKind, url: string): string | undefined {
    return this.failed.get(`${kind}:${url}`);
  }

  private async assertPublic(url: URL): Promise<void> {
    if (url.protocol !== "https:") {
      throw new Error("Only https addresses are downloaded.");
    }
    if (getAllowedPrivateHosts().has(url.hostname.toLowerCase())) {
      return;
    }
    const addresses = await this.lookup(url.hostname);
    if (addresses.length === 0 || addresses.some(isPrivateOrInternalIp)) {
      throw new Error("The address is private or could not be resolved.");
    }
  }

  private async download(
    source: string
  ): Promise<{ body: Buffer; mime: string }> {
    let current = new URL(source);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await this.assertPublic(current);
      const response = await this.fetchImpl(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("Redirect without a destination.");
        }
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        throw new Error(`Download answered with status ${response.status}.`);
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > QASE_MAX_FILE_BYTES) {
        throw new Error("The file is larger than 32 MB.");
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > QASE_MAX_FILE_BYTES) {
        throw new Error("The file is larger than 32 MB.");
      }
      return {
        body,
        mime: response.headers.get("content-type")?.split(";")[0].trim() ?? "",
      };
    }
    throw new Error("Too many redirects.");
  }

  /** The copy of a Qase file, or null when it could not be copied. */
  async copy(
    kind: QaseFileKind,
    source: string,
    fileName: string,
    mime?: string
  ): Promise<QaseCopiedFile | null> {
    const cacheKey = `${kind}:${source}`;
    const existing = this.done.get(cacheKey);
    if (existing) {
      return existing;
    }
    if (this.failed.has(cacheKey)) {
      return null;
    }
    try {
      if (!isQaseStorageConfigured()) {
        throw new Error("File storage is not set up.");
      }
      const downloaded = await this.download(source);
      const resolvedMime =
        mime || downloaded.mime || "application/octet-stream";
      if (kind === "docimage" && !resolvedMime.startsWith("image/")) {
        throw new Error("The file is not an image.");
      }
      this.counter += 1;
      const key = `${FOLDERS[kind]}/qase_${sanitizeFileName(this.jobId)}_${Date.now()}_${this.counter}_${sanitizeFileName(fileName)}`;
      await this.upload(key, downloaded.body, resolvedMime);
      const copied: QaseCopiedFile = {
        url: withBasePath(`/api/storage/${key}`),
        size: downloaded.body.length,
        mime: resolvedMime,
      };
      this.done.set(cacheKey, copied);
      await this.onCopied?.(cacheKey, copied);
      return copied;
    } catch (error) {
      this.failed.set(
        cacheKey,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }
}
