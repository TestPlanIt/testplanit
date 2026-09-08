/**
 * Short-lived Redis stash for generation context images.
 *
 * The two-phase wizard flow (outline → N parallel expand calls) must not
 * re-download issue attachments per expand call, and the base64 payloads are
 * far too large to round-trip through the client. The outline route fetches
 * bytes once, stashes them here under a fresh contextId, and each expand
 * call reads them back server-side.
 *
 * Owner binding: the stash key alone is a capability, so reads verify the
 * requesting user + project match the values recorded at stash time — a
 * leaked/guessed contextId from another user or project returns null.
 *
 * TTL is 30 minutes: wizard-session scale, deliberately much shorter than
 * the 7-day crawl-pages TTL because payloads are megabytes, not markdown.
 * Mirrors the `generate-from-url:pages:${jobId}` pattern (same Redis client
 * via the BullMQ queue connection).
 */

import { getGenerateFromUrlQueue } from "~/lib/queues";
import { currentTenantScope } from "~/lib/tenantContext";
import type { ContextImage } from "./context-images";

export interface ContextImageStashOwner {
  userId: string;
  projectId: number;
}

interface StashEnvelope {
  owner: ContextImageStashOwner;
  images: ContextImage[];
}

const STASH_TTL_SECONDS = 30 * 60;

/** Tenant-scoped key so shared multi-tenant workers can never cross streams. */
function stashKey(contextId: string): string {
  return `genctx:images:${currentTenantScope()}:${contextId}`;
}

/**
 * Null when Valkey is unavailable (the queue getter warns once). Callers
 * fail soft: no stash means expand generates text-only, mirroring how a
 * missing/expired stash is handled.
 */
async function redisClient() {
  const queue = getGenerateFromUrlQueue();
  if (!queue) return null;
  return await queue.client;
}

export async function stashContextImages(
  contextId: string,
  owner: ContextImageStashOwner,
  images: ContextImage[]
): Promise<void> {
  if (images.length === 0) return;
  const client = await redisClient();
  if (!client) return;
  const envelope: StashEnvelope = { owner, images };
  await client.set(stashKey(contextId), JSON.stringify(envelope), {
    EX: STASH_TTL_SECONDS,
  });
}

/**
 * Read the stash for this owner. Returns null when the stash is missing,
 * expired, unparseable, or owned by a different user/project — callers
 * treat all of those identically (generate text-only, no error).
 */
export async function readContextImages(
  contextId: string,
  owner: ContextImageStashOwner
): Promise<ContextImage[] | null> {
  const client = await redisClient();
  if (!client) return null;
  const raw = await client.get(stashKey(contextId));
  if (!raw) return null;

  let envelope: StashEnvelope;
  try {
    envelope = JSON.parse(raw) as StashEnvelope;
  } catch {
    return null;
  }

  if (
    envelope.owner?.userId !== owner.userId ||
    envelope.owner?.projectId !== owner.projectId
  ) {
    return null;
  }

  return envelope.images ?? null;
}

export async function deleteContextImages(contextId: string): Promise<void> {
  const client = await redisClient();
  if (!client) return;
  await client.del(stashKey(contextId));
}
