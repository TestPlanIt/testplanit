import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextImage } from "./context-images";

const store = new Map<string, string>();
const fakeRedis = {
  set: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  del: vi.fn(async (key: string) => {
    store.delete(key);
  }),
};

vi.mock("~/lib/queues", () => ({
  getGenerateFromUrlQueue: vi.fn(() => ({
    client: Promise.resolve(fakeRedis),
  })),
}));

import {
  deleteContextImages,
  readContextImages,
  stashContextImages,
} from "./context-image-stash";
import { getGenerateFromUrlQueue } from "~/lib/queues";

const owner = { userId: "user-1", projectId: 7 };
const image: ContextImage = {
  id: "jira-attachment:1",
  source: "jira-attachment",
  filename: "shot.png",
  mimeType: "image/png",
  base64: "iVBORw0KGgo=",
  byteSize: 9,
};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.mocked(getGenerateFromUrlQueue).mockReturnValue({
    client: Promise.resolve(fakeRedis),
  } as never);
});

describe("context image stash", () => {
  it("round-trips for the owning user + project with a TTL", async () => {
    await stashContextImages("ctx-1", owner, [image]);

    expect(fakeRedis.set).toHaveBeenCalledWith(
      expect.stringContaining("genctx:images:"),
      expect.any(String),
      { EX: 1800 }
    );
    expect(await readContextImages("ctx-1", owner)).toEqual([image]);
  });

  it("returns null for a different user or project (owner binding)", async () => {
    await stashContextImages("ctx-1", owner, [image]);

    expect(
      await readContextImages("ctx-1", { userId: "someone-else", projectId: 7 })
    ).toBeNull();
    expect(
      await readContextImages("ctx-1", { userId: "user-1", projectId: 8 })
    ).toBeNull();
  });

  it("returns null for a missing or deleted stash", async () => {
    expect(await readContextImages("nope", owner)).toBeNull();

    await stashContextImages("ctx-1", owner, [image]);
    await deleteContextImages("ctx-1");
    expect(await readContextImages("ctx-1", owner)).toBeNull();
  });

  it("returns null on unparseable payloads", async () => {
    await stashContextImages("ctx-1", owner, [image]);
    const key = [...store.keys()][0];
    store.set(key, "{not json");
    expect(await readContextImages("ctx-1", owner)).toBeNull();
  });

  it("skips the write entirely for empty image lists", async () => {
    await stashContextImages("ctx-1", owner, []);
    expect(fakeRedis.set).not.toHaveBeenCalled();
  });

  it("fails soft when Valkey is unavailable", async () => {
    vi.mocked(getGenerateFromUrlQueue).mockReturnValue(null as never);

    await expect(
      stashContextImages("ctx-1", owner, [image])
    ).resolves.toBeUndefined();
    expect(await readContextImages("ctx-1", owner)).toBeNull();
    await expect(deleteContextImages("ctx-1")).resolves.toBeUndefined();
  });
});
