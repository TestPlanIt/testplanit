// lib/zenstack-plugins/jsonNullPlugin.ts
//
// ZenStack v3 rejects a plain `null` written to a nullable Json field: SQL
// NULL has to be written as the `DbNull` sentinel and JSON null as `JsonNull`.
// Reads return SQL NULL as a plain `null`, so every read-then-write path (the
// copy/move worker, CSV import, version snapshots) failed on the first empty
// value, and each fix so far patched a single call site. This plugin rewrites
// `null` → `DbNull` on every nullable Json field of a write before ZenStack
// validates it, so no call site has to remember the sentinel. It is installed
// by lib/zenstackClientFactory.ts on every client the app constructs.
//
// Required Json fields are left alone — `null` there is a real bug and should
// keep failing loudly — and so are `where` clauses, whose sentinels are owned
// by lib/repository/whereTransport.ts.
import { DbNull, definePlugin } from "@zenstackhq/orm";
import { schema } from "~/zenstack/schema";

const WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

type FieldMeta = {
  type: string;
  optional?: boolean;
  array?: boolean;
  relation?: unknown;
};

type ModelMeta = { fields: Record<string, FieldMeta> };

const MODELS = schema.models as unknown as Record<string, ModelMeta>;
const TYPE_DEF_NAMES = new Set(
  Object.keys((schema as { typeDefs?: Record<string, unknown> }).typeDefs ?? {})
);

/** A `Json?` (or typed-Json `Foo?`) scalar: the only place `null` means DbNull. */
export function isNullableJsonField(field: FieldMeta): boolean {
  return (
    Boolean(field.optional) &&
    !field.relation &&
    !field.array &&
    (field.type === "Json" || TYPE_DEF_NAMES.has(field.type))
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Returns `obj` with `key` replaced, or `obj` itself when nothing changed. */
function withKey<T extends Record<string, unknown>>(
  obj: T,
  key: string,
  value: unknown
): T {
  return obj[key] === value ? obj : { ...obj, [key]: value };
}

function mapEach(value: unknown, fn: (entry: unknown) => unknown): unknown {
  if (Array.isArray(value)) {
    let out: unknown[] | undefined;
    value.forEach((entry, i) => {
      const next = fn(entry);
      if (next !== entry) (out ??= [...value])[i] = next;
    });
    return out ?? value;
  }
  return fn(value);
}

/**
 * Normalize one `data` payload (an object, or an array of them for the
 * createMany family) for `model`. Scalar nullable Json fields holding exactly
 * `null` become `DbNull`; relation fields recurse into their nested writes.
 */
function normalizeData(model: string, data: unknown): unknown {
  if (Array.isArray(data))
    return mapEach(data, (row) => normalizeData(model, row));
  if (!isPlainObject(data)) return data;
  const fields = MODELS[model]?.fields;
  if (!fields) return data;

  let out = data;
  for (const [key, value] of Object.entries(data)) {
    const field = fields[key];
    if (!field) continue;
    if (field.relation) {
      out = withKey(out, key, normalizeRelationWrite(field.type, value));
    } else if (value === null && isNullableJsonField(field)) {
      out = withKey(out, key, DbNull);
    }
  }
  return out;
}

/** A nested `{ where?, data }` update entry, or the bare data of a to-one update. */
function normalizeUpdateEntry(model: string, entry: unknown): unknown {
  if (!isPlainObject(entry)) return entry;
  const wrapped =
    isPlainObject(entry.data) &&
    Object.keys(entry).every((k) => k === "where" || k === "data");
  return wrapped
    ? withKey(entry, "data", normalizeData(model, entry.data))
    : normalizeData(model, entry);
}

/** The nested write payloads a relation field accepts, keyed by verb. */
function normalizeRelationWrite(target: string, value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  let out = value;
  if ("create" in value) {
    out = withKey(out, "create", normalizeData(target, value.create));
  }
  if (isPlainObject(value.createMany) && "data" in value.createMany) {
    out = withKey(
      out,
      "createMany",
      withKey(
        value.createMany,
        "data",
        normalizeData(target, value.createMany.data)
      )
    );
  }
  if ("connectOrCreate" in value) {
    out = withKey(
      out,
      "connectOrCreate",
      mapEach(value.connectOrCreate, (entry) =>
        isPlainObject(entry) && "create" in entry
          ? withKey(entry, "create", normalizeData(target, entry.create))
          : entry
      )
    );
  }
  if ("update" in value) {
    out = withKey(
      out,
      "update",
      mapEach(value.update, (entry) => normalizeUpdateEntry(target, entry))
    );
  }
  if ("updateMany" in value) {
    out = withKey(
      out,
      "updateMany",
      mapEach(value.updateMany, (entry) =>
        isPlainObject(entry) && "data" in entry
          ? withKey(entry, "data", normalizeData(target, entry.data))
          : entry
      )
    );
  }
  if ("upsert" in value) {
    out = withKey(
      out,
      "upsert",
      mapEach(value.upsert, (entry) => {
        if (!isPlainObject(entry)) return entry;
        let next = entry;
        if ("create" in entry) {
          next = withKey(next, "create", normalizeData(target, entry.create));
        }
        if ("update" in entry) {
          next = withKey(next, "update", normalizeData(target, entry.update));
        }
        return next;
      })
    );
  }
  return out;
}

/**
 * Rewrite the args of a write so every nullable Json field set to `null`
 * carries `DbNull` instead. Returns the caller's object untouched (same
 * reference) when there is nothing to rewrite; never mutates it.
 */
export function normalizeJsonNullArgs<
  T extends Record<string, unknown> | undefined,
>(model: string, operation: string, args: T): T {
  if (!WRITE_OPERATIONS.has(operation) || !isPlainObject(args)) return args;
  let out: Record<string, unknown> = args;
  if (operation === "upsert") {
    if ("create" in args) {
      out = withKey(out, "create", normalizeData(model, args.create));
    }
    if ("update" in args) {
      out = withKey(out, "update", normalizeData(model, args.update));
    }
  } else if ("data" in args) {
    out = withKey(out, "data", normalizeData(model, args.data));
  }
  return out as T;
}

export const jsonNullPlugin = definePlugin(schema, {
  id: "testplanit-json-null",
  onQuery: async ({ model, operation, args, proceed }) =>
    proceed(normalizeJsonNullArgs(model, operation, args)),
});
