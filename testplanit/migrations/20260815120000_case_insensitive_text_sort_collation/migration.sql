-- Re-collate user-facing display-name columns with the ICU root collation so
-- ORDER BY returns dictionary order (a A b B ...) on every server. The Docker
-- images run postgres:18-alpine, whose musl libc cannot collate locales: even
-- though the database reports en_US.utf8, every text sort comes back in byte
-- order — all capitals before all lowercase. ICU ships in those images (and in
-- every mainstream Postgres build), so collating the sorted columns themselves
-- fixes ordering for ORM queries and raw SQL alike, with no per-query changes.
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
            ('ApiToken', 'name'),
            ('AuditLog', 'userName'),
            ('AuditLog', 'userEmail'),
            ('CaseExportTemplate', 'name'),
            ('CaseFields', 'displayName'),
            ('CodeRepository', 'name'),
            ('ConfigCategories', 'name'),
            ('ConfigVariants', 'name'),
            ('Configurations', 'name'),
            ('DataSet', 'name'),
            ('FieldIcon', 'name'),
            ('FieldOptions', 'name'),
            ('Groups', 'name'),
            ('Integration', 'name'),
            ('Issue', 'name'),
            ('Issue', 'title'),
            ('LlmIntegration', 'name'),
            ('MilestoneTypes', 'name'),
            ('Milestones', 'name'),
            ('Projects', 'name'),
            ('Projects', 'key'),
            ('PromptConfig', 'name'),
            ('RepositoryCases', 'name'),
            ('RepositoryFolders', 'name'),
            ('ResultFields', 'displayName'),
            ('Roles', 'name'),
            ('ScimToken', 'name'),
            ('Sessions', 'name'),
            ('SharedStepGroup', 'name'),
            ('SsoProvider', 'name'),
            ('Status', 'name'),
            ('Tags', 'name'),
            ('Templates', 'templateName'),
            ('TestCaseParameter', 'name'),
            ('TestRuns', 'name'),
            ('User', 'name'),
            ('User', 'email'),
            ('WebhookConfig', 'name'),
            ('Workflows', 'name')
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
