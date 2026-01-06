# [1.2.0](https://github.com/testplanit/testplanit/compare/cli-v1.1.1...cli-v1.2.0) (2026-01-06)


### Bug Fixes

* **adapter:** enhance URL validation in AzureOpenAIAdapter's testConnection method ([fb3d0fa](https://github.com/testplanit/testplanit/commit/fb3d0fab714f66c81bfb3d747ab9cf94665c7a66))
* **bulk-edit:** increment version number in bulk edit route ([ba93044](https://github.com/testplanit/testplanit/commit/ba93044041037e39b77183d5f670976d2dd222da))
* **bulk-edit:** update state handling in bulk edit route ([18e68c9](https://github.com/testplanit/testplanit/commit/18e68c93b4b9cbb3d78bd19f05c02bc17e092307))
* **Cases, columns:** show grip handle when data table rows are sortable in Cases.tsx ([89bba65](https://github.com/testplanit/testplanit/commit/89bba6563ec9fbb10b6a3fc952f3995e0b466740))
* **columns:** add optional chaining to prevent runtime errors ([2f71454](https://github.com/testplanit/testplanit/commit/2f71454a4a5ec8d72ab19a7ed26ce919bfce831b))
* **columns:** improve error handling in column data processing ([a859481](https://github.com/testplanit/testplanit/commit/a859481cde0be1887eac20fa8b4b8d8c402c8d2b))
* **CustomNode:** remove CustomNode component ([876af42](https://github.com/testplanit/testplanit/commit/876af429d5abbce51f34d4b2e194f2f076c1567e))
* **folders:** Fix the folder issues described in Issue 33 ([#35](https://github.com/testplanit/testplanit/issues/35)) ([f94a1a0](https://github.com/testplanit/testplanit/commit/f94a1a0f9c9e3950fec28a7024f81b32ea3b94c0))
* **JunitTableSection:** update translation key for completed date display ([c474c32](https://github.com/testplanit/testplanit/commit/c474c321f00ccc88fa4ed5009187840cb4c45f69))
* **tags:** implement case-insensitive tag matching and restore soft-deleted tags ([c395d73](https://github.com/testplanit/testplanit/commit/c395d73b7e1ef2406cfaf232b0d73548c12b3722))
* **tags:** update tag handling in CSV import process ([c85328f](https://github.com/testplanit/testplanit/commit/c85328faa92bbd89a650c0e4dded1cb2be5b531c))
* **testResultsParser:** update duration normalization logic to ensure consistent conversion from milliseconds to seconds ([9094504](https://github.com/testplanit/testplanit/commit/9094504fce2cda2119f1ef2ed9bc5761c2cba1be))
* **TestRunPage:** wrap AddTestRunModal in SimpleDndProvider for drag-and-drop context ([f667303](https://github.com/testplanit/testplanit/commit/f6673036c59bc7929a09446b4d96ca5db6e7f5af))
* **tiptap:** prevent rendering of ContentItemMenu when editor lacks plugin support ([d33d52f](https://github.com/testplanit/testplanit/commit/d33d52f38645c2ccb5c6d36df3c86d63f3e5f1e7))
* **tooltip:** update TooltipTrigger components to include type="button" ([d0fb809](https://github.com/testplanit/testplanit/commit/d0fb80906584768da6da81c969ef9c62c7284b0d))
* **translations:** add new translation keys for workflow types and dimensions ([475c5cc](https://github.com/testplanit/testplanit/commit/475c5ccb38187cfa6197b4d109fdc5842351e359))
* **translations:** streamline translation usage across components ([de33bcb](https://github.com/testplanit/testplanit/commit/de33bcb5963118c77bfba0e2534d1db8a6cf73f7))
* **translations:** update error messages and display names for better user experience ([05967df](https://github.com/testplanit/testplanit/commit/05967dfc469947eb1f78818143a0f011a9c6aa0e))
* **translations:** Update related import messages for consistency across test result formats. ([19e69b8](https://github.com/testplanit/testplanit/commit/19e69b86ae2b49fb992f9c4696ddafd4017c372d))
* **translations:** update translation keys and improve localization consistency ([c733c9d](https://github.com/testplanit/testplanit/commit/c733c9db5665de8621b167d752b4bedf02ad30f3))
* **UserProfile:** enhance date formatting logic to include time format ([1f4d45e](https://github.com/testplanit/testplanit/commit/1f4d45ef8d3471cb169217001263c6402b468ae9))


### Features

* **tiptap:** add ContentItemMenu and drag handle functionality ([85d8c4a](https://github.com/testplanit/testplanit/commit/85d8c4a66e623fc89c488ae64989a981472cfdbb))

## [1.1.1](https://github.com/testplanit/testplanit/compare/cli-v1.1.0...cli-v1.1.1) (2025-12-28)

# [1.1.0](https://github.com/testplanit/testplanit/compare/cli-v1.0.2...cli-v1.1.0) (2025-12-19)


### Bug Fixes

* **changesets:** use correct package names in ignore list ([e0a61cb](https://github.com/testplanit/testplanit/commit/e0a61cb4650a2d824071b54bdc8a6114a74cd0ce))
* **ci:** skip postinstall scripts in package release workflow ([4624c92](https://github.com/testplanit/testplanit/commit/4624c92ebdd6de67097ad7f371ac39a236d31735))
* **docker:** add lockfile to testplanit for local Docker builds ([3d1dd94](https://github.com/testplanit/testplanit/commit/3d1dd9475e38184fffbd922f622e0a2ff65f0ded))
* **docker:** resolve lockfile not found error in Docker builds ([f9e48f6](https://github.com/testplanit/testplanit/commit/f9e48f6e74784f53bf4f3fff80360b47f2403804))
* **docker:** use testplanit-specific lockfile instead of monorepo lockfile ([da46c98](https://github.com/testplanit/testplanit/commit/da46c984918b13a01c0711ec6a6b1fabb5ea0898))
* **emailWorker:** update notification handling for SYSTEM_ANNOUNCEMENT ([978c773](https://github.com/testplanit/testplanit/commit/978c7735696b4bd1f95ebf0e5e33ca8cca2a7974))
* **env:** update DATABASE_URL in .env.example for consistency with Docker setup ([28ac66e](https://github.com/testplanit/testplanit/commit/28ac66ee1d757557ee35b36e3b98d22859f73146))
* **env:** update DATABASE_URL in .env.example for Docker compatibility ([398838c](https://github.com/testplanit/testplanit/commit/398838c053ca8be445dcc7fac730b3034637754d))
* **env:** update DATABASE_URL port in .env.example for consistency with Docker setup ([93d6bd9](https://github.com/testplanit/testplanit/commit/93d6bd932f89e0ee238c9ff72f59ef1f771c69c0))


### Features

* **export:** add PDF export functionality ([5a84252](https://github.com/testplanit/testplanit/commit/5a842525927641d04b1327e8812223c7a500e4c2))

## [1.0.2](https://github.com/testplanit/testplanit/compare/cli-v1.0.1...cli-v1.0.2) (2025-12-15)


### Bug Fixes

* **audit-logs:** add new audit actions for API key management ([62bed46](https://github.com/testplanit/testplanit/commit/62bed466997c1e0e5260af70df31257aece605a2))
* **ci:** use PAT token to trigger Docker build workflow ([5f34752](https://github.com/testplanit/testplanit/commit/5f347528f945818ddde652b4873847fa23ac049d))
* **comments:** add milestone support to UserMentionedComments component ([88cf140](https://github.com/testplanit/testplanit/commit/88cf140afd15d25f8a868a5426a3a64a93f4a6e3))
* **dependencies:** update package versions and add new translations ([0d2ce7c](https://github.com/testplanit/testplanit/commit/0d2ce7cda1e2399fe2dc5b742654a032c7c322c5))

## [1.0.1](https://github.com/testplanit/testplanit/compare/cli-v1.0.0...cli-v1.0.1) (2025-12-11)


### Bug Fixes

* **docs:** update CLI installation instructions and enhance notification content ([374bd2e](https://github.com/testplanit/testplanit/commit/374bd2ee7908bfdd64e609f9532a07202c2ccc1d))

# 1.0.0 (2025-12-11)


### Bug Fixes

* **api:** add cache-control headers to prevent stale API responses ([5a8ac7f](https://github.com/testplanit/testplanit/commit/5a8ac7f45400d7250013c03c7f931c6f07db56ac))
* **api:** enhance project access control logic ([6a1548c](https://github.com/testplanit/testplanit/commit/6a1548c8b2bc9c18c4971fb25703aa00e753d839))
* **auditLog:** validate projectId existence before logging and handle non-existent projects ([75e85a8](https://github.com/testplanit/testplanit/commit/75e85a8e194b1316a81eabfaf07528fef1584b3d))
* **auth:** Clarify comments in magic link token hashing logic ([ccb5ee7](https://github.com/testplanit/testplanit/commit/ccb5ee784a7f8558cdb6dee929d173965d4e68de))
* **build:** add auditLogWorker to entry points ([001a432](https://github.com/testplanit/testplanit/commit/001a43233580e90dfc5e8e88e9841b635e5d67e9))
* **Cases:** optimize total case count calculation for folder view ([255ca99](https://github.com/testplanit/testplanit/commit/255ca99a2584c2c8829b81e0daa870cfe0c59b62))
* **ci:** improve version extraction and Docker build trigger logic in semantic-release workflow ([b873eaa](https://github.com/testplanit/testplanit/commit/b873eaa68ead89e5e14c0a241affb54a938b498e))
* **Dockerfile:** Ensure translation files are copied to both reference and distribution directories for email worker ([6fe3cf4](https://github.com/testplanit/testplanit/commit/6fe3cf472ba27e7f2223ffb32bbc07c4b2cc1c03))
* **docker:** Replace postgresql15-client with postgresql-client in Dockerfile for compatibility ([deb29ec](https://github.com/testplanit/testplanit/commit/deb29ecffdb0faba1afeae6d269fd5642da4f249))
* **docs:** update data-domain in Docusaurus config and improve form handling in TestResultsImportDialog ([97f2823](https://github.com/testplanit/testplanit/commit/97f2823923ae00c13033e83d6c1911722a53b7c3))
* Improve days difference calculation for milestone notifications ([2954364](https://github.com/testplanit/testplanit/commit/29543646b65784a4e474c40419924ba067178e5c))
* Invalidate cached Prisma clients when tenant credentials change ([437c8dc](https://github.com/testplanit/testplanit/commit/437c8dcfa17851f9c68ef929473c2ba47c5ff0c5))
* **issues:** add status and priority filters to issues page ([182be68](https://github.com/testplanit/testplanit/commit/182be680cf33cfbeb8bacf57d72189bde79c192e))
* **issues:** simplify access control logic and remove redundant project filter ([86d6632](https://github.com/testplanit/testplanit/commit/86d663236a9e19e0c1a0b00dd679bb93d72d640e))
* **layout:** Refactor storage mode detection logic for clarity ([3c060e5](https://github.com/testplanit/testplanit/commit/3c060e56d73f1a8f376d29aab42fa04c998032c5))
* **milestones:** replace watch with useWatch in MilestoneFormDialog and AddMilestoneModal ([7a986a5](https://github.com/testplanit/testplanit/commit/7a986a50b462c40206b1d9e50d5accf5d673f406))
* **permissions:** enhance access control for notifications and user data retrieval ([d9037ec](https://github.com/testplanit/testplanit/commit/d9037ec4abe22d33ca468ce5705eb46f889ca94c))
* **permissions:** enhance project access control logic ([8151e83](https://github.com/testplanit/testplanit/commit/8151e83c72a3a2c91ed455a794b86ab4c50f8345))
* **permissions:** improve access control checks and notification handling ([c7984c7](https://github.com/testplanit/testplanit/commit/c7984c7b7b11e8863a43785243a25176e2364121))
* **release:** correct release-please package path configuration ([93610d3](https://github.com/testplanit/testplanit/commit/93610d3cd437ccb7439f9490fb392f1f39e54bb6))
* **release:** exclude component from tag names ([02c404b](https://github.com/testplanit/testplanit/commit/02c404b8d85dbda088bf5bf68511b8fd76710109))
* **release:** remove duplicate release creation from workflow ([1e8c5a7](https://github.com/testplanit/testplanit/commit/1e8c5a794d70149dd235a4c8f167f02222b65918))
* **release:** simplify release-please config to fix PR titles ([d72bd34](https://github.com/testplanit/testplanit/commit/d72bd34fe0fc208d378c6e107611155f8f1409ec))
* **release:** Update GitHub CLI commands for consistency ([94e252b](https://github.com/testplanit/testplanit/commit/94e252b7119f8ad97f33c77647045cfcccdb1948))
* **release:** update lowercase repo name setting in workflow ([edb0a8e](https://github.com/testplanit/testplanit/commit/edb0a8e74a5ef0bbcd30846f0f91157c6edaee67))
* **release:** Update lowercase repo name setting in workflows ([43bf90b](https://github.com/testplanit/testplanit/commit/43bf90bcd936218d18cc874b290f797a2e6d854e))
* **release:** use PAT for release-please workflow ([8aaa2e5](https://github.com/testplanit/testplanit/commit/8aaa2e55b463b70034996cb4fbda58949e37aee9))
* **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/testplanit/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))
* **tags:** enhance project access logic to include PROJECTADMIN role ([7972ac1](https://github.com/testplanit/testplanit/commit/7972ac1abceea74c0b2f1cee46120c08cf1677fa))
* **tags:** simplify access control logic ([3945a39](https://github.com/testplanit/testplanit/commit/3945a39936f46ef22ada05fb34efe31d823280c7))
* **testCase:** sync case field values on details page ([1fc701a](https://github.com/testplanit/testplanit/commit/1fc701a526021901d62a184c6184b2af3a9786f6))
* **users:** Disable API toggle for ADMIN access level ([29f3df9](https://github.com/testplanit/testplanit/commit/29f3df9561fcdad5174355f4179076151c46eb1f))
* **workers:** testmoImportWorker was using old generateRandomPassword code. ([be87543](https://github.com/testplanit/testplanit/commit/be87543b9b7f97f1b6dc1330dd4ee9999a3fbed7))


### Features

* add audit logging for compliance and traceability ([#18](https://github.com/testplanit/testplanit/issues/18)) ([7695a46](https://github.com/testplanit/testplanit/commit/7695a461cb9129cfc0c62b75638dff71fa39064d))
* add CLI tool for test result imports and API token authentication ([#22](https://github.com/testplanit/testplanit/issues/22)) ([4c889c3](https://github.com/testplanit/testplanit/commit/4c889c385b964a82b936022eb045a40bd2cf78dc))
* **api:** Enhance API documentation and integrate Swagger UI ([#6](https://github.com/testplanit/testplanit/issues/6)) ([8b6d6b2](https://github.com/testplanit/testplanit/commit/8b6d6b218d9d92277aee963ae43a83da4b83fa6d))
* **api:** Implement external API request detection and enhance JWT handling ([6924a79](https://github.com/testplanit/testplanit/commit/6924a79b093ec7f133fc6c0c5969c3f96c6e9f34))
* **auth:** add two-factor authentication ([#19](https://github.com/testplanit/testplanit/issues/19)) ([662ce57](https://github.com/testplanit/testplanit/commit/662ce5742f659bbeb84f6eab1e8e3768db31b193))
* **auth:** Hash magic link token before storing in database ([0d7ce6e](https://github.com/testplanit/testplanit/commit/0d7ce6eee218016f85029d1433d5b0302aec3277))
* bump version to 0.3.0 and add Magic Select announcement ([d98b977](https://github.com/testplanit/testplanit/commit/d98b977115d8fe2634bcf51bafc5ac71bc4c1ecf))
* **elasticsearch:** Add multi-tenant mode support in ElasticsearchAdmin ([1003b40](https://github.com/testplanit/testplanit/commit/1003b40259ce51457f6ce46f018dcf31648f1166))
* **email:** Add baseUrl to notification and digest email data for tenant-specific URLs ([7474df6](https://github.com/testplanit/testplanit/commit/7474df6c90eff155cf2485deb4088cb9100b7f09))
* Enhance Elasticsearch index filtering for multi-tenant support ([63662b6](https://github.com/testplanit/testplanit/commit/63662b6b0e5c1d0bf98252dc4b82531e785256ee))
* **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/testplanit/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
* **import:** expand automated test results import for JUnit, TestNG, NUnit, xUnit, MSTest, Mocha, and Cucumber ([#20](https://github.com/testplanit/testplanit/issues/20)) ([a7856cd](https://github.com/testplanit/testplanit/commit/a7856cde96c0d3482f78469dfb720beb86e7196d))
* Milestone auto-completion and due date notifications ([#10](https://github.com/testplanit/testplanit/issues/10)) ([665b5a2](https://github.com/testplanit/testplanit/commit/665b5a208090246f7f75eccf54ae79451ea9450e))
* **milestones:** add comments support ([#15](https://github.com/testplanit/testplanit/issues/15)) ([a5e60b2](https://github.com/testplanit/testplanit/commit/a5e60b2d6a150e0a618d3f0f93e819d9c7aebf1c))
* **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/testplanit/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))
* **multiTenant:** Add baseUrl to TenantConfig and update email worker to utilize tenant-specific base URLs for notifications ([28dc26e](https://github.com/testplanit/testplanit/commit/28dc26eac1675f23f7638bcc3b169fc7ff713044))
* **multiTenant:** Enhance storage mode detection and add baseUrl to tenant configurations ([60af2f4](https://github.com/testplanit/testplanit/commit/60af2f4a31d38959eb2451cf8ebb333fa7f3d8e2))
* **multiTenant:** Update tenant configuration to include baseUrl in environment variable format ([f7be7de](https://github.com/testplanit/testplanit/commit/f7be7dec4964a820dd37cc4bc684ea83dd89cf8f))
* **permissions:** Enhance access control for project roles ([39292f6](https://github.com/testplanit/testplanit/commit/39292f6dc34f9f72b9b3fe301544ad4bd636262a))
* **permissions:** Expand access control for project roles ([429fd42](https://github.com/testplanit/testplanit/commit/429fd426f1387d01c176301caaef20beab2b935c))
* **ProjectRepository:** implement auto-paging for selected test case in run mode ([e8d638c](https://github.com/testplanit/testplanit/commit/e8d638c870bdfe2a6a93d7a3430fd95ef8bc7fd6))
* **translations:** Add "required for Admin" translations in English, Spanish, and French ([356b392](https://github.com/testplanit/testplanit/commit/356b3924915d33d16435a63bd3db98ecbbf9eb53))
