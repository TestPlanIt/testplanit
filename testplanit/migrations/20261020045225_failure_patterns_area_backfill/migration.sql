-- Every role keeps the triage rights it effectively had before the area
-- existed: whoever could add/edit test runs could set root causes, resolve
-- patterns and quarantine cases. Kept in its own migration so the new enum
-- value is committed before use.
INSERT INTO "RolePermission" ("roleId", "area", "canAddEdit", "canDelete", "canClose", "canReadSensitive", "canApprove")
SELECT rp."roleId", 'FailurePatterns', rp."canAddEdit", false, false, false, false
FROM "RolePermission" rp
WHERE rp."area" = 'TestRuns'
ON CONFLICT ("roleId", "area") DO NOTHING;
