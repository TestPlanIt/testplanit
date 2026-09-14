-- A project can connect more than one application repository for Impact.
DROP INDEX "ProjectCodeRepositoryConfig_projectId_purpose_key";

CREATE UNIQUE INDEX "ProjectCodeRepositoryConfig_projectId_purpose_repositoryId_key" ON "ProjectCodeRepositoryConfig"("projectId", "purpose", "repositoryId");
