import { describe, expect, it, vi } from "vitest";
import { createFormSchema } from "./CodeRepositoryModal";

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: vi.fn(),
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const t = (key: string) => key;
const base = { provider: "GITHUB" as const };

describe("CodeRepositoryModal createFormSchema", () => {
  it("rejects a name a live repository already uses, ignoring case and padding", () => {
    const schema = createFormSchema(t, ["Payments API"]);
    for (const name of ["Payments API", "payments api", "  Payments API "]) {
      const parsed = schema.safeParse({ ...base, name });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({
        path: ["name"],
        message: "validation.nameUnique",
      });
    }
  });

  it("accepts a name no live repository uses and trims it", () => {
    const parsed = createFormSchema(t, ["Payments API"]).safeParse({
      ...base,
      name: " Billing API ",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("Billing API");
  });

  it("requires a name", () => {
    const parsed = createFormSchema(t, []).safeParse({ ...base, name: "  " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("validation.nameRequired");
  });
});
