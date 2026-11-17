import type { TxClient } from "~/lib/zenstack";

/** Which setting chose the default: the project's own, or the system-wide one. */
export type DefaultTemplateSource = "project" | "system";

export interface DefaultTemplateCandidate {
  id: number;
  isDefault: boolean;
}

export interface ResolvedDefaultTemplate<T> {
  template: T | undefined;
  /** Null when neither default applies and the first template was taken. */
  source: DefaultTemplateSource | null;
}

/**
 * Picks the template a new case or session in a project starts with.
 * `templates` must already be the project's usable templates (enabled, not
 * deleted, assigned to the project). The project default wins when it is
 * among them, then the system default, then the first template.
 */
export function resolveDefaultTemplate<T extends DefaultTemplateCandidate>(
  templates: readonly T[] | null | undefined,
  projectDefaultTemplateId: number | null | undefined
): ResolvedDefaultTemplate<T> {
  if (!templates || templates.length === 0) {
    return { template: undefined, source: null };
  }
  if (projectDefaultTemplateId != null) {
    const projectDefault = templates.find(
      (template) => template.id === projectDefaultTemplateId
    );
    if (projectDefault) return { template: projectDefault, source: "project" };
  }
  const systemDefault = templates.find((template) => template.isDefault);
  if (systemDefault) return { template: systemDefault, source: "system" };
  return { template: templates[0], source: null };
}

/**
 * Server-side lookup of the template id `resolveDefaultTemplate` picks for a
 * project, with the first template taken by id. Null when the project has no
 * usable template.
 */
export async function findProjectDefaultTemplateId(
  client: Pick<TxClient, "projects" | "templates">,
  projectId: number
): Promise<number | null> {
  const [project, templates] = await Promise.all([
    client.projects.findUnique({
      where: { id: projectId },
      select: { defaultTemplateId: true },
    }),
    client.templates.findMany({
      where: {
        isDeleted: false,
        isEnabled: true,
        projects: { some: { projectId } },
      },
      select: { id: true, isDefault: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return (
    resolveDefaultTemplate(templates, project?.defaultTemplateId).template
      ?.id ?? null
  );
}
