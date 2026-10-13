import { describe, expect, it } from "vitest";

import { schema } from "~/zenstack/schema";

import {
  requestHardDeletesIssue,
  resolveModelName,
} from "./issueHardDeleteGuard";

/**
 * These cases are written against the SHAPES the ZenStack RPC handler
 * accepts, not against the guard's internals — each `requestBody` below is a
 * payload `RPCApiHandler.handleRequest` would forward verbatim to
 * `client[model][op](args)`.
 */
describe("requestHardDeletesIssue", () => {
  describe("the per-model delete path", () => {
    it("condemns issue/delete and issue/deleteMany", () => {
      for (const operation of ["delete", "deleteMany"]) {
        expect(
          requestHardDeletesIssue({
            model: "issue",
            operation,
            // `delete` carries its `where` in `?q=`, so the body is null.
            requestBody: null,
          })
        ).toBe(true);
      }
    });

    it("condemns the PascalCase spelling of the model too", () => {
      expect(
        requestHardDeletesIssue({
          model: "Issue",
          operation: "delete",
          requestBody: null,
        })
      ).toBe(true);
    });

    it("allows the soft delete the product actually performs", () => {
      expect(
        requestHardDeletesIssue({
          model: "issue",
          operation: "update",
          requestBody: { where: { id: 1 }, data: { isDeleted: true } },
        })
      ).toBe(false);
    });

    it("allows every non-delete operation on issue", () => {
      for (const operation of ["create", "update", "updateMany", "upsert"]) {
        expect(
          requestHardDeletesIssue({
            model: "issue",
            operation,
            requestBody: { where: { id: 1 }, data: { title: "x" } },
          })
        ).toBe(false);
      }
    });

    it("leaves deletes of other models alone", () => {
      for (const model of [
        "repositoryCases",
        "testRuns",
        "milestoneIssue",
        "repositoryCaseIssue",
      ]) {
        expect(
          requestHardDeletesIssue({
            model,
            operation: "delete",
            requestBody: null,
          })
        ).toBe(false);
      }
    });

    it("ignores an unknown model name instead of throwing", () => {
      expect(
        requestHardDeletesIssue({
          model: "notAModel",
          operation: "delete",
          requestBody: { data: { anything: { deleteMany: {} } } },
        })
      ).toBe(false);
    });
  });

  describe("the $transaction route", () => {
    it("condemns an Issue delete buried in a sequential transaction", () => {
      expect(
        requestHardDeletesIssue({
          model: "$transaction",
          operation: "sequential",
          requestBody: [
            {
              model: "RepositoryCases",
              op: "update",
              args: { where: { id: 1 } },
            },
            { model: "Issue", op: "delete", args: { where: { id: 42 } } },
          ],
        })
      ).toBe(true);
    });

    it("condemns it under the lower-first spelling as well", () => {
      expect(
        requestHardDeletesIssue({
          model: "$transaction",
          operation: "sequential",
          requestBody: [{ model: "issue", op: "deleteMany", args: {} }],
        })
      ).toBe(true);
    });

    it("condemns a nested Issue delete inside a transaction operation's args", () => {
      expect(
        requestHardDeletesIssue({
          model: "$transaction",
          operation: "sequential",
          requestBody: [
            {
              model: "Projects",
              op: "update",
              args: { where: { id: 1 }, data: { issues: { deleteMany: {} } } },
            },
          ],
        })
      ).toBe(true);
    });

    it("allows a transaction that only creates and updates", () => {
      expect(
        requestHardDeletesIssue({
          model: "$transaction",
          operation: "sequential",
          requestBody: [
            {
              model: "Issue",
              op: "update",
              args: { where: { id: 1 }, data: {} },
            },
            { model: "Issue", op: "create", args: { data: { title: "t" } } },
          ],
        })
      ).toBe(false);
    });

    it("ignores a malformed transaction body", () => {
      expect(
        requestHardDeletesIssue({
          model: "$transaction",
          operation: "sequential",
          requestBody: { not: "an array" },
        })
      ).toBe(false);
    });
  });

  describe("nested relation deletes", () => {
    it("condemns a to-many Issue delete under another model's update", () => {
      expect(
        requestHardDeletesIssue({
          model: "projects",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: { issues: { deleteMany: {} } },
          },
        })
      ).toBe(true);
    });

    it("condemns a to-one Issue delete under a join row's update", () => {
      expect(
        requestHardDeletesIssue({
          model: "milestoneIssue",
          operation: "update",
          requestBody: {
            where: { milestoneId_issueId: { milestoneId: 1, issueId: 2 } },
            data: { issue: { delete: true } },
          },
        })
      ).toBe(true);
    });

    it("condemns a child-subtree delete written through Issue's own self-relation", () => {
      expect(
        requestHardDeletesIssue({
          model: "issue",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: { children: { deleteMany: {} } },
          },
        })
      ).toBe(true);
    });

    it("condemns an Issue delete reached through a chain of nested writes", () => {
      expect(
        requestHardDeletesIssue({
          model: "projects",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: {
              milestones: {
                update: {
                  where: { id: 2 },
                  data: {
                    milestoneIssues: {
                      update: {
                        where: {
                          milestoneId_issueId: { milestoneId: 2, issueId: 3 },
                        },
                        data: { issue: { delete: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        })
      ).toBe(true);
    });

    it("condemns an Issue delete inside an upsert branch", () => {
      expect(
        requestHardDeletesIssue({
          model: "projects",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: {
              milestones: {
                upsert: {
                  where: { id: 2 },
                  create: { name: "m" },
                  update: {
                    milestoneIssues: {
                      update: { data: { issue: { delete: true } } },
                    },
                  },
                },
              },
            },
          },
        })
      ).toBe(true);
    });

    it("allows deleting the JOIN rows that merely reference an issue", () => {
      expect(
        requestHardDeletesIssue({
          model: "issue",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: {
              caseIssues: { deleteMany: {} },
              milestoneIssues: { deleteMany: {} },
            },
          },
        })
      ).toBe(false);
    });

    it("allows disconnecting an issue relation", () => {
      expect(
        requestHardDeletesIssue({
          model: "projects",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: { issues: { disconnect: [{ id: 2 }], set: [] } },
          },
        })
      ).toBe(false);
    });

    it("treats delete: false as the no-op the ORM treats it as", () => {
      expect(
        requestHardDeletesIssue({
          model: "milestoneIssue",
          operation: "update",
          requestBody: {
            where: { milestoneId_issueId: { milestoneId: 1, issueId: 2 } },
            data: { issue: { delete: false } },
          },
        })
      ).toBe(false);
    });

    it("does not read a `where` clause as a write", () => {
      expect(
        requestHardDeletesIssue({
          model: "projects",
          operation: "update",
          requestBody: {
            where: { issues: { some: { id: 2 } } },
            data: { name: "n" },
          },
        })
      ).toBe(false);
    });

    it("survives a payload nested past the walk's depth cap without throwing", () => {
      let payload: any = { issues: { deleteMany: {} } };
      for (let i = 0; i < 60; i++) {
        payload = {
          milestones: { update: { where: { id: i }, data: payload } },
        };
      }
      expect(() =>
        requestHardDeletesIssue({
          model: "projects",
          operation: "update",
          requestBody: { where: { id: 1 }, data: payload },
        })
      ).not.toThrow();
    });

    it("does not refuse a same-named relation that points somewhere else", () => {
      // `children` is a self-relation on RepositoryFolders too. A guard that
      // matched relation field NAMES rather than their target model would
      // refuse this legitimate folder-subtree delete.
      expect(
        requestHardDeletesIssue({
          model: "repositoryFolders",
          operation: "update",
          requestBody: {
            where: { id: 1 },
            data: { children: { deleteMany: {} } },
          },
        })
      ).toBe(false);
    });
  });

  describe("schema coupling", () => {
    it("resolves both the RPC accessor and the PascalCase model name", () => {
      expect(resolveModelName("issue")).toBe("Issue");
      expect(resolveModelName("Issue")).toBe("Issue");
      expect(resolveModelName("repositoryCases")).toBe("RepositoryCases");
      expect(resolveModelName("nope")).toBeNull();
    });

    it("covers every relation in the schema that points at Issue", () => {
      const models = schema.models as unknown as Record<
        string,
        { fields: Record<string, { type?: string; relation?: unknown }> }
      >;
      const issueRelations: Array<[string, string]> = [];
      for (const [modelName, def] of Object.entries(models)) {
        for (const [fieldName, field] of Object.entries(def.fields)) {
          if (field?.relation && field.type === "Issue") {
            issueRelations.push([modelName, fieldName]);
          }
        }
      }
      // Guards against a relation being added later with no coverage here.
      expect(issueRelations.length).toBeGreaterThan(0);
      for (const [modelName, fieldName] of issueRelations) {
        expect(
          requestHardDeletesIssue({
            model: modelName,
            operation: "update",
            requestBody: {
              where: { id: 1 },
              data: { [fieldName]: { deleteMany: {} } },
            },
          }),
          `${modelName}.${fieldName} nested delete must be refused`
        ).toBe(true);
      }
    });
  });
});
