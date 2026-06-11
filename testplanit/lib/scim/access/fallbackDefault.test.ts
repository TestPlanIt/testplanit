import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SCIM_DEFAULT_MAPPED_ACCESS_KEY,
  readScimFallbackDefault,
} from "./fallbackDefault";

const makeClient = (findUniqueResult: unknown) => ({
  appConfig: {
    findUnique: vi.fn().mockResolvedValue(findUniqueResult),
  },
});

describe("SCIM_DEFAULT_MAPPED_ACCESS_KEY", () => {
  it("is the expected dot-namespaced key", () => {
    expect(SCIM_DEFAULT_MAPPED_ACCESS_KEY).toBe("scim.defaultMappedAccess");
  });
});

describe("readScimFallbackDefault", () => {
  it("returns NONE when the AppConfig row is absent", async () => {
    const client = makeClient(null);
    const result = await readScimFallbackDefault(client);
    expect(result).toBe("NONE");
  });

  it("returns ADMIN when the row value is 'ADMIN'", async () => {
    const client = makeClient({ value: "ADMIN" });
    const result = await readScimFallbackDefault(client);
    expect(result).toBe("ADMIN");
  });

  it("returns USER when the row value is 'USER'", async () => {
    const client = makeClient({ value: "USER" });
    const result = await readScimFallbackDefault(client);
    expect(result).toBe("USER");
  });

  it("returns PROJECTADMIN when the row value is 'PROJECTADMIN'", async () => {
    const client = makeClient({ value: "PROJECTADMIN" });
    const result = await readScimFallbackDefault(client);
    expect(result).toBe("PROJECTADMIN");
  });

  it("returns NONE when the row value is an unknown string", async () => {
    const client = makeClient({ value: "SUPERUSER" });
    const result = await readScimFallbackDefault(client);
    expect(result).toBe("NONE");
  });

  it("returns NONE when the row value is a non-string (number)", async () => {
    const client = makeClient({ value: 42 });
    const result = await readScimFallbackDefault(client);
    expect(result).toBe("NONE");
  });

  it("calls appConfig.findUnique with the correct key and select", async () => {
    const client = makeClient(null);
    await readScimFallbackDefault(client);
    expect(client.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: SCIM_DEFAULT_MAPPED_ACCESS_KEY },
      select: { value: true },
    });
  });
});
