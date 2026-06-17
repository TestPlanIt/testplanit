-- Production generic row-change trigger function (Phase 13 — promoted from the
-- proven Phase 12 spike at prisma/spike/audit_row_change.sql).
--
-- Applied idempotently by scripts/apply-triggers.ts (13-03), which also attaches
-- one AFTER INSERT OR UPDATE OR DELETE trigger per allowlisted table. Every such
-- write produces one append-only "DataChangeLog" row holding a {col:{old,new}}
-- diff (changed columns only for UPDATE), attributed to the actor/operation/tenant
-- read from the app.audit_context GUC.
--
-- Trigger arguments:
--   TG_ARGV[0] = primary-key column name (default 'id'; join tables pass 'A')
--   TG_ARGV[1] = comma-separated per-table column denylist (default none)
--
-- The function stays GENERIC: it records a faithful UPDATE (including a
-- deletion-flag flip false->true) with no special-case branch for it — mapping
-- a deletion-flag flip to a semantic "deleted" event is the Phase 14
-- correlation worker's job, not the trigger's (Decision 4).
--
-- Guards (all carried over from the spike):
--   * pg_trigger_depth() > 1            -> recursion guard (DataChangeLog carries
--                                          no trigger, so depth never legitimately
--                                          exceeds 1).
--   * app.skip_audit truthy            -> bulk-import escape hatch (SAF-01).
--   * current_setting(..., true)       -> NULL (never raises) when GUC unset;
--                                          actor/operation/tenant are then NULL,
--                                          row still written (completeness over
--                                          attribution).
--   * IS DISTINCT FROM                 -> NULL-safe UPDATE diff.
--   * no-op UPDATE short-circuit       -> RETURN NULL when the diff is '{}'.
--
-- Size guard (Phase 13 addition over the spike, Open Question 2 / Decision 6):
--   any single captured column whose text byte length exceeds 32768 (32KB) is
--   OMITTED from the diff entirely (value not stored, no crash). A {hash,len}
--   marker is explicitly deferred to Phase 14.
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    ctx_raw   TEXT;
    ctx       JSONB;
    actor_id  TEXT;
    op_id     TEXT;
    tenant_id TEXT;
    pk_col    TEXT;
    pk_val    TEXT;
    old_json  JSONB;
    new_json  JSONB;
    diff      JSONB := '{}'::jsonb;
    col_name  TEXT;
    denylist  TEXT[];
BEGIN
    -- Recursion guard: never cascade (DataChangeLog itself carries no trigger, so depth stays 1).
    IF pg_trigger_depth() > 1 THEN
        RETURN NULL;
    END IF;

    -- Bulk-import escape hatch (SAF-01) — set via SET LOCAL app.skip_audit inside the worker tx.
    IF COALESCE(current_setting('app.skip_audit', true), '') IN ('1', 'true', 'on', 'yes') THEN
        RETURN NULL;
    END IF;

    -- 1. Actor context from the GUC. 2-arg current_setting returns NULL (never raises) when unset.
    ctx_raw := current_setting('app.audit_context', true);
    IF ctx_raw IS NOT NULL AND ctx_raw <> '' THEN
        ctx       := ctx_raw::jsonb;
        actor_id  := ctx->>'userId';
        op_id     := ctx->>'operationId';
        tenant_id := ctx->>'tenantId';
    END IF;

    -- 2. PK column + denylist from the trigger creation args.
    pk_col   := COALESCE(TG_ARGV[0], 'id');
    denylist := string_to_array(COALESCE(TG_ARGV[1], ''), ',');

    -- 3. Changed-columns {old,new} diff via to_jsonb + IS DISTINCT FROM (NULL-safe).
    IF TG_OP = 'INSERT' THEN
        new_json := to_jsonb(NEW);
        pk_val   := new_json->>pk_col;
        FOR col_name IN SELECT key FROM jsonb_each(new_json) LOOP
            IF col_name = ANY(denylist) THEN CONTINUE; END IF;
            -- 32KB per-column size guard: omit oversized values entirely.
            IF octet_length((new_json->col_name)::text) > 32768 THEN CONTINUE; END IF;
            diff := diff || jsonb_build_object(col_name, jsonb_build_object('old', NULL, 'new', new_json->col_name));
        END LOOP;

    ELSIF TG_OP = 'DELETE' THEN
        old_json := to_jsonb(OLD);
        pk_val   := old_json->>pk_col;
        FOR col_name IN SELECT key FROM jsonb_each(old_json) LOOP
            IF col_name = ANY(denylist) THEN CONTINUE; END IF;
            -- 32KB per-column size guard (OLD side for DELETE): omit oversized values entirely.
            IF octet_length((old_json->col_name)::text) > 32768 THEN CONTINUE; END IF;
            diff := diff || jsonb_build_object(col_name, jsonb_build_object('old', old_json->col_name, 'new', NULL));
        END LOOP;

    ELSE  -- UPDATE: only changed columns
        old_json := to_jsonb(OLD);
        new_json := to_jsonb(NEW);
        pk_val   := new_json->>pk_col;
        FOR col_name IN SELECT key FROM jsonb_each(new_json) LOOP
            IF col_name = ANY(denylist) THEN CONTINUE; END IF;
            IF (old_json->col_name) IS DISTINCT FROM (new_json->col_name) THEN
                -- 32KB per-column size guard: if EITHER side exceeds 32KB, omit the column.
                IF octet_length((new_json->col_name)::text) > 32768
                   OR octet_length((old_json->col_name)::text) > 32768 THEN
                    CONTINUE;
                END IF;
                diff := diff || jsonb_build_object(col_name, jsonb_build_object('old', old_json->col_name, 'new', new_json->col_name));
            END IF;
        END LOOP;
        -- Short-circuit a no-op UPDATE (only denylisted/unchanged/oversized columns touched).
        IF diff = '{}'::jsonb THEN
            RETURN NULL;
        END IF;
    END IF;

    INSERT INTO "DataChangeLog"
        ("table", op, pk, changed_cols, actor, operation_id, tenant, txid, ts)
    VALUES (
        TG_TABLE_NAME,
        LEFT(TG_OP, 1),       -- 'I' | 'U' | 'D'
        pk_val,
        diff,
        actor_id,
        op_id,
        tenant_id,
        txid_current(),
        now()
    );

    RETURN NULL;  -- AFTER row trigger: return value is ignored.
END;
$$;
