-- External milestone identity becomes per-project: the same tracker
-- artifact (Jira version/sprint) may be tracked independently by several
-- TestPlanIt projects, each with its own Milestones row. Widening the
-- unique constraint cannot conflict with existing data.
DROP INDEX "Milestones_externalId_integrationId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Milestones_externalId_integrationId_projectId_key" ON "Milestones"("externalId", "integrationId", "projectId");
