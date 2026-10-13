/**
 * The user relation each model's create fills from the authenticated actor
 * when the request leaves it out, and the scalar foreign key behind it.
 * Clients that set either one keep their value.
 */
export const AUTO_INJECT_USER_FIELDS: Record<
  string,
  Array<{ relation: string; scalar: string }>
> = {
  testRuns: [{ relation: "createdBy", scalar: "createdById" }],
  testRunResults: [{ relation: "executedBy", scalar: "executedById" }],
  sessionResults: [{ relation: "createdBy", scalar: "createdById" }],
  repositoryCases: [{ relation: "creator", scalar: "creatorId" }],
  repositoryFolders: [{ relation: "creator", scalar: "creatorId" }],
  sessions: [{ relation: "createdBy", scalar: "createdById" }],
  milestones: [{ relation: "creator", scalar: "createdBy" }],
  attachments: [{ relation: "createdBy", scalar: "createdById" }],
  jUnitTestSuite: [{ relation: "createdBy", scalar: "createdById" }],
  jUnitTestResult: [{ relation: "createdBy", scalar: "createdById" }],
  issue: [{ relation: "createdBy", scalar: "createdById" }],
};

/** Fill the actor into a create / upsert body; returns a new body. */
export function injectUserFields(
  model: string,
  operation: string,
  body: any,
  userId: string
): any {
  const fieldsToInject = AUTO_INJECT_USER_FIELDS[model];
  if (!fieldsToInject || fieldsToInject.length === 0) return body;
  if (operation !== "create" && operation !== "upsert") return body;

  const newBody = JSON.parse(JSON.stringify(body));
  const dataToModify = operation === "create" ? newBody.data : newBody.create;

  if (dataToModify) {
    for (const { relation, scalar } of fieldsToInject) {
      if (!dataToModify[relation] && !dataToModify[scalar]) {
        dataToModify[relation] = { connect: { id: userId } };
      }
    }
  }

  return newBody;
}
