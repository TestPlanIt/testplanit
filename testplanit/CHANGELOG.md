# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.29](https://github.com/testplanit/testplanit/compare/v0.1.28...v0.1.29) (2025-12-04)

### [0.1.28](https://github.com/testplanit/testplanit/compare/v0.1.27...v0.1.28) (2025-12-04)


### Bug Fixes

* **users:** Disable API toggle for ADMIN access level ([29f3df9](https://github.com/testplanit/testplanit/commit/29f3df9561fcdad5174355f4179076151c46eb1f))

### [0.1.27](https://github.com/testplanit/testplanit/compare/v0.1.26...v0.1.27) (2025-12-04)


### Bug Fixes

* **release:** Update GitHub CLI commands for consistency ([94e252b](https://github.com/testplanit/testplanit/commit/94e252b7119f8ad97f33c77647045cfcccdb1948))

### [0.1.26](https://github.com/testplanit/testplanit/compare/v0.1.25...v0.1.26) (2025-12-04)


### Bug Fixes

* **release:** Update lowercase repo name setting in workflows ([43bf90b](https://github.com/testplanit/testplanit/commit/43bf90bcd936218d18cc874b290f797a2e6d854e))

### [0.1.25](https://github.com/testplanit/testplanit/compare/v0.1.24...v0.1.25) (2025-12-04)


### Code Refactoring

* **prisma-middleware:** Remove bulk operations logging test ([c3e0f71](https://github.com/testplanit/testplanit/commit/c3e0f710646871e56497c8991e2cb9a1c47a018f))

### [0.1.24](https://github.com/testplanit/testplanit/compare/v0.1.23...v0.1.24) (2025-12-04)


### Features

* Milestone auto-completion and due date notifications ([#10](https://github.com/testplanit/testplanit/issues/10)) ([665b5a2](https://github.com/testplanit/testplanit/commit/665b5a208090246f7f75eccf54ae79451ea9450e))


### Bug Fixes

* Improve days difference calculation for milestone notifications ([2954364](https://github.com/testplanit/testplanit/commit/29543646b65784a4e474c40419924ba067178e5c))


### Code Refactoring

* Remove console.log statements for cleaner code ([280e68d](https://github.com/testplanit/testplanit/commit/280e68d671446231a66561a36e0b4193cf656170))
* **reports:** Remove reportTypes prop from ReportBuilder and fetch report types internally ([c29b5d0](https://github.com/testplanit/testplanit/commit/c29b5d0a8d081671b82d4bf2fe51c3791a24ffb4))

### [0.1.23](https://github.com///compare/v0.1.22...v0.1.23) (2025-12-04)


### Features

* **multiTenant:** Enhance storage mode detection and add baseUrl to tenant configurations 60af2f4
* **multiTenant:** Update tenant configuration to include baseUrl in environment variable format f7be7de


### Bug Fixes

* **layout:** Refactor storage mode detection logic for clarity 3c060e5

### [0.1.22](https://github.com/testplanit/testplanit/compare/v0.1.21...v0.1.22) (2025-12-04)


### Features

* **email:** Add baseUrl to notification and digest email data for tenant-specific URLs ([7474df6](https://github.com/testplanit/testplanit/commit/7474df6c90eff155cf2485deb4088cb9100b7f09))

### [0.1.21](https://github.com/testplanit/testplanit/compare/v0.1.20...v0.1.21) (2025-12-04)


### Features

* **multiTenant:** Add baseUrl to TenantConfig and update email worker to utilize tenant-specific base URLs for notifications ([28dc26e](https://github.com/testplanit/testplanit/commit/28dc26eac1675f23f7638bcc3b169fc7ff713044))

### [0.1.20](https://github.com/testplanit/testplanit/compare/v0.1.19...v0.1.20) (2025-12-04)


### Bug Fixes

* **Dockerfile:** Ensure translation files are copied to both reference and distribution directories for email worker ([6fe3cf4](https://github.com/testplanit/testplanit/commit/6fe3cf472ba27e7f2223ffb32bbc07c4b2cc1c03))

### [0.1.19](https://github.com/testplanit/testplanit/compare/v0.1.18...v0.1.19) (2025-12-04)


### Features

* **translations:** Add "required for Admin" translations in English, Spanish, and French ([356b392](https://github.com/testplanit/testplanit/commit/356b3924915d33d16435a63bd3db98ecbbf9eb53))

### [0.1.18](https://github.com/testplanit/testplanit/compare/v0.1.17...v0.1.18) (2025-12-04)


### Code Refactoring

* **users:** Simplify access field watching in user modals ([ae3f2e4](https://github.com/testplanit/testplanit/commit/ae3f2e41b201421e87ca1d4515a819e5cf4b0331))

### [0.1.17](https://github.com/testplanit/testplanit/compare/v0.1.16...v0.1.17) (2025-12-04)

### [0.1.16](https://github.com/testplanit/testplanit/compare/v0.1.15...v0.1.16) (2025-12-04)


### Features

* **api:** Implement external API request detection and enhance JWT handling ([6924a79](https://github.com/testplanit/testplanit/commit/6924a79b093ec7f133fc6c0c5969c3f96c6e9f34))

### [0.1.14](https://github.com/testplanit/testplanit/compare/v0.1.13...v0.1.14) (2025-12-03)


### Bug Fixes

* **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/testplanit/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))

### [0.1.15](https://github.com/testplanit/testplanit/compare/v0.1.13...v0.1.15) (2025-12-04)


### Features

* **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/testplanit/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
* **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/testplanit/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))


### Bug Fixes

* **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/testplanit/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))

### [0.1.14](https://github.com/testplanit/testplanit/compare/v0.1.13...v0.1.14) (2025-12-04)


### Features

* **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/testplanit/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
* **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/testplanit/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))

### [0.1.13](https://github.com/testplanit/testplanit/compare/v0.1.12...v0.1.13) (2025-12-03)


### Features

* **api:** Enhance API documentation and integrate Swagger UI ([#6](https://github.com/testplanit/testplanit/issues/6)) ([8b6d6b2](https://github.com/testplanit/testplanit/commit/8b6d6b218d9d92277aee963ae43a83da4b83fa6d))

### [0.1.12](https://github.com/testplanit/testplanit/compare/v0.1.11...v0.1.12) (2025-12-02)


### Features

* **elasticsearch:** Add multi-tenant mode support in ElasticsearchAdmin ([1003b40](https://github.com/testplanit/testplanit/commit/1003b40259ce51457f6ce46f018dcf31648f1166))

### [0.1.11](https://github.com/testplanit/testplanit/compare/v0.1.10...v0.1.11) (2025-12-02)


### Bug Fixes

* Invalidate cached Prisma clients when tenant credentials change ([437c8dc](https://github.com/testplanit/testplanit/commit/437c8dcfa17851f9c68ef929473c2ba47c5ff0c5))

### [0.1.10](https://github.com/testplanit/testplanit/compare/v0.1.9...v0.1.10) (2025-12-02)


### Bug Fixes

* **auth:** Clarify comments in magic link token hashing logic ([ccb5ee7](https://github.com/testplanit/testplanit/commit/ccb5ee784a7f8558cdb6dee929d173965d4e68de))

### [0.1.9](https://github.com/testplanit/testplanit/compare/v0.1.8...v0.1.9) (2025-12-02)


### Features

* **auth:** Hash magic link token before storing in database ([0d7ce6e](https://github.com/testplanit/testplanit/commit/0d7ce6eee218016f85029d1433d5b0302aec3277))

### [0.1.8](https://github.com/testplanit/testplanit/compare/v0.1.7...v0.1.8) (2025-12-02)


### Features

* Enhance Elasticsearch index filtering for multi-tenant support ([63662b6](https://github.com/testplanit/testplanit/commit/63662b6b0e5c1d0bf98252dc4b82531e785256ee))

### [0.1.7](https://github.com/testplanit/testplanit/compare/v0.1.6...v0.1.7) (2025-12-02)

### [0.1.6](https://github.com/testplanit/testplanit/compare/v0.1.5...v0.1.6) (2025-12-01)

### [0.1.5](https://github.com/testplanit/testplanit/compare/v0.1.4...v0.1.5) (2025-12-01)

### [0.1.4](https://github.com/testplanit/testplanit/compare/v0.1.3...v0.1.4) (2025-12-01)

### [0.1.3](https://github.com/testplanit/testplanit/compare/v0.1.1...v0.1.3) (2025-12-01)

### [0.1.2](https://github.com/testplanit/testplanit/compare/v0.1.1...v0.1.2) (2025-12-01)

### [0.1.1](https://github.com/testplanit/testplanit/compare/v0.1.0...v0.1.1) (2025-12-01)

## [0.1.0](https://github.com/testplanit/testplanit/compare/v0.0.18...v0.1.0) (2025-11-30)

### [0.0.18](https://github.com/testplanit/testplanit/compare/v0.0.16...v0.0.18) (2025-11-30)

### [0.0.17](https://github.com/testplanit/testplanit/compare/v0.0.16...v0.0.17) (2025-11-30)

### [0.0.16](https://github.com/testplanit/testplanit/compare/v0.0.15...v0.0.16) (2025-11-30)


### Bug Fixes

* **release:** update lowercase repo name setting in workflow ([edb0a8e](https://github.com/testplanit/testplanit/commit/edb0a8e74a5ef0bbcd30846f0f91157c6edaee67))


### [0.0.15](https://github.com/testplanit/testplanit/compare/v0.0.13...v0.0.15) (2025-11-30)

### [0.0.14](https://github.com/testplanit/testplanit/compare/v0.0.13...v0.0.14) (2025-11-30)

### [0.0.13](https://github.com/testplanit/testplanit/compare/v0.0.12...v0.0.13) (2025-11-30)

### [0.0.12](https://github.com/testplanit/testplanit/compare/v0.0.11...v0.0.12) (2025-11-29)

### [0.0.11](https://github.com/testplanit/testplanit/compare/v0.0.10...v0.0.11) (2025-11-29)

### [0.0.10](https://github.com/testplanit/testplanit/compare/v0.0.9...v0.0.10) (2025-11-29)

### [0.0.9](https://github.com/testplanit/testplanit/compare/v0.0.8...v0.0.9) (2025-11-29)

### [0.0.8](https://github.com/testplanit/testplanit/compare/v0.0.7...v0.0.8) (2025-11-29)

### [0.0.7](https://github.com/testplanit/testplanit/compare/v0.0.6...v0.0.7) (2025-11-29)

### [0.0.6](https://github.com/testplanit/testplanit/compare/v0.0.5...v0.0.6) (2025-11-29)

### [0.0.5](https://github.com/testplanit/testplanit/compare/v0.0.4...v0.0.5) (2025-11-29)

### [0.0.4](https://github.com/testplanit/testplanit/compare/v0.0.3...v0.0.4) (2025-11-29)
