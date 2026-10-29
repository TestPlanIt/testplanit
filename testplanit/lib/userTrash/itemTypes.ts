import type { ApplicationArea } from "~/zenstack/models";

/**
 * AppConfig key: how many days a user may restore their own deletes from the
 * Trash section of their profile. Missing row → USER_TRASH_WINDOW_DAYS_DEFAULT;
 * `0` turns self-service restore off. Admin > Trash ignores it entirely.
 */
export const USER_TRASH_WINDOW_DAYS_KEY = "user_trash_restore_window_days";
export const USER_TRASH_WINDOW_DAYS_DEFAULT = 30;

/**
 * A soft-deleted child table restored together with its owner when a user
 * restores an item from their Trash. `fk` is the child's column pointing at the
 * owner; `children` nests further owned tables (results under run cases, …).
 * `self: true` marks a self-referencing tree (folders, milestones) that is
 * walked to the leaves.
 */
export interface UserTrashChild {
  delegate: string;
  fk: string;
  self?: boolean;
  children?: UserTrashChild[];
}

/**
 * How an item reaches its project. Most types carry `projectId`; attachments
 * only hang off a parent (case, run, session, issue, …) and inherit its
 * project — and its area for the permission check.
 */
export type UserTrashProjectSource =
  | { kind: "own" }
  | {
      kind: "parent";
      parents: {
        fk: string;
        delegate: string;
        area: ApplicationArea;
        /** Name column on the project-bearing row (the `projectVia` row when set). */
        nameField: "name" | "title";
        /** Set when the parent has no projectId of its own (a result → its run). */
        projectVia?: { fk: string; delegate: string };
      }[];
    };

export interface UserTrashItemType {
  /** Public item type — the same name Admin > Trash uses (`Issues` for `Issue`). */
  itemType: string;
  modelName: string;
  delegate: string;
  /** Permission area whose `canAddEdit` the user must still hold to restore. */
  area: ApplicationArea;
  nameField: "name" | "title";
  project: UserTrashProjectSource;
  /**
   * The item's container, which must itself be live for the item to show or
   * restore (a case in a deleted folder is restored with the folder, not alone).
   */
  parent?: { fk: string; delegate: string; nameField: "name" | "title" };
  children: UserTrashChild[];
}

const caseChildren: UserTrashChild[] = [
  { delegate: "steps", fk: "testCaseId" },
  { delegate: "attachments", fk: "testCaseId" },
];

const runCaseChildren: UserTrashChild[] = [
  {
    delegate: "testRunResults",
    fk: "testRunCaseId",
    children: [
      { delegate: "testRunStepResults", fk: "testRunResultId" },
      { delegate: "attachments", fk: "testRunResultsId" },
    ],
  },
  { delegate: "testRunCaseIteration", fk: "testRunCaseId" },
  { delegate: "testRunCaseDataSetSnapshot", fk: "testRunCaseId" },
];

/**
 * Item types a user may restore from their own Trash. Every entry names a
 * project-scoped content type with a human-readable name — the user Trash never
 * shows a raw id, so types without a name (comments, snapshots, join rows) and
 * admin-scoped catalog types stay Admin > Trash only. A unit test checks each
 * entry against the schema-derived Admin > Trash registry.
 */
/**
 * Folder deletion appends `_deleted_<timestamp>` to the name so the original
 * stays free under the folder unique index. The trash shows and restores the
 * original name; these are the delegates whose rows carry that suffix.
 */
export const RENAMED_ON_DELETE_DELEGATES = new Set(["repositoryFolders"]);
export const DELETED_NAME_SUFFIX = /_deleted_\d+$/;

export function originalName(name: string): string {
  return name.replace(DELETED_NAME_SUFFIX, "");
}

export const userTrashItemTypes: UserTrashItemType[] = [
  {
    itemType: "RepositoryFolders",
    modelName: "RepositoryFolders",
    delegate: "repositoryFolders",
    area: "TestCaseRepository",
    nameField: "name",
    project: { kind: "own" },
    parent: {
      fk: "parentId",
      delegate: "repositoryFolders",
      nameField: "name",
    },
    children: [
      { delegate: "repositoryFolders", fk: "parentId", self: true },
      { delegate: "repositoryCases", fk: "folderId", children: caseChildren },
    ],
  },
  {
    itemType: "RepositoryCases",
    modelName: "RepositoryCases",
    delegate: "repositoryCases",
    area: "TestCaseRepository",
    nameField: "name",
    project: { kind: "own" },
    parent: {
      fk: "folderId",
      delegate: "repositoryFolders",
      nameField: "name",
    },
    children: caseChildren,
  },
  {
    itemType: "SharedStepGroup",
    modelName: "SharedStepGroup",
    delegate: "sharedStepGroup",
    area: "SharedSteps",
    nameField: "name",
    project: { kind: "own" },
    children: [],
  },
  {
    itemType: "TestRuns",
    modelName: "TestRuns",
    delegate: "testRuns",
    area: "TestRuns",
    nameField: "name",
    project: { kind: "own" },
    children: [
      { delegate: "testRunCases", fk: "testRunId", children: runCaseChildren },
      { delegate: "attachments", fk: "testRunsId" },
    ],
  },
  {
    itemType: "Sessions",
    modelName: "Sessions",
    delegate: "sessions",
    area: "Sessions",
    nameField: "name",
    project: { kind: "own" },
    children: [
      {
        delegate: "sessionResults",
        fk: "sessionId",
        children: [{ delegate: "attachments", fk: "sessionResultsId" }],
      },
      { delegate: "attachments", fk: "sessionId" },
    ],
  },
  {
    itemType: "Milestones",
    modelName: "Milestones",
    delegate: "milestones",
    area: "Milestones",
    nameField: "name",
    project: { kind: "own" },
    parent: { fk: "parentId", delegate: "milestones", nameField: "name" },
    children: [{ delegate: "milestones", fk: "parentId", self: true }],
  },
  {
    itemType: "Issues",
    modelName: "Issue",
    delegate: "issue",
    area: "Issues",
    nameField: "title",
    project: { kind: "own" },
    children: [{ delegate: "attachments", fk: "issueId" }],
  },
  {
    itemType: "DataSet",
    modelName: "DataSet",
    delegate: "dataSet",
    area: "TestCaseRepository",
    nameField: "name",
    project: { kind: "own" },
    children: [{ delegate: "dataSetRow", fk: "dataSetId" }],
  },
  {
    itemType: "Attachments",
    modelName: "Attachments",
    delegate: "attachments",
    area: "TestCaseRepository",
    nameField: "name",
    project: {
      kind: "parent",
      parents: [
        {
          fk: "testCaseId",
          delegate: "repositoryCases",
          area: "TestCaseRepository",
          nameField: "name",
        },
        {
          fk: "testRunsId",
          delegate: "testRuns",
          area: "TestRuns",
          nameField: "name",
        },
        {
          fk: "sessionId",
          delegate: "sessions",
          area: "Sessions",
          nameField: "name",
        },
        {
          fk: "issueId",
          delegate: "issue",
          area: "Issues",
          nameField: "title",
        },
        {
          fk: "testRunResultsId",
          delegate: "testRunResults",
          area: "TestRunResults",
          nameField: "name",
          projectVia: { fk: "testRunId", delegate: "testRuns" },
        },
        {
          fk: "sessionResultsId",
          delegate: "sessionResults",
          area: "SessionResults",
          nameField: "name",
          projectVia: { fk: "sessionId", delegate: "sessions" },
        },
      ],
    },
    children: [],
  },
];

/** One row of a user's Trash as the API returns it — names only, no raw ids beyond the restore handle. */
export interface UserTrashItem {
  itemType: string;
  id: string;
  name: string;
  projectId: number;
  projectName: string;
  /** The container's name (folder, run, parent milestone…) when there is one. */
  context: string | null;
  deletedAt: string;
  restorableUntil: string;
}

export const userTrashItemTypeByName: Record<string, UserTrashItemType> =
  Object.fromEntries(
    userTrashItemTypes.map((entry) => [entry.itemType, entry])
  );
