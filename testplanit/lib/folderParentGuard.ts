import { ORMError, ORMErrorReason } from "@zenstackhq/orm";

type FolderRow = {
  id: number;
  parentId: number | null;
  projectId: number;
  repositoryId: number;
  isDeleted: boolean;
};

/** The reads the guard needs, on a client without plugins. */
export type FolderReader = {
  repositoryFolders: {
    findUnique(args: {
      where: { id: number };
      select: {
        id: true;
        parentId: true;
        projectId: true;
        repositoryId: true;
        isDeleted: true;
      };
    }): Promise<FolderRow | null>;
  };
};

const FOLDER_SELECT = {
  id: true,
  parentId: true,
  projectId: true,
  repositoryId: true,
  isDeleted: true,
} as const;

// Deeper than any real tree; a chain longer than this is already a cycle.
const MAX_DEPTH = 1000;

const reject = (message: string): never => {
  const error = new ORMError(ORMErrorReason.INVALID_INPUT, message);
  error.model = "RepositoryFolders";
  throw error;
};

const idOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

/**
 * The parent a folder write asks for: a number, `null` for the root, or
 * `undefined` when the write leaves the parent alone.
 */
function requestedParent(
  data: Record<string, unknown>
): number | null | undefined {
  if ("parentId" in data) {
    return data.parentId === null ? null : idOf(data.parentId);
  }
  const parent = data.parent as
    { connect?: { id?: unknown }; disconnect?: unknown } | undefined;
  if (parent?.disconnect) return null;
  return idOf(parent?.connect?.id);
}

function scopeOf(
  data: Record<string, unknown>,
  scalar: "projectId",
  relation: "project"
): number | undefined {
  return (
    idOf(data[scalar]) ??
    idOf((data[relation] as { connect?: { id?: unknown } })?.connect?.id)
  );
}

/**
 * Reject a folder create or move whose parent would corrupt the tree: a
 * parent that is missing or deleted, in another project, or the folder itself
 * or one of its descendants. A cycle hangs every recursive folder query and
 * the search indexer's folder-path walk.
 *
 * The parent's repository is deliberately not compared. A project can have
 * several active Repositories rows, the folder tree is scoped by project
 * alone, and the repository page creates folders under whichever row it finds
 * first — so a project's folders already span repositories, and requiring a
 * match rejected ordinary nested creates and moves.
 */
export async function assertValidFolderParent(
  model: string,
  operation: string,
  args: unknown,
  reader: FolderReader
): Promise<void> {
  if (model !== "RepositoryFolders") return;
  if (operation !== "create" && operation !== "update") return;
  const payload = args as {
    where?: { id?: unknown };
    data?: Record<string, unknown>;
  };
  const data = payload?.data;
  if (!data || typeof data !== "object") return;

  const parentId = requestedParent(data);
  if (parentId == null) return;

  let folderId: number | undefined;
  let projectId: number | undefined;
  if (operation === "create") {
    projectId = scopeOf(data, "projectId", "project");
  } else {
    folderId = idOf(payload.where?.id);
    if (folderId === undefined) return;
    const folder = await reader.repositoryFolders.findUnique({
      where: { id: folderId },
      select: FOLDER_SELECT,
    });
    if (!folder) return;
    projectId = folder.projectId;
  }

  const parent = await reader.repositoryFolders.findUnique({
    where: { id: parentId },
    select: FOLDER_SELECT,
  });
  if (!parent || parent.isDeleted) {
    reject(`Parent folder ${parentId} does not exist.`);
  }
  if (projectId !== undefined && parent!.projectId !== projectId) {
    reject(`Parent folder ${parentId} belongs to another project.`);
  }

  if (folderId === undefined) return;
  let current: FolderRow | null = parent!;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current.id === folderId) {
      reject("A folder cannot be moved into itself or one of its subfolders.");
    }
    if (current.parentId == null) return;
    current = await reader.repositoryFolders.findUnique({
      where: { id: current.parentId },
      select: FOLDER_SELECT,
    });
  }
  if (current) reject("The folder tree above the new parent is too deep.");
}
