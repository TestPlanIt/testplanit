export interface QaseEntityDefinition {
  /** Name stored in the staging table and shown in the progress list. */
  entity: string;
  /** Path under /v1; `{code}` is replaced with the project code. */
  path: string;
  /** False when the endpoint returns a plain array instead of pages. */
  paged?: boolean;
  query?: Record<string, string>;
  /** The record's property that identifies it in Qase. */
  idKey: string;
}

/** Records that belong to the workspace, fetched once per job. */
export const QASE_WORKSPACE_ENTITIES: QaseEntityDefinition[] = [
  { entity: "user", path: "user", idKey: "id" },
  { entity: "author", path: "author", idKey: "id" },
  { entity: "system_field", path: "system_field", paged: false, idKey: "slug" },
  { entity: "custom_field", path: "custom_field", idKey: "id" },
  { entity: "shared_parameter", path: "shared_parameter", idKey: "id" },
];

/** Records that belong to a project, fetched for every selected project. */
export const QASE_PROJECT_ENTITIES: QaseEntityDefinition[] = [
  { entity: "suite", path: "suite/{code}", idKey: "id" },
  { entity: "shared_step", path: "shared_step/{code}", idKey: "hash" },
  {
    entity: "case",
    path: "case/{code}",
    query: { include: "external_issues" },
    idKey: "id",
  },
  { entity: "milestone", path: "milestone/{code}", idKey: "id" },
  { entity: "environment", path: "environment/{code}", idKey: "id" },
  { entity: "configuration", path: "configuration/{code}", idKey: "id" },
  {
    entity: "run",
    path: "run/{code}",
    query: { include: "cases,defects,external_issue" },
    idKey: "id",
  },
  { entity: "result", path: "result/{code}", idKey: "hash" },
  { entity: "defect", path: "defect/{code}", idKey: "id" },
];

export const QASE_ENTITY_ORDER = [
  ...QASE_WORKSPACE_ENTITIES,
  ...QASE_PROJECT_ENTITIES,
].map((definition) => definition.entity);
