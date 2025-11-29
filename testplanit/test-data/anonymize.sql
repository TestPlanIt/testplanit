-- Simple SQL anonymization script for TestPlanit
-- Just run this directly on your test database

BEGIN;

-- 1. Anonymize User emails and names (keep admin for testing)
UPDATE "User"
SET email = 'user' || SUBSTRING(id, 1, 8) || '@test.local',
    name = 'Test User ' || SUBSTRING(id, 1, 8),
    "emailVerifToken" = NULL,
    "emailTokenExpires" = NULL,
    "externalId" = NULL
WHERE email NOT LIKE '%admin%';

-- 2. Clear OAuth tokens
UPDATE "Account"
SET refresh_token = NULL,
    access_token = NULL,
    id_token = NULL;

-- 3. Clear integration credentials
UPDATE "Integration"
SET credentials = '{"removed": true}'::json,
    settings = '{}'::json;

UPDATE "UserIntegrationAuth"
SET "accessToken" = NULL,
    "refreshToken" = NULL;

-- 4. Anonymize project names
UPDATE "Projects"
SET name = 'Test Project ' || id;

-- 5. Anonymize test cases
UPDATE "RepositoryCases"
SET name = 'Test Case #' || id;

-- 6. Anonymize sessions
UPDATE "Sessions"
SET name = 'Session #' || id;

-- 7. Anonymize test runs
UPDATE "TestRuns"
SET name = 'Test Run #' || id;

-- 8. Anonymize milestones
UPDATE "Milestones"
SET name = 'Milestone ' || id,
    note = NULL;

-- 9. Anonymize repository folders
UPDATE "RepositoryFolders"
SET name = CASE
    WHEN "parentId" IS NULL THEN 'Root Folder ' || id
    ELSE 'Folder ' || id
    END;

-- 10. Anonymize issues
UPDATE "Issue"
SET title = 'Issue #' || id,
    description = 'Test issue description',
    name = 'ISSUE-' || id;

-- 11. Clear all custom field values (they may contain customer data)
UPDATE "CaseFieldValues"
SET value = '{"type":"doc","content":[{"type":"paragraph","attrs":{"textAlign":"left"}}]}'::jsonb
WHERE value IS NOT NULL;

UPDATE "ResultFieldValues"
SET value = '{"test":"data"}'::jsonb
WHERE value IS NOT NULL;

UPDATE "SessionFieldValues"
SET value = '{"test":"data"}'::jsonb
WHERE value IS NOT NULL;

-- 12. Anonymize attachments
UPDATE "Attachments"
SET url = 'https://test-bucket.s3.amazonaws.com/test/' || id || '.pdf',
    name = 'test_file_' || id || '.pdf',
    note = NULL;

-- 13. Anonymize comments
UPDATE "Comment"
SET content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test comment"}]}]}'::jsonb;

-- 14. Anonymize tags
UPDATE "Tags"
SET name = 'Tag ' || id;

-- 15. Anonymize test case steps in RepositoryCaseVersions
UPDATE "RepositoryCaseVersions"
SET steps = '[{"order":1,"description":"Test step","expectedResult":"Expected result"}]'::jsonb
WHERE steps IS NOT NULL;

-- 16. Anonymize Steps table (actual test case steps)
UPDATE "Steps"
SET step = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test step content"}]}]}'::jsonb,
    "expectedResult" = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Expected result"}]}]}'::jsonb
WHERE step IS NOT NULL OR "expectedResult" IS NOT NULL;

-- 17. Anonymize SharedStepItem (shared steps)
UPDATE "SharedStepItem"
SET step = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Shared step content"}]}]}'::jsonb,
    "expectedResult" = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Expected result"}]}]}'::jsonb;

-- 18. Anonymize JUnitTestStep
UPDATE "JUnitTestStep"
SET name = 'JUnit Step ' || id,
    content = 'Test step content';

-- 19. Clear test run step results that may contain customer data
UPDATE "TestRunStepResults"
SET notes = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Test note"}]}]}'::jsonb,
    evidence = NULL
WHERE notes IS NOT NULL OR evidence IS NOT NULL;

-- 20. Anonymize Groups (may contain customer org names)
UPDATE "Groups"
SET name = 'Test Group ' || id;

-- 21. Anonymize SharedStepGroup names
UPDATE "SharedStepGroup"
SET name = 'Shared Step Group ' || id;

-- 22. Anonymize Configurations
UPDATE "Configurations"
SET name = 'Test Config ' || id;

-- 23. Anonymize MilestoneTypes (may be customer-specific)
UPDATE "MilestoneTypes"
SET name = 'Milestone Type ' || id;

-- 24. Anonymize FieldOptions (custom field options)
UPDATE "FieldOptions"
SET name = 'Option ' || id;

-- 25. Anonymize LlmIntegration names
UPDATE "LlmIntegration"
SET name = 'LLM Integration ' || id;

-- 26. Anonymize SsoProvider names (keep type recognizable)
UPDATE "SsoProvider"
SET name = type::text || ' Provider ' || id;

-- NextAuth sessions - table might not exist
-- DELETE FROM "Session";

COMMIT;

SELECT 'Anonymization complete!' as status;