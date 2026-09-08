/**
 * Generates lib/openapi/zenstack-openapi.json from the ZenStack v3 runtime
 * schema (zenstack/schema.ts), replacing the ZenStack v2 `@zenstackhq/openapi`
 * plugin that produced the file before the v3 migration (v3 has no OpenAPI
 * plugin). Output follows the same RPC-flavor conventions as the original
 * plugin so the /api/docs Swagger UI and existing consumers keep working.
 *
 * Run:  pnpm tsx scripts/generate-openapi.ts          # rewrite the spec files
 *       pnpm tsx scripts/generate-openapi.ts --check  # exit 1 if spec is stale
 *
 * Runs as part of `pnpm generate`, and the parity unit test
 * (scripts/generate-openapi.test.ts) fails when the checked-in spec does not
 * match the schema, so the docs cannot silently drift again.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { schema } from "../zenstack/schema";
import { generateMergedSpec } from "../lib/openapi/merge-specs";

type Json = any;

interface FieldDef {
  name: string;
  type: string;
  optional?: boolean;
  array?: boolean;
  id?: boolean;
  unique?: boolean;
  updatedAt?: boolean;
  default?: unknown;
  relation?: { opposite?: string; fields?: readonly string[] };
  foreignKeyFor?: readonly string[];
}

interface ModelDef {
  name: string;
  fields: Record<string, FieldDef>;
  idFields: readonly string[];
  uniqueFields: Record<string, Json>;
}

const R = "#/components/schemas/";
const ref = (n: string): Json => ({ $ref: R + n });
const oneOf = (...alts: Json[]): Json => ({ oneOf: alts });
const arrayOf = (item: Json): Json => ({ type: "array", items: item });
const NULL: Json = { type: "null" };
const BOOL: Json = { type: "boolean" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const low = (s: string) => s[0].toLowerCase() + s.slice(1);

const models = schema.models as unknown as Record<string, ModelDef>;
const enums = schema.enums as unknown as Record<
  string,
  { name: string; values: Record<string, string> }
>;

const isEnum = (t: string) => t in enums;
const isRel = (f: FieldDef) => !!f.relation;
const isFk = (f: FieldDef) => (f.foreignKeyFor?.length ?? 0) > 0;
const hasDefault = (f: FieldDef) => "default" in f || f.updatedAt === true;
const scalarsOf = (m: ModelDef) =>
  Object.values(m.fields).filter((f) => !isRel(f));
const relsOf = (m: ModelDef) => Object.values(m.fields).filter(isRel);
/** The field on the relation's target model that points back at this model. */
const oppositeField = (f: FieldDef): FieldDef => {
  const target = models[f.type];
  const opp = f.relation?.opposite;
  const of = opp ? target?.fields[opp] : undefined;
  if (!of) {
    throw new Error(
      `missing opposite for relation field ${f.name} -> ${f.type}`
    );
  }
  return of;
};

const NUMERIC = new Set(["Int", "BigInt", "Float", "Decimal"]);
const isNumeric = (f: FieldDef) => NUMERIC.has(f.type) && !f.array;
/** _min/_max cover orderable types: everything except Json and lists. */
const isMinMaxable = (f: FieldDef) => f.type !== "Json" && !f.array;

function bareType(f: FieldDef): Json {
  if (f.array) return arrayOf(bareType({ ...f, array: false }));
  switch (f.type) {
    case "Int":
    case "BigInt":
      return { type: "integer" };
    case "Float":
      return { type: "number" };
    case "Decimal":
      // Decimals serialize as either string or number.
      return oneOf({ type: "string" }, { type: "number" });
    case "String":
      return { type: "string" };
    case "Boolean":
      return BOOL;
    case "DateTime":
      return { type: "string", format: "date-time" };
    case "Json":
      return {};
    default:
      if (isEnum(f.type)) return ref(f.type);
      throw new Error(`unsupported scalar type ${f.type}`);
  }
}

/** Type token used in filter/update-operation schema names ("Bool" not "Boolean"). */
const typeToken = (t: string) => (t === "Boolean" ? "Bool" : t);

function filterName(f: FieldDef): string {
  if (f.array) {
    if (f.type !== "String") throw new Error(`no list filter for ${f.type}[]`);
    return "StringNullableListFilter";
  }
  const nullable = f.optional ? "Nullable" : "";
  if (isEnum(f.type)) return `Enum${f.type}${nullable}Filter`;
  return `${typeToken(f.type)}${nullable}Filter`;
}

function aggFilterName(f: FieldDef): string {
  if (f.array) return "StringNullableListFilter";
  const nullable = f.optional ? "Nullable" : "";
  if (isEnum(f.type)) return `Enum${f.type}${nullable}WithAggregatesFilter`;
  return `${typeToken(f.type)}${nullable}WithAggregatesFilter`;
}

function updateOpName(f: FieldDef): string {
  const nullable = f.optional ? "Nullable" : "";
  if (isEnum(f.type))
    return `${nullable}Enum${f.type}FieldUpdateOperationsInput`;
  return `${nullable}${typeToken(f.type)}FieldUpdateOperationsInput`;
}

function whereProp(f: FieldDef): Json {
  if (isRel(f)) {
    if (f.array) return ref(`${f.type}ListRelationFilter`);
    return f.optional
      ? oneOf(
          ref(`${f.type}NullableScalarRelationFilter`),
          ref(`${f.type}WhereInput`),
          NULL
        )
      : oneOf(ref(`${f.type}ScalarRelationFilter`), ref(`${f.type}WhereInput`));
  }
  if (f.type === "Json" || f.array) return ref(filterName(f));
  const alts = [ref(filterName(f)), bareType(f)];
  if (f.optional) alts.push(NULL);
  return oneOf(...alts);
}

function aggWhereProp(f: FieldDef): Json {
  if (f.type === "Json" || f.array) return ref(aggFilterName(f));
  const alts = [ref(aggFilterName(f)), bareType(f)];
  if (f.optional) alts.push(NULL);
  return oneOf(...alts);
}

function createProp(model: ModelDef, f: FieldDef): Json {
  if (f.type === "Json") {
    return oneOf(
      ref(f.optional ? "NullableJsonNullValueInput" : "JsonNullValueInput"),
      {}
    );
  }
  if (f.array) {
    return oneOf(ref(`${model.name}Create${f.name}Input`), bareType(f));
  }
  if (f.optional) return withNull(f, bareType(f));
  return bareType(f);
}

function updateProp(model: ModelDef, f: FieldDef): Json {
  if (f.type === "Json") {
    return oneOf(
      ref(f.optional ? "NullableJsonNullValueInput" : "JsonNullValueInput"),
      {}
    );
  }
  if (f.array) {
    return oneOf(ref(`${model.name}Update${f.name}Input`), bareType(f));
  }
  const alts = [bareType(f), ref(updateOpName(f))];
  if (f.optional) alts.push(NULL);
  return oneOf(...alts);
}

function entityProp(f: FieldDef): Json {
  if (isRel(f)) {
    if (f.array) return arrayOf(ref(f.type));
    return f.optional ? oneOf(NULL, ref(f.type)) : ref(f.type);
  }
  if (f.optional && !f.array) return withNull(f, bareType(f));
  return bareType(f);
}

/**
 * Optional-value form: oneOf(null, X) — except Decimal, whose oneOf gets
 * flattened with null appended (matching the original plugin's output).
 */
function withNull(f: FieldDef, bare: Json, nullLast = false): Json {
  if (f.type === "Decimal" && !f.array && Array.isArray(bare.oneOf)) {
    return oneOf(...bare.oneOf, NULL);
  }
  return nullLast ? oneOf(bare, NULL) : oneOf(NULL, bare);
}

const obj = (properties: Record<string, Json>, required?: string[]): Json => {
  const out: Json = { type: "object", properties };
  if (required && required.length > 0) out.required = required;
  return out;
};

/** oneOf(X, X[]) — the "single item or list" convention used by nested inputs. */
const itemOrList = (...names: string[]): Json =>
  oneOf(...names.flatMap((n) => [ref(n), arrayOf(ref(n))]));

// ---------------------------------------------------------------------------
// Demand maps: which helper schemas each model needs, based on how other
// models reference it.
// ---------------------------------------------------------------------------
interface Demand {
  listRelationFilter: boolean;
  scalarRelationFilter: boolean;
  nullableScalarRelationFilter: boolean;
  defaultArgs: boolean;
  orderByRelationAggregate: boolean;
  scalarWhere: boolean;
}
const demand: Record<string, Demand> = {};
for (const name of Object.keys(models)) {
  demand[name] = {
    listRelationFilter: false,
    scalarRelationFilter: false,
    nullableScalarRelationFilter: false,
    defaultArgs: false,
    orderByRelationAggregate: false,
    scalarWhere: false,
  };
}
for (const m of Object.values(models)) {
  for (const f of relsOf(m)) {
    const d = demand[f.type];
    if (!d) throw new Error(`relation to unknown model ${f.type}`);
    if (f.array) {
      d.listRelationFilter = true;
      d.orderByRelationAggregate = true;
      d.scalarWhere = true;
    } else {
      d.defaultArgs = true;
      if (f.optional) d.nullableScalarRelationFilter = true;
      else d.scalarRelationFilter = true;
    }
  }
}

// Enum demand: which enums appear on model fields, and with which nullability.
const enumUse = new Map<string, { nullable: boolean; nonNull: boolean }>();
for (const m of Object.values(models)) {
  for (const f of scalarsOf(m)) {
    if (!isEnum(f.type)) continue;
    const u = enumUse.get(f.type) ?? { nullable: false, nonNull: false };
    if (f.optional) u.nullable = true;
    else u.nonNull = true;
    enumUse.set(f.type, u);
  }
}

// ---------------------------------------------------------------------------
// Schema emission
// ---------------------------------------------------------------------------
const schemas: Record<string, Json> = {};
const put = (name: string, def: Json) => {
  if (schemas[name]) throw new Error(`duplicate schema ${name}`);
  schemas[name] = def;
};

function emitEnum(name: string, use: { nullable: boolean; nonNull: boolean }) {
  const e = enums[name];
  put(name, { type: "string", enum: Object.keys(e.values) });
  const filterBody = (nested: string, nullable: boolean): Json => {
    const val = nullable ? oneOf(NULL, ref(name)) : ref(name);
    const list = nullable
      ? oneOf(NULL, arrayOf(ref(name)))
      : arrayOf(ref(name));
    const notAlts = [ref(name), ref(nested)];
    if (nullable) notAlts.push(NULL);
    return obj({ equals: val, in: list, notIn: list, not: oneOf(...notAlts) });
  };
  const aggBody = (nested: string, nullable: boolean): Json => {
    const base = filterBody(nested, nullable);
    base.properties._count = ref(
      nullable ? "NestedIntNullableFilter" : "NestedIntFilter"
    );
    base.properties._min = ref(
      `NestedEnum${name}${nullable ? "Nullable" : ""}Filter`
    );
    base.properties._max = ref(
      `NestedEnum${name}${nullable ? "Nullable" : ""}Filter`
    );
    return base;
  };
  for (const nullable of [false, true]) {
    if (nullable ? !use.nullable : !use.nonNull) continue;
    const nn = nullable ? "Nullable" : "";
    put(
      `Enum${name}${nn}Filter`,
      filterBody(`NestedEnum${name}${nn}Filter`, nullable)
    );
    put(
      `NestedEnum${name}${nn}Filter`,
      filterBody(`NestedEnum${name}${nn}Filter`, nullable)
    );
    put(
      `Enum${name}${nn}WithAggregatesFilter`,
      aggBody(`NestedEnum${name}${nn}WithAggregatesFilter`, nullable)
    );
    put(
      `NestedEnum${name}${nn}WithAggregatesFilter`,
      aggBody(`NestedEnum${name}${nn}WithAggregatesFilter`, nullable)
    );
    put(
      `${nullable ? "Nullable" : ""}Enum${name}FieldUpdateOperationsInput`,
      obj({ set: nullable ? oneOf(NULL, ref(name)) : ref(name) })
    );
  }
}

function boolMap(fields: FieldDef[], extra?: string[]): Json {
  const props: Record<string, Json> = {};
  for (const f of fields) props[f.name] = BOOL;
  for (const e of extra ?? []) props[e] = BOOL;
  return obj(props);
}

function selfLogicProps(name: string): Record<string, Json> {
  return {
    AND: oneOf(ref(name), arrayOf(ref(name))),
    OR: arrayOf(ref(name)),
    NOT: oneOf(ref(name), arrayOf(ref(name))),
  };
}

/** Composite unique entries in uniqueFields ({a_b: {a: {...}, b: {...}}}). */
function compoundUniques(m: ModelDef): Array<{ key: string; parts: string[] }> {
  const out: Array<{ key: string; parts: string[] }> = [];
  for (const [key, val] of Object.entries(m.uniqueFields ?? {})) {
    if (val && typeof val === "object" && typeof val.type !== "string") {
      out.push({ key, parts: Object.keys(val) });
    }
  }
  return out;
}
const compoundName = (m: ModelDef, parts: string[]) =>
  `${m.name}${parts.map(cap).join("")}CompoundUniqueInput`;

/**
 * Single unique fields: standalone @id and @unique scalars. Composite-PK
 * members carry id:true too but stay in filter form in WhereUniqueInput.
 */
function singleUniques(m: ModelDef): FieldDef[] {
  const singleId = m.idFields.length === 1 ? m.idFields[0] : undefined;
  const out: FieldDef[] = [];
  for (const f of Object.values(m.fields)) {
    if ((f.name === singleId || f.unique) && !isRel(f)) out.push(f);
  }
  return out;
}

function emitModel(m: ModelDef) {
  const N = m.name;
  const scalars = scalarsOf(m);
  const rels = relsOf(m);
  const toMany = rels.filter((f) => f.array);
  const d = demand[N];

  // --- entity ------------------------------------------------------------
  {
    const props: Record<string, Json> = {};
    const required: string[] = [];
    for (const f of Object.values(m.fields)) {
      props[f.name] = entityProp(f);
      if (!f.optional && (!f.array || !isRel(f))) required.push(f.name);
    }
    put(N, obj(props, required));
  }

  // --- select / include / count-output ------------------------------------
  const relSelect = (f: FieldDef): Json =>
    f.array
      ? oneOf(BOOL, ref(`${f.type}FindManyArgs`))
      : oneOf(BOOL, ref(`${f.type}DefaultArgs`));
  {
    const props: Record<string, Json> = {};
    for (const f of Object.values(m.fields)) {
      props[f.name] = isRel(f) ? relSelect(f) : BOOL;
    }
    if (toMany.length > 0) {
      props._count = oneOf(BOOL, ref(`${N}CountOutputTypeDefaultArgs`));
    }
    put(`${N}Select`, obj(props));
  }
  if (rels.length > 0) {
    const props: Record<string, Json> = {};
    for (const f of rels) props[f.name] = relSelect(f);
    if (toMany.length > 0) {
      props._count = oneOf(BOOL, ref(`${N}CountOutputTypeDefaultArgs`));
    }
    put(`${N}Include`, obj(props));
  }
  if (toMany.length > 0) {
    put(`${N}CountOutputTypeSelect`, boolMap(toMany));
    put(
      `${N}CountOutputTypeDefaultArgs`,
      obj({ select: ref(`${N}CountOutputTypeSelect`) })
    );
  }
  if (d.defaultArgs) {
    const props: Record<string, Json> = { select: ref(`${N}Select`) };
    if (rels.length > 0) props.include = ref(`${N}Include`);
    put(`${N}DefaultArgs`, props ? obj(props) : obj({}));
  }

  // --- where -------------------------------------------------------------
  {
    const props: Record<string, Json> = { ...selfLogicProps(`${N}WhereInput`) };
    for (const f of Object.values(m.fields)) props[f.name] = whereProp(f);
    put(`${N}WhereInput`, obj(props));
  }
  {
    // Extended WhereUniqueInput: unique selectors first, then plain filters.
    const singles = singleUniques(m);
    const singleNames = new Set(singles.map((f) => f.name));
    const props: Record<string, Json> = {};
    for (const f of singles) props[f.name] = bareType(f);
    for (const cu of compoundUniques(m)) {
      props[cu.key] = ref(compoundName(m, cu.parts));
    }
    Object.assign(props, selfLogicProps(`${N}WhereInput`));
    for (const f of Object.values(m.fields)) {
      if (singleNames.has(f.name)) continue;
      props[f.name] = whereProp(f);
    }
    put(`${N}WhereUniqueInput`, obj(props));
  }
  for (const cu of compoundUniques(m)) {
    const props: Record<string, Json> = {};
    for (const part of cu.parts) props[part] = bareType(m.fields[part]);
    put(compoundName(m, cu.parts), obj(props, [...cu.parts]));
  }
  if (d.scalarWhere) {
    const props: Record<string, Json> = {
      ...selfLogicProps(`${N}ScalarWhereInput`),
    };
    for (const f of scalars) props[f.name] = whereProp(f);
    put(`${N}ScalarWhereInput`, obj(props));
  }
  {
    const props: Record<string, Json> = {
      ...selfLogicProps(`${N}ScalarWhereWithAggregatesInput`),
    };
    for (const f of scalars) props[f.name] = aggWhereProp(f);
    put(`${N}ScalarWhereWithAggregatesInput`, obj(props));
  }

  // --- relation filters ----------------------------------------------------
  if (d.listRelationFilter) {
    put(
      `${N}ListRelationFilter`,
      obj({
        every: ref(`${N}WhereInput`),
        some: ref(`${N}WhereInput`),
        none: ref(`${N}WhereInput`),
      })
    );
  }
  if (d.scalarRelationFilter) {
    put(
      `${N}ScalarRelationFilter`,
      obj({ is: ref(`${N}WhereInput`), isNot: ref(`${N}WhereInput`) })
    );
  }
  if (d.nullableScalarRelationFilter) {
    put(
      `${N}NullableScalarRelationFilter`,
      obj({
        is: oneOf(NULL, ref(`${N}WhereInput`)),
        isNot: oneOf(NULL, ref(`${N}WhereInput`)),
      })
    );
  }

  // --- orderBy -------------------------------------------------------------
  {
    const props: Record<string, Json> = {};
    for (const f of Object.values(m.fields)) {
      if (isRel(f)) {
        props[f.name] = f.array
          ? ref(`${f.type}OrderByRelationAggregateInput`)
          : ref(`${f.type}OrderByWithRelationInput`);
      } else {
        props[f.name] =
          f.optional && !f.array
            ? oneOf(ref("SortOrder"), ref("SortOrderInput"))
            : ref("SortOrder");
      }
    }
    put(`${N}OrderByWithRelationInput`, obj(props));
  }
  if (d.orderByRelationAggregate) {
    put(`${N}OrderByRelationAggregateInput`, obj({ _count: ref("SortOrder") }));
  }

  // --- scalar field enum ---------------------------------------------------
  put(`${N}ScalarFieldEnum`, {
    type: "string",
    enum: scalars.map((f) => f.name),
  });

  // --- list-scalar create/update helper inputs -----------------------------
  for (const f of scalars) {
    if (!f.array) continue;
    const item = bareType({ ...f, array: false });
    put(`${N}Create${f.name}Input`, obj({ set: arrayOf(item) }, ["set"]));
    put(
      `${N}Update${f.name}Input`,
      obj({ set: arrayOf(item), push: oneOf(item, arrayOf(item)) })
    );
  }

  // --- aggregates ----------------------------------------------------------
  const numerics = scalars.filter(isNumeric);
  const minmax = scalars.filter(isMinMaxable);
  put(`${N}CountAggregateInput`, boolMap(scalars, ["_all"]));
  {
    const props: Record<string, Json> = {};
    const required: string[] = [];
    for (const f of scalars) {
      props[f.name] = { type: "integer" };
      required.push(f.name);
    }
    props._all = { type: "integer" };
    required.push("_all");
    put(`${N}CountAggregateOutputType`, obj(props, required));
  }
  const nullableOut = (f: FieldDef): Json =>
    f.type === "Decimal"
      ? oneOf({ type: "string" }, { type: "number" }, NULL)
      : oneOf(NULL, bareType({ ...f, optional: false }));
  for (const kind of ["Min", "Max"]) {
    put(`${N}${kind}AggregateInput`, boolMap(minmax));
    const props: Record<string, Json> = {};
    for (const f of minmax) props[f.name] = nullableOut(f);
    put(`${N}${kind}AggregateOutputType`, obj(props));
  }
  if (numerics.length > 0) {
    put(`${N}SumAggregateInput`, boolMap(numerics));
    put(`${N}AvgAggregateInput`, boolMap(numerics));
    const sumProps: Record<string, Json> = {};
    const avgProps: Record<string, Json> = {};
    for (const f of numerics) {
      sumProps[f.name] = nullableOut(f);
      avgProps[f.name] =
        f.type === "Decimal"
          ? oneOf({ type: "string" }, { type: "number" }, NULL)
          : oneOf(NULL, { type: "number" });
    }
    put(`${N}SumAggregateOutputType`, obj(sumProps));
    put(`${N}AvgAggregateOutputType`, obj(avgProps));
  }
  {
    const props: Record<string, Json> = {
      _count: oneOf(NULL, ref(`${N}CountAggregateOutputType`)),
    };
    if (numerics.length > 0) {
      props._avg = oneOf(NULL, ref(`${N}AvgAggregateOutputType`));
      props._sum = oneOf(NULL, ref(`${N}SumAggregateOutputType`));
    }
    props._min = oneOf(NULL, ref(`${N}MinAggregateOutputType`));
    props._max = oneOf(NULL, ref(`${N}MaxAggregateOutputType`));
    put(`Aggregate${N}`, obj(props));
  }
  {
    const props: Record<string, Json> = {};
    const required: string[] = [];
    for (const f of scalars) {
      if (f.array) {
        props[f.name] = arrayOf(oneOf(NULL, bareType({ ...f, array: false })));
        continue;
      }
      props[f.name] = f.optional ? withNull(f, bareType(f)) : bareType(f);
      if (!f.optional) required.push(f.name);
    }
    props._count = oneOf(NULL, ref(`${N}CountAggregateOutputType`));
    if (numerics.length > 0) {
      props._avg = oneOf(NULL, ref(`${N}AvgAggregateOutputType`));
      props._sum = oneOf(NULL, ref(`${N}SumAggregateOutputType`));
    }
    props._min = oneOf(NULL, ref(`${N}MinAggregateOutputType`));
    props._max = oneOf(NULL, ref(`${N}MaxAggregateOutputType`));
    put(`${N}GroupByOutputType`, obj(props, required));
  }

  // --- create/update inputs ------------------------------------------------
  // Checked inputs describe relations via nested inputs and omit FK scalars
  // and autoincrement ids (client-settable ids like cuid stay); unchecked
  // inputs keep FK scalars and all ids. Axis variants ("WithoutX") omit one
  // relation so the other side can nest them.
  const isAutoincrementId = (f: FieldDef) =>
    !!f.id &&
    f.type === "Int" &&
    typeof f.default === "object" &&
    f.default !== null &&
    (f.default as Json).function === "autoincrement";
  const checkedScalars = scalars.filter(
    (f) => !isFk(f) && !isAutoincrementId(f)
  );
  const relCreateRef = (f: FieldDef): Json => {
    const axis = cap(oppositeField(f).name);
    return f.array
      ? ref(`${f.type}CreateNestedManyWithout${axis}Input`)
      : ref(`${f.type}CreateNestedOneWithout${axis}Input`);
  };
  const relUpdateRef = (f: FieldDef): Json => {
    const axis = cap(oppositeField(f).name);
    if (f.array) return ref(`${f.type}UpdateManyWithout${axis}NestedInput`);
    return f.optional
      ? ref(`${f.type}UpdateOneWithout${axis}NestedInput`)
      : ref(`${f.type}UpdateOneRequiredWithout${axis}NestedInput`);
  };
  /** Relations kept in unchecked inputs: those not represented by local FKs. */
  const uncheckedRels = rels.filter((f) => !f.relation?.fields?.length);
  const relUncheckedCreateRef = (f: FieldDef): Json => {
    const axis = cap(oppositeField(f).name);
    return f.array
      ? ref(`${f.type}UncheckedCreateNestedManyWithout${axis}Input`)
      : ref(`${f.type}UncheckedCreateNestedOneWithout${axis}Input`);
  };
  const relUncheckedUpdateRef = (f: FieldDef): Json => {
    const axis = cap(oppositeField(f).name);
    return f.array
      ? ref(`${f.type}UncheckedUpdateManyWithout${axis}NestedInput`)
      : ref(`${f.type}UncheckedUpdateOneWithout${axis}NestedInput`);
  };

  const checkedCreate = (omit?: FieldDef): Json => {
    const props: Record<string, Json> = {};
    const required: string[] = [];
    for (const f of checkedScalars) {
      props[f.name] = createProp(m, f);
      if (!f.optional && !hasDefault(f) && !f.array) required.push(f.name);
    }
    for (const f of rels) {
      if (omit && f.name === omit.name) continue;
      props[f.name] = relCreateRef(f);
      if (!f.array && !f.optional) required.push(f.name);
    }
    return obj(props, required);
  };
  const uncheckedCreate = (omit?: FieldDef): Json => {
    const omitFks = new Set(omit?.relation?.fields ?? []);
    const props: Record<string, Json> = {};
    const required: string[] = [];
    for (const f of scalars) {
      if (omitFks.has(f.name)) continue;
      props[f.name] = createProp(m, f);
      if (!f.optional && !hasDefault(f) && !f.array) required.push(f.name);
    }
    for (const f of uncheckedRels) {
      if (omit && f.name === omit.name) continue;
      props[f.name] = relUncheckedCreateRef(f);
    }
    return obj(props, required);
  };
  const checkedUpdate = (omit?: FieldDef): Json => {
    const props: Record<string, Json> = {};
    for (const f of checkedScalars) props[f.name] = updateProp(m, f);
    for (const f of rels) {
      if (omit && f.name === omit.name) continue;
      props[f.name] = relUpdateRef(f);
    }
    return obj(props);
  };
  const uncheckedUpdate = (omit?: FieldDef): Json => {
    const omitFks = new Set(omit?.relation?.fields ?? []);
    const props: Record<string, Json> = {};
    for (const f of scalars) {
      if (omitFks.has(f.name)) continue;
      props[f.name] = updateProp(m, f);
    }
    for (const f of uncheckedRels) {
      if (omit && f.name === omit.name) continue;
      props[f.name] = relUncheckedUpdateRef(f);
    }
    return obj(props);
  };
  const scalarOnlyUpdate = (opts: {
    withFksAndId: boolean;
    omitFks?: Set<string>;
  }): Json => {
    const props: Record<string, Json> = {};
    for (const f of scalars) {
      if (!opts.withFksAndId && (isFk(f) || isAutoincrementId(f))) continue;
      if (opts.omitFks?.has(f.name)) continue;
      props[f.name] = updateProp(m, f);
    }
    return obj(props);
  };

  put(`${N}CreateInput`, checkedCreate());
  put(`${N}UpdateInput`, checkedUpdate());
  put(`${N}UpdateManyMutationInput`, scalarOnlyUpdate({ withFksAndId: false }));
  {
    const props: Record<string, Json> = {};
    const required: string[] = [];
    for (const f of scalars) {
      props[f.name] = createProp(m, f);
      if (!f.optional && !hasDefault(f) && !f.array) required.push(f.name);
    }
    put(`${N}CreateManyInput`, obj(props, required));
  }

  // --- per-axis families ---------------------------------------------------
  for (const o of rels) {
    const axis = cap(o.name);
    const inbound = oppositeField(o); // field on o.type pointing back at N
    put(`${N}CreateWithout${axis}Input`, checkedCreate(o));
    put(`${N}UncheckedCreateWithout${axis}Input`, uncheckedCreate(o));
    put(`${N}UpdateWithout${axis}Input`, checkedUpdate(o));
    put(`${N}UncheckedUpdateWithout${axis}Input`, uncheckedUpdate(o));
    put(
      `${N}CreateOrConnectWithout${axis}Input`,
      obj(
        {
          where: ref(`${N}WhereUniqueInput`),
          create: oneOf(
            ref(`${N}CreateWithout${axis}Input`),
            ref(`${N}UncheckedCreateWithout${axis}Input`)
          ),
        },
        ["where", "create"]
      )
    );

    const createAlts = itemOrList(
      `${N}CreateWithout${axis}Input`,
      `${N}UncheckedCreateWithout${axis}Input`
    );
    const connectOrCreateAlts = itemOrList(
      `${N}CreateOrConnectWithout${axis}Input`
    );
    const whereUniqueAlts = itemOrList(`${N}WhereUniqueInput`);

    if (inbound.array) {
      // The other side holds a collection of N.
      const ownsFk = (o.relation?.fields?.length ?? 0) > 0;
      if (ownsFk) {
        const omitFks = new Set(o.relation!.fields!);
        const props: Record<string, Json> = {};
        const required: string[] = [];
        for (const f of scalars) {
          if (omitFks.has(f.name)) continue;
          props[f.name] = createProp(m, f);
          if (!f.optional && !hasDefault(f) && !f.array) required.push(f.name);
        }
        put(`${N}CreateMany${axis}Input`, obj(props, required));
        put(
          `${N}CreateMany${axis}InputEnvelope`,
          obj(
            {
              data: itemOrList(`${N}CreateMany${axis}Input`),
              skipDuplicates: BOOL,
            },
            ["data"]
          )
        );
      }
      const nestedCreateProps: Record<string, Json> = {
        create: createAlts,
        connectOrCreate: connectOrCreateAlts,
      };
      if (ownsFk) {
        nestedCreateProps.createMany = ref(
          `${N}CreateMany${axis}InputEnvelope`
        );
      }
      nestedCreateProps.connect = whereUniqueAlts;
      put(`${N}CreateNestedManyWithout${axis}Input`, obj(nestedCreateProps));
      put(
        `${N}UncheckedCreateNestedManyWithout${axis}Input`,
        obj({ ...nestedCreateProps })
      );

      put(
        `${N}UpsertWithWhereUniqueWithout${axis}Input`,
        obj(
          {
            where: ref(`${N}WhereUniqueInput`),
            update: oneOf(
              ref(`${N}UpdateWithout${axis}Input`),
              ref(`${N}UncheckedUpdateWithout${axis}Input`)
            ),
            create: oneOf(
              ref(`${N}CreateWithout${axis}Input`),
              ref(`${N}UncheckedCreateWithout${axis}Input`)
            ),
          },
          ["where", "update", "create"]
        )
      );
      put(
        `${N}UpdateWithWhereUniqueWithout${axis}Input`,
        obj(
          {
            where: ref(`${N}WhereUniqueInput`),
            data: oneOf(
              ref(`${N}UpdateWithout${axis}Input`),
              ref(`${N}UncheckedUpdateWithout${axis}Input`)
            ),
          },
          ["where", "data"]
        )
      );
      put(
        `${N}UpdateManyWithWhereWithout${axis}Input`,
        obj(
          {
            where: ref(`${N}ScalarWhereInput`),
            data: oneOf(
              ref(`${N}UpdateManyMutationInput`),
              ref(`${N}UncheckedUpdateManyWithout${axis}Input`)
            ),
          },
          ["where", "data"]
        )
      );
      put(
        `${N}UncheckedUpdateManyWithout${axis}Input`,
        scalarOnlyUpdate({
          withFksAndId: true,
          omitFks: new Set(o.relation?.fields ?? []),
        })
      );
      const nestedUpdateProps: Record<string, Json> = {
        create: createAlts,
        connectOrCreate: connectOrCreateAlts,
        upsert: itemOrList(`${N}UpsertWithWhereUniqueWithout${axis}Input`),
      };
      if (ownsFk) {
        nestedUpdateProps.createMany = ref(
          `${N}CreateMany${axis}InputEnvelope`
        );
      }
      nestedUpdateProps.set = whereUniqueAlts;
      nestedUpdateProps.disconnect = whereUniqueAlts;
      nestedUpdateProps.delete = whereUniqueAlts;
      nestedUpdateProps.connect = whereUniqueAlts;
      nestedUpdateProps.update = itemOrList(
        `${N}UpdateWithWhereUniqueWithout${axis}Input`
      );
      nestedUpdateProps.updateMany = itemOrList(
        `${N}UpdateManyWithWhereWithout${axis}Input`
      );
      nestedUpdateProps.deleteMany = itemOrList(`${N}ScalarWhereInput`);
      put(`${N}UpdateManyWithout${axis}NestedInput`, obj(nestedUpdateProps));
      put(
        `${N}UncheckedUpdateManyWithout${axis}NestedInput`,
        obj({ ...nestedUpdateProps })
      );
    } else {
      // The other side holds a single N.
      const nestedOneCreate = obj({
        create: oneOf(
          ref(`${N}CreateWithout${axis}Input`),
          ref(`${N}UncheckedCreateWithout${axis}Input`)
        ),
        connectOrCreate: ref(`${N}CreateOrConnectWithout${axis}Input`),
        connect: ref(`${N}WhereUniqueInput`),
      });
      put(`${N}CreateNestedOneWithout${axis}Input`, nestedOneCreate);
      if (!inbound.relation?.fields?.length) {
        // Inbound side is the non-owner of a one-to-one: its unchecked inputs
        // still nest N (e.g. RepositoryCases -> CaseSharedDataSetAssignment).
        put(
          `${N}UncheckedCreateNestedOneWithout${axis}Input`,
          obj({ ...nestedOneCreate.properties })
        );
      }
      put(
        `${N}UpsertWithout${axis}Input`,
        obj(
          {
            update: oneOf(
              ref(`${N}UpdateWithout${axis}Input`),
              ref(`${N}UncheckedUpdateWithout${axis}Input`)
            ),
            create: oneOf(
              ref(`${N}CreateWithout${axis}Input`),
              ref(`${N}UncheckedCreateWithout${axis}Input`)
            ),
            where: ref(`${N}WhereInput`),
          },
          ["update", "create"]
        )
      );
      put(
        `${N}UpdateToOneWithWhereWithout${axis}Input`,
        obj(
          {
            where: ref(`${N}WhereInput`),
            data: oneOf(
              ref(`${N}UpdateWithout${axis}Input`),
              ref(`${N}UncheckedUpdateWithout${axis}Input`)
            ),
          },
          ["data"]
        )
      );
      const nestedOneUpdate: Record<string, Json> = {
        create: oneOf(
          ref(`${N}CreateWithout${axis}Input`),
          ref(`${N}UncheckedCreateWithout${axis}Input`)
        ),
        connectOrCreate: ref(`${N}CreateOrConnectWithout${axis}Input`),
        upsert: ref(`${N}UpsertWithout${axis}Input`),
      };
      if (inbound.optional) {
        nestedOneUpdate.disconnect = oneOf(BOOL, ref(`${N}WhereInput`));
        nestedOneUpdate.delete = oneOf(BOOL, ref(`${N}WhereInput`));
      }
      nestedOneUpdate.connect = ref(`${N}WhereUniqueInput`);
      nestedOneUpdate.update = oneOf(
        ref(`${N}UpdateToOneWithWhereWithout${axis}Input`),
        ref(`${N}UpdateWithout${axis}Input`),
        ref(`${N}UncheckedUpdateWithout${axis}Input`)
      );
      put(
        `${N}UpdateOne${inbound.optional ? "" : "Required"}Without${axis}NestedInput`,
        obj(nestedOneUpdate)
      );
      if (!inbound.relation?.fields?.length) {
        put(
          `${N}UncheckedUpdateOneWithout${axis}NestedInput`,
          obj({ ...nestedOneUpdate })
        );
      }
    }
  }

  // --- args ---------------------------------------------------------------
  const selectInclude: Record<string, Json> = { select: ref(`${N}Select`) };
  if (rels.length > 0) selectInclude.include = ref(`${N}Include`);
  const META = { meta: ref("_Meta") };
  put(`${N}FindManyArgs`, {
    type: "object",
    properties: {
      ...selectInclude,
      where: ref(`${N}WhereInput`),
      orderBy: oneOf(
        ref(`${N}OrderByWithRelationInput`),
        arrayOf(ref(`${N}OrderByWithRelationInput`))
      ),
      cursor: ref(`${N}WhereUniqueInput`),
      take: { type: "integer" },
      skip: { type: "integer" },
      ...META,
    },
  });
  put(`${N}FindUniqueArgs`, {
    type: "object",
    required: ["where"],
    properties: {
      ...selectInclude,
      where: ref(`${N}WhereUniqueInput`),
      ...META,
    },
  });
  put(`${N}FindFirstArgs`, {
    type: "object",
    properties: { ...selectInclude, where: ref(`${N}WhereInput`), ...META },
  });
  put(`${N}CreateArgs`, {
    type: "object",
    required: ["data"],
    properties: { ...selectInclude, data: ref(`${N}CreateInput`), ...META },
  });
  put(`${N}CreateManyArgs`, {
    type: "object",
    required: ["data"],
    properties: {
      data: itemOrList(`${N}CreateManyInput`),
      skipDuplicates: {
        type: "boolean",
        description:
          "Do not insert records with unique fields or ID fields that already exist.",
      },
      ...META,
    },
  });
  put(`${N}UpdateArgs`, {
    type: "object",
    required: ["where", "data"],
    properties: {
      ...selectInclude,
      where: ref(`${N}WhereUniqueInput`),
      data: ref(`${N}UpdateInput`),
      ...META,
    },
  });
  put(`${N}UpdateManyArgs`, {
    type: "object",
    required: ["data"],
    properties: {
      where: ref(`${N}WhereInput`),
      data: ref(`${N}UpdateManyMutationInput`),
      ...META,
    },
  });
  put(`${N}UpsertArgs`, {
    type: "object",
    required: ["create", "update", "where"],
    properties: {
      ...selectInclude,
      where: ref(`${N}WhereUniqueInput`),
      create: ref(`${N}CreateInput`),
      update: ref(`${N}UpdateInput`),
      ...META,
    },
  });
  put(`${N}DeleteUniqueArgs`, {
    type: "object",
    required: ["where"],
    properties: {
      ...selectInclude,
      where: ref(`${N}WhereUniqueInput`),
      ...META,
    },
  });
  put(`${N}DeleteManyArgs`, {
    type: "object",
    properties: { where: ref(`${N}WhereInput`), ...META },
  });
  put(`${N}CountArgs`, {
    type: "object",
    properties: {
      select: ref(`${N}Select`),
      where: ref(`${N}WhereInput`),
      ...META,
    },
  });
  {
    const props: Record<string, Json> = {
      where: ref(`${N}WhereInput`),
      orderBy: ref(`${N}OrderByWithRelationInput`),
      cursor: ref(`${N}WhereUniqueInput`),
      take: { type: "integer" },
      skip: { type: "integer" },
      _count: oneOf(BOOL, ref(`${N}CountAggregateInput`)),
      _min: ref(`${N}MinAggregateInput`),
      _max: ref(`${N}MaxAggregateInput`),
    };
    if (numerics.length > 0) {
      props._sum = ref(`${N}SumAggregateInput`);
      props._avg = ref(`${N}AvgAggregateInput`);
    }
    put(`${N}AggregateArgs`, obj({ ...props, ...META }));
  }
  {
    const props: Record<string, Json> = {
      where: ref(`${N}WhereInput`),
      orderBy: ref(`${N}OrderByWithRelationInput`),
      by: ref(`${N}ScalarFieldEnum`),
      having: ref(`${N}ScalarWhereWithAggregatesInput`),
      take: { type: "integer" },
      skip: { type: "integer" },
      _count: oneOf(BOOL, ref(`${N}CountAggregateInput`)),
      _min: ref(`${N}MinAggregateInput`),
      _max: ref(`${N}MaxAggregateInput`),
    };
    if (numerics.length > 0) {
      props._sum = ref(`${N}SumAggregateInput`);
      props._avg = ref(`${N}AvgAggregateInput`);
    }
    put(`${N}GroupByArgs`, obj({ ...props, ...META }));
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const OPS = [
  "create",
  "createMany",
  "findUnique",
  "findFirst",
  "findMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
] as const;

function pathsForModel(m: ModelDef): Record<string, Json> {
  const N = m.name;
  const t = low(N);
  const dataDesc = "The Prisma response data serialized with superjson";
  const metaResp = {
    $ref: R + "_Meta",
    description: 'The superjson serialization metadata for the "data" field',
  };
  const respond = (status: string, data: Json): Json => ({
    [status]: {
      description: "Successful operation",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["data"],
            properties: {
              data: { ...data, description: dataDesc },
              meta: metaResp,
            },
          },
        },
      },
    },
    "400": {
      content: { "application/json": { schema: ref("_Error") } },
      description: "Invalid request",
    },
    "403": {
      content: { "application/json": { schema: ref("_Error") } },
      description: "Request is forbidden",
    },
    "422": {
      content: { "application/json": { schema: ref("_Error") } },
      description: "Request is unprocessable due to validation errors",
    },
  });
  const qParams = (args: string): Json[] => [
    {
      name: "q",
      in: "query",
      required: true,
      description: "Superjson-serialized Prisma query object",
      content: { "application/json": { schema: ref(args) } },
    },
    {
      name: "meta",
      in: "query",
      description: 'Superjson serialization metadata for parameter "q"',
      content: { "application/json": { schema: {} } },
    },
  ];
  const body = (args: string): Json => ({
    content: { "application/json": { schema: ref(args) } },
  });
  const op = (id: string, description: string, rest: Json): Json => ({
    operationId: `${id}${N}`,
    description,
    tags: [t],
    ...rest,
  });

  const defs: Record<string, { method: string; op: Json }> = {
    create: {
      method: "post",
      op: op("create", `Create a new ${N}`, {
        responses: respond("201", ref(N)),
        requestBody: body(`${N}CreateArgs`),
      }),
    },
    createMany: {
      method: "post",
      op: op("createMany", `Create several ${N}`, {
        responses: respond("201", ref("BatchPayload")),
        requestBody: body(`${N}CreateManyArgs`),
      }),
    },
    findUnique: {
      method: "get",
      op: op("findUnique", `Find one unique ${N}`, {
        responses: respond("200", ref(N)),
        parameters: qParams(`${N}FindUniqueArgs`),
      }),
    },
    findFirst: {
      method: "get",
      op: op("findFirst", `Find the first ${N} matching the given condition`, {
        responses: respond("200", ref(N)),
        parameters: qParams(`${N}FindFirstArgs`),
      }),
    },
    findMany: {
      method: "get",
      op: op("findMany", `Find a list of ${N}`, {
        responses: respond("200", arrayOf(ref(N))),
        parameters: qParams(`${N}FindManyArgs`),
      }),
    },
    update: {
      method: "patch",
      op: op("update", `Update a ${N}`, {
        responses: respond("200", ref(N)),
        requestBody: body(`${N}UpdateArgs`),
      }),
    },
    updateMany: {
      method: "patch",
      op: op("updateMany", `Update ${N}s matching the given condition`, {
        responses: respond("200", ref("BatchPayload")),
        requestBody: body(`${N}UpdateManyArgs`),
      }),
    },
    upsert: {
      method: "post",
      op: op("upsert", `Upsert a ${N}`, {
        responses: respond("200", ref(N)),
        requestBody: body(`${N}UpsertArgs`),
      }),
    },
    delete: {
      method: "delete",
      op: op("delete", `Delete one unique ${N}`, {
        responses: respond("200", ref(N)),
        parameters: qParams(`${N}DeleteUniqueArgs`),
      }),
    },
    deleteMany: {
      method: "delete",
      op: op("deleteMany", `Delete ${N}s matching the given condition`, {
        responses: respond("200", ref("BatchPayload")),
        parameters: qParams(`${N}DeleteManyArgs`),
      }),
    },
    count: {
      method: "get",
      op: op("count", `Find a list of ${N}`, {
        responses: respond(
          "200",
          oneOf({ type: "integer" }, ref(`${N}CountAggregateOutputType`))
        ),
        parameters: qParams(`${N}CountArgs`),
      }),
    },
    aggregate: {
      method: "get",
      op: op("aggregate", `Aggregate ${N}s`, {
        responses: respond("200", ref(`Aggregate${N}`)),
        parameters: qParams(`${N}AggregateArgs`),
      }),
    },
    groupBy: {
      method: "get",
      op: op("groupBy", `Group ${N}s by fields`, {
        responses: respond("200", arrayOf(ref(`${N}GroupByOutputType`))),
        parameters: qParams(`${N}GroupByArgs`),
      }),
    },
  };
  const out: Record<string, Json> = {};
  for (const opName of OPS) {
    const d = defs[opName];
    out[`/api/model/${t}/${opName}`] = { [d.method]: d.op };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
export function buildSpec(): Json {
  for (const k of Object.keys(schemas)) delete schemas[k];
  const staticSchemas: Record<string, Json> = JSON.parse(
    readFileSync(join(__dirname, "openapi-static-schemas.json"), "utf-8")
  );
  for (const [k, v] of Object.entries(staticSchemas)) put(k, v);
  for (const [name, use] of enumUse) emitEnum(name, use);
  const paths: Record<string, Json> = {};
  const tags: Json[] = [];
  for (const m of Object.values(models)) {
    emitModel(m);
    Object.assign(paths, pathsForModel(m));
    tags.push({ name: low(m.name), description: `${m.name} operations` });
  }

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "TestPlanIt API",
      version: "1.0.0",
      description: "Auto-generated API documentation for ZenStack data models",
    },
    tags,
    paths,
    components: { schemas },
  };

  // Every $ref must resolve to an emitted schema.
  const missing = new Set<string>();
  const walk = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (typeof node.$ref === "string") {
        const name = node.$ref.replace(R, "");
        if (!schemas[name]) missing.add(name);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(spec);
  if (missing.size > 0) {
    throw new Error(`unresolved $refs: ${[...missing].sort().join(", ")}`);
  }
  return spec;
}

export function renderSpec(): string {
  return JSON.stringify(buildSpec(), null, 2) + "\n";
}

const SPEC_PATH = join(
  __dirname,
  "..",
  "lib",
  "openapi",
  "zenstack-openapi.json"
);

function main() {
  const rendered = renderSpec();
  if (process.argv.includes("--check")) {
    const current = readFileSync(SPEC_PATH, "utf-8");
    if (current !== rendered) {
      console.error(
        "lib/openapi/zenstack-openapi.json is out of date; run `pnpm generate` (or `pnpm tsx scripts/generate-openapi.ts`)"
      );
      process.exit(1);
    }
    console.log("OpenAPI spec is up to date");
    return;
  }
  writeFileSync(SPEC_PATH, rendered);
  console.log(`OpenAPI spec written to ${SPEC_PATH}`);
  generateMergedSpec();
}

if (require.main === module) {
  main();
}
