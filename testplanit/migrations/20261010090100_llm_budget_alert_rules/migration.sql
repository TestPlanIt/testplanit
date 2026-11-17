-- Keep the previous behaviour for installs that already track a budget:
-- one system alert per former threshold (80%, 90%, 100%), created by the
-- longest-standing administrator and subscribed by every active one.
-- New installs, and installs without a budget, start with no rules.
-- (Separate migration: the enum value added before it cannot be used in
-- the same transaction.)

DO $$
DECLARE
  creator TEXT;
  threshold INTEGER;
  rule_id INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LlmProviderConfig" WHERE "monthlyBudget" > 0
  ) THEN
    RETURN;
  END IF;

  SELECT id INTO creator
  FROM "User"
  WHERE access = 'ADMIN' AND "isActive" = true AND "isDeleted" = false
  ORDER BY "createdAt" ASC, id ASC
  LIMIT 1;
  IF creator IS NULL THEN
    RETURN;
  END IF;

  FOREACH threshold IN ARRAY ARRAY[80, 90, 100] LOOP
    INSERT INTO "AlertRule" (
      "name", "metric", "scopeType", "thresholdValue", "cooldownMinutes",
      "createdAt", "updatedAt", "createdById"
    ) VALUES (
      'AI budget ' || threshold || '% used', 'LLM_BUDGET_USED', 'PROJECT',
      threshold, 0, NOW(), NOW(), creator
    )
    RETURNING id INTO rule_id;

    INSERT INTO "AlertSubscriber" ("ruleId", "userId", "createdAt")
    SELECT rule_id, u.id, NOW()
    FROM "User" u
    WHERE u.access = 'ADMIN' AND u."isActive" = true AND u."isDeleted" = false;
  END LOOP;
END $$;
