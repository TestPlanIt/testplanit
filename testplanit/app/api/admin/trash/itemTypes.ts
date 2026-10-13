import { schema } from "~/zenstack/schema";

// The Trash item type for `Issue` predates this registry and is exposed as
// "Issues" in the URL, the UI and the E2E suite. Every other model is exposed
// under its schema name.
const itemTypeAliases: Record<string, string> = { Issue: "Issues" };

export interface TrashItemType {
  // Public name used in /api/admin/trash/[itemType] and the Trash UI.
  itemType: string;
  // Schema model name (audit entityType).
  modelName: string;
  // Client delegate name, e.g. `db.testRunCases`.
  delegate: string;
  idType: "Int" | "String";
  // Column used for the search box, if the model has one.
  searchField: string | null;
}

interface ModelDef {
  name: string;
  fields: Record<string, { type: string; array?: boolean; relation?: unknown }>;
}

const searchFieldCandidates = [
  "name",
  "displayName",
  "templateName",
  "title",
  "label",
];

// Every model that carries the soft-delete pair is a Trash item type. Deriving
// the list from the schema means a new soft-deletable model shows up in the API
// automatically; the UI list is checked against this in a unit test.
export const trashItemTypes: TrashItemType[] = Object.values(
  schema.models as unknown as Record<string, ModelDef>
)
  .filter((model) => model.fields.isDeleted && model.fields.deletedAt)
  .map((model): TrashItemType => {
    const idField = model.fields.id;
    const searchField =
      searchFieldCandidates.find(
        (field) => model.fields[field]?.type === "String"
      ) ?? null;
    return {
      itemType: itemTypeAliases[model.name] ?? model.name,
      modelName: model.name,
      delegate: model.name.charAt(0).toLowerCase() + model.name.slice(1),
      idType: idField?.type === "String" ? "String" : "Int",
      searchField,
    };
  })
  .sort((a, b) => a.itemType.localeCompare(b.itemType));

export const trashItemTypeByName: Record<string, TrashItemType> =
  Object.fromEntries(trashItemTypes.map((entry) => [entry.itemType, entry]));
