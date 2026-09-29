import { describe, expect, it } from "vitest";
import { injectUserFields } from "./injectUserFields";

describe("injectUserFields", () => {
  it("connects the actor as a milestone's creator", () => {
    // Milestones.createdBy is required; an API client that leaves the
    // creator out could never create a milestone.
    const body = injectUserFields(
      "milestones",
      "create",
      { data: { name: "M1" } },
      "user-1"
    );
    expect(body.data.creator).toEqual({ connect: { id: "user-1" } });
  });

  it("keeps a milestone creator given as the createdBy scalar", () => {
    const body = injectUserFields(
      "milestones",
      "create",
      { data: { name: "M1", createdBy: "user-2" } },
      "user-1"
    );
    expect(body.data.creator).toBeUndefined();
    expect(body.data.createdBy).toBe("user-2");
  });

  it("keeps a creator given through the relation", () => {
    const body = injectUserFields(
      "repositoryCases",
      "create",
      { data: { creator: { connect: { id: "user-2" } } } },
      "user-1"
    );
    expect(body.data.creator).toEqual({ connect: { id: "user-2" } });
  });

  it("fills the create branch of an upsert", () => {
    const body = injectUserFields(
      "sessions",
      "upsert",
      { where: { id: 1 }, create: { name: "S" }, update: {} },
      "user-1"
    );
    expect(body.create.createdBy).toEqual({ connect: { id: "user-1" } });
    expect(body.update).toEqual({});
  });

  it("leaves other operations and models untouched", () => {
    const update = { where: { id: 1 }, data: { name: "x" } };
    expect(injectUserFields("milestones", "update", update, "u")).toBe(update);
    const tag = { data: { name: "t" } };
    expect(injectUserFields("tags", "create", tag, "u")).toBe(tag);
  });
});
