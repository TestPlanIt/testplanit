import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFoldersList, type FoldersListDeps } from "./list.js";
import { registerFoldersGet, type FoldersGetDeps } from "./get.js";
import { registerFoldersCreate, type FoldersCreateDeps } from "./create.js";
import { registerFoldersUpdate, type FoldersUpdateDeps } from "./update.js";
import { registerFoldersDelete, type FoldersDeleteDeps } from "./delete.js";

export type FoldersDeps =
  & FoldersListDeps
  & FoldersGetDeps
  & FoldersCreateDeps
  & FoldersUpdateDeps
  & FoldersDeleteDeps;

export function registerFolders(server: McpServer, deps: FoldersDeps): void {
  registerFoldersList(server, deps);
  registerFoldersGet(server, deps);
  registerFoldersCreate(server, deps);
  registerFoldersUpdate(server, deps);
  registerFoldersDelete(server, deps);
}

export {
  registerFoldersList,
  registerFoldersGet,
  registerFoldersCreate,
  registerFoldersUpdate,
  registerFoldersDelete,
};
export type {
  FoldersListDeps,
  FoldersGetDeps,
  FoldersCreateDeps,
  FoldersUpdateDeps,
  FoldersDeleteDeps,
};
