import { baseDb } from "@/lib/db";
import type { TemplateData } from "./shared";

type GuidanceReader = {
  caseFields: {
    findMany(args: {
      where: {
        id: { in: number[] };
        isDeleted: false;
        generationGuidance: { not: null };
      };
      select: { id: true; generationGuidance: true };
    }): Promise<Array<{ id: number; generationGuidance: string | null }>>;
  };
};

/**
 * The template with each field's generation guidance read from the database.
 *
 * Templates reach the generation routes from the browser, and guidance is
 * printed into the prompt, so it is never taken from the request: whatever a
 * caller put in `guidance` is dropped and replaced with what an administrator
 * saved on the field.
 */
export async function withFieldGuidance(
  template: TemplateData,
  db: GuidanceReader = baseDb as unknown as GuidanceReader
): Promise<TemplateData> {
  if (!Array.isArray(template?.fields)) return template;
  const fields = template.fields.map(({ guidance: _sent, ...field }) => field);
  const ids = Array.from(
    new Set(fields.map((f) => f.id).filter((id) => Number.isInteger(id)))
  );
  if (ids.length === 0) return { ...template, fields };

  const rows = await db.caseFields.findMany({
    where: {
      id: { in: ids },
      isDeleted: false,
      generationGuidance: { not: null },
    },
    select: { id: true, generationGuidance: true },
  });
  const byId = new Map(
    rows
      .map((row) => [row.id, row.generationGuidance?.trim() ?? ""] as const)
      .filter(([, text]) => text.length > 0)
  );

  return {
    ...template,
    fields: fields.map((field) => {
      const guidance = byId.get(field.id);
      return guidance ? { ...field, guidance } : field;
    }),
  };
}
