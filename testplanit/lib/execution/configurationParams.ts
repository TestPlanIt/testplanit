import {
  configurationInputKeys,
  MULTISELECT_SEPARATOR,
  parseConfigurationIds,
} from "./params";
import type { ExecutionParam } from "./types";

/**
 * Configuration parameters at execute time.
 *
 * A configuration parameter is chosen as ids (`<name>_ID`). Before the
 * execution row is written, the ids are checked against the configurations
 * assigned to the project and expanded into the inputs the job receives:
 *
 * - `<name>_ID`       `12` or `12,15`
 * - `<name>`          the configuration name(s), comma-separated
 * - `<name>_VARIANTS` `Browser=Chrome,OS=Windows 11`; several
 *                     configurations are separated by `;`
 *
 * The derived keys are always written by the server: a caller cannot send a
 * name the id does not belong to.
 */

const CONFIGURATION_SEPARATOR = ";";
const VARIANT_SEPARATOR = "=";

export interface ResolvedConfiguration {
  id: number;
  name: string;
  /** `[category, variant]` pairs, sorted by category then variant. */
  variants: [string, string][];
}

/** The read the resolver needs; narrowed so tests can hand in a stub. */
export interface ConfigurationReader {
  configurations: {
    findMany(args: {
      where: {
        id: { in: number[] };
        isDeleted: boolean;
        isEnabled: boolean;
        projects: { some: { projectId: number } };
      };
      select: {
        id: true;
        name: true;
        variants: {
          select: {
            variant: {
              select: { name: true; category: { select: { name: true } } };
            };
          };
        };
      };
    }): Promise<
      {
        id: number;
        name: string;
        variants: { variant: { name: string; category: { name: string } } }[];
      }[]
    >;
  };
}

/** Configurations assigned to the project, enabled and live, by id. */
export async function findAssignedConfigurations(
  db: ConfigurationReader,
  projectId: number,
  ids: number[]
): Promise<Map<number, ResolvedConfiguration>> {
  if (ids.length === 0) return new Map();
  const rows = await db.configurations.findMany({
    where: {
      id: { in: ids },
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId } },
    },
    select: {
      id: true,
      name: true,
      variants: {
        select: {
          variant: {
            select: { name: true, category: { select: { name: true } } },
          },
        },
      },
    },
  });
  const out = new Map<number, ResolvedConfiguration>();
  for (const row of rows) {
    const variants = row.variants
      .map((v): [string, string] => [v.variant.category.name, v.variant.name])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    out.set(row.id, { id: row.id, name: row.name, variants });
  }
  return out;
}

/** The three inputs one configuration parameter becomes. */
export function formatConfigurationInputs(
  name: string,
  chosen: ResolvedConfiguration[]
): Record<string, string> {
  const keys = configurationInputKeys(name);
  return {
    [keys.id]: chosen.map((c) => String(c.id)).join(MULTISELECT_SEPARATOR),
    [keys.name]: chosen.map((c) => c.name).join(MULTISELECT_SEPARATOR),
    [keys.variants]: chosen
      .map((c) =>
        c.variants
          .map(
            ([category, variant]) => `${category}${VARIANT_SEPARATOR}${variant}`
          )
          .join(MULTISELECT_SEPARATOR)
      )
      .join(CONFIGURATION_SEPARATOR),
  };
}

export type ConfigurationParamsResult =
  { ok: true; inputs: Record<string, string> } | { ok: false; error: string };

/**
 * Expand every configuration parameter in `inputs`. A parameter the caller
 * left out gets its default; an id that is not assigned to the project (or
 * is disabled or deleted) is refused, as is more than one id on a
 * single-choice parameter. Other inputs pass through untouched.
 */
export async function resolveConfigurationParams(
  db: ConfigurationReader,
  projectId: number,
  params: ExecutionParam[],
  inputs: Record<string, string>
): Promise<ConfigurationParamsResult> {
  const configParams = params.filter((p) => p.type === "configuration");
  if (configParams.length === 0) return { ok: true, inputs };

  const wanted = new Map<string, number[]>();
  for (const param of configParams) {
    const raw = inputs[configurationInputKeys(param.name).id];
    const ids = raw === undefined ? param.default : parseConfigurationIds(raw);
    if (!param.multiple && ids.length > 1) {
      return {
        ok: false,
        error: `Parameter "${param.name}" allows one configuration (got ${ids.length})`,
      };
    }
    wanted.set(param.name, ids);
  }

  const allIds = Array.from(new Set(Array.from(wanted.values()).flat()));
  const found = await findAssignedConfigurations(db, projectId, allIds);

  const out = { ...inputs };
  for (const param of configParams) {
    const ids = wanted.get(param.name) ?? [];
    const chosen: ResolvedConfiguration[] = [];
    for (const id of ids) {
      const config = found.get(id);
      if (!config) {
        return {
          ok: false,
          error: `Configuration ${id} is not assigned to this project`,
        };
      }
      chosen.push(config);
    }
    Object.assign(out, formatConfigurationInputs(param.name, chosen));
  }
  return { ok: true, inputs: out };
}
