-- Extend the ICU display-column collation to the three Issue columns the
-- requirements list can now sort on. `20260815120000_case_insensitive_text_sort_collation`
-- re-collated the display-NAME columns of the day, which is why Issue.name and
-- Issue.title already sort correctly; priority/status/externalStatus were not
-- sortable then and kept the database's own collation.
--
-- Two orderings diverge from them today. On the shipped postgres:18-alpine
-- image, musl libc cannot collate locales, so these columns sort in byte order
-- (all capitals before all lowercase) — the exact defect the August migration
-- fixed for display names. On a glibc server they sort in libc's en_US order,
-- which places leading punctuation differently from ICU:
--
--   libc en_US.utf8 : [Blocked] | critical | Done | In Progress | (none) | ...
--   und-x-icu       : (none) | [Blocked] | critical | Done | In Progress | ...
--
-- The second ordering is the one the browser produces: the requirements list
-- sorts client-side below the lazy threshold (String.prototype.localeCompare,
-- ICU) and server-side above it, so without this the SAME project orders one
-- way at 499 requirements and another at 501. Tracker vocabularies are
-- free-form — Jira priorities are per-project configurable — so values like
-- "(none)" or "[Blocked]" are ordinary, not contrived.
--
-- Builds compiled without ICU have no "und-x-icu" collation; they are skipped
-- and keep their current ordering. A same-type ALTER rewrites no table data —
-- only indexes containing a re-collated column are rebuilt.
DO $$
DECLARE
    target RECORD;
    coltype TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_collation WHERE collname = 'und-x-icu') THEN
        RAISE NOTICE 'ICU collation "und-x-icu" is unavailable in this build; keeping libc collation';
        RETURN;
    END IF;

    FOR target IN
        SELECT * FROM (VALUES
            ('Issue', 'priority'),
            ('Issue', 'status'),
            ('Issue', 'externalStatus')
        ) AS v(tbl, col)
    LOOP
        -- Preserve the exact column type (text vs varchar(n)); only the
        -- collation changes.
        SELECT format_type(a.atttypid, a.atttypmod) INTO coltype
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = target.tbl
          AND a.attname = target.col
          AND NOT a.attisdropped;

        IF coltype IS NULL THEN
            RAISE EXCEPTION 'column %.% not found', target.tbl, target.col;
        END IF;

        EXECUTE format(
            'ALTER TABLE public.%I ALTER COLUMN %I TYPE %s COLLATE "und-x-icu"',
            target.tbl, target.col, coltype
        );
    END LOOP;
END $$;
