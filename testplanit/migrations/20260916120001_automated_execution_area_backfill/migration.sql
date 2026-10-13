-- Every role keeps the automation rights it effectively had before the area
-- existed: whoever could record results could also trigger automation.
-- Kept in its own migration so the new enum value is committed before use.
INSERT INTO "RolePermission" ("roleId", "area", "canAddEdit", "canDelete", "canClose", "canReadSensitive", "canApprove")
SELECT rp."roleId", 'AutomatedExecution', rp."canAddEdit", false, false, false, false
FROM "RolePermission" rp
WHERE rp."area" = 'TestRunResults'
ON CONFLICT ("roleId", "area") DO NOTHING;
