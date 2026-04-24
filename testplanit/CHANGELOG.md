## [0.22.11](https://github.com/TestPlanIt/testplanit/compare/v0.22.10...v0.22.11) (2026-04-24)

### Bug Fixes

* **scheduler:** add require.main guard so smoke-test require() doesn't run scheduling ([#241](https://github.com/TestPlanIt/testplanit/issues/241)) ([c230dc8](https://github.com/TestPlanIt/testplanit/commit/c230dc8f99e5c75069e924268ec38f20059bce5e)), closes [#237](https://github.com/TestPlanIt/testplanit/issues/237)

## [0.22.10](https://github.com/TestPlanIt/testplanit/compare/v0.22.9...v0.22.10) (2026-04-24)

### Bug Fixes

* **workers:** guard generateFromUrlWorker + stub env in smoke test ([#240](https://github.com/TestPlanIt/testplanit/issues/240)) ([3e2db54](https://github.com/TestPlanIt/testplanit/commit/3e2db549c54107e4028a080a44aef6fb17a05756)), closes [#237](https://github.com/TestPlanIt/testplanit/issues/237)

## [0.22.9](https://github.com/TestPlanIt/testplanit/compare/v0.22.8...v0.22.9) (2026-04-23)

### Bug Fixes

* **workers:** use require.main === module guard so require() doesn't start workers ([#239](https://github.com/TestPlanIt/testplanit/issues/239)) ([900ad63](https://github.com/TestPlanIt/testplanit/commit/900ad630dceb56e502ad1e8d99e9d7066a3a4c0f)), closes [#237](https://github.com/TestPlanIt/testplanit/issues/237)

## [0.22.8](https://github.com/TestPlanIt/testplanit/compare/v0.22.7...v0.22.8) (2026-04-23)

### Bug Fixes

* **cases:** resolve descendant cases server-side to avoid HTTP 414 on deep folders ([#236](https://github.com/TestPlanIt/testplanit/issues/236)) ([563deb4](https://github.com/TestPlanIt/testplanit/commit/563deb46cb5ba4a79c4d10690b23713b994a6434))

## [0.22.7](https://github.com/TestPlanIt/testplanit/compare/v0.22.6...v0.22.7) (2026-04-22)

### Bug Fixes

* **workers:** lazy-load next/headers to unblock worker startup ([c804cac](https://github.com/TestPlanIt/testplanit/commit/c804cacefff88ef180de6e887172d9ebfd8356ab))

## [0.22.6](https://github.com/TestPlanIt/testplanit/compare/v0.22.5...v0.22.6) (2026-04-22)

### Enhancements

* **audit:** Implement audit log gaps ([#231](https://github.com/TestPlanIt/testplanit/issues/231)) ([2485e38](https://github.com/TestPlanIt/testplanit/commit/2485e388e9d12485b7b8a77cca849e701af30caa)), closes [#1](https://github.com/TestPlanIt/testplanit/issues/1) [#2](https://github.com/TestPlanIt/testplanit/issues/2) [SC#4](https://github.com/TestPlanIt/SC/issues/4) [SC#4](https://github.com/TestPlanIt/SC/issues/4)

## [0.22.5](https://github.com/TestPlanIt/testplanit/compare/v0.22.4...v0.22.5) (2026-04-22)

### Bug Fixes

* **data-import:** Fix/testmo import fixes ([#230](https://github.com/TestPlanIt/testplanit/issues/230)) ([f0cafc9](https://github.com/TestPlanIt/testplanit/commit/f0cafc939096bf29067c4043d90a7d3265a04c61))

## [0.22.4](https://github.com/TestPlanIt/testplanit/compare/v0.22.3...v0.22.4) (2026-04-21)

### Bug Fixes

* **tenants:** Fix/tenant aware worker encryption key ([#229](https://github.com/TestPlanIt/testplanit/issues/229)) ([a835f5a](https://github.com/TestPlanIt/testplanit/commit/a835f5afa6517855caa5fac6b5f3f11602351f55))

## [0.22.3](https://github.com/TestPlanIt/testplanit/compare/v0.22.2...v0.22.3) (2026-04-19)

### Enhancements

* dialog polish, share link password policy, and review field fixes ([#228](https://github.com/TestPlanIt/testplanit/issues/228)) ([2844afd](https://github.com/TestPlanIt/testplanit/commit/2844afddcf603eac07e69daf8105430b304d6e01))

## [0.22.2](https://github.com/TestPlanIt/testplanit/compare/v0.22.1...v0.22.2) (2026-04-19)

### Bug Fixes

* **#217:** highlight recently added test cases ([#226](https://github.com/TestPlanIt/testplanit/issues/226)) ([62c11a3](https://github.com/TestPlanIt/testplanit/commit/62c11a3b6d4cc55c3c03a89858800ffba8a9a17b)), closes [#217](https://github.com/TestPlanIt/testplanit/issues/217) [#217](https://github.com/TestPlanIt/testplanit/issues/217)

## [0.22.1](https://github.com/TestPlanIt/testplanit/compare/v0.22.0...v0.22.1) (2026-04-19)

### Bug Fixes

* Bug fix batch for v0.22.1 ([#225](https://github.com/TestPlanIt/testplanit/issues/225)) ([ff68bb8](https://github.com/TestPlanIt/testplanit/commit/ff68bb83e08855c98d6da877988ce00d4246431b)), closes [#220](https://github.com/TestPlanIt/testplanit/issues/220) [#219](https://github.com/TestPlanIt/testplanit/issues/219) [#221](https://github.com/TestPlanIt/testplanit/issues/221) [#223](https://github.com/TestPlanIt/testplanit/issues/223)

## [0.22.0](https://github.com/TestPlanIt/testplanit/compare/v0.21.18...v0.22.0) (2026-04-18)

### Features

* **security:** Password Policy & Security Hardening ([#218](https://github.com/TestPlanIt/testplanit/issues/218)) ([ebbb3bf](https://github.com/TestPlanIt/testplanit/commit/ebbb3bf1ccd3b2f1b53333804690c589fb1da695))

## [0.21.18](https://github.com/TestPlanIt/testplanit/compare/v0.21.17...v0.21.18) (2026-04-16)

### Enhancements

* **audit log:** skip audit for session keep-alive writes ([06abc28](https://github.com/TestPlanIt/testplanit/commit/06abc288639c1df7786e8469913fccc3d6f4e1f8))

## [0.21.17](https://github.com/TestPlanIt/testplanit/compare/v0.21.16...v0.21.17) (2026-04-16)

### Bug Fixes

* resolve E2E failures, CodeQL warnings, and debug cleanup ([#216](https://github.com/TestPlanIt/testplanit/issues/216)) ([9d81d8d](https://github.com/TestPlanIt/testplanit/commit/9d81d8d5c5b9b1b23617b09397274ff104cd52f9))

## [0.21.16](https://github.com/TestPlanIt/testplanit/compare/v0.21.15...v0.21.16) (2026-04-16)

### Bug Fixes

* use server actions for prompt config forms to bypass 1MB request limit ([#214](https://github.com/TestPlanIt/testplanit/issues/214)) ([b89d069](https://github.com/TestPlanIt/testplanit/commit/b89d0697c9349103a12176151c4fa574fae46b20))

## [0.21.15](https://github.com/TestPlanIt/testplanit/compare/v0.21.14...v0.21.15) (2026-04-15)

### Enhancements

* **two-factor:** implement AES-256-GCM encryption for TOTP secrets and add legacy support ([#212](https://github.com/TestPlanIt/testplanit/issues/212)) ([8cdba1d](https://github.com/TestPlanIt/testplanit/commit/8cdba1dfadcc0e76d8b9de3c6f4dea1e201af044))

## [0.21.14](https://github.com/TestPlanIt/testplanit/compare/v0.21.13...v0.21.14) (2026-04-15)

### Bug Fixes

* **issues:** disable sync for SIMPLE_URL issue integrations ([#197](https://github.com/TestPlanIt/testplanit/issues/197)) ([6b0cc94](https://github.com/TestPlanIt/testplanit/commit/6b0cc942a0e6da8b4b3e093ac87f1d255b5f7ba3))

## [0.21.13](https://github.com/TestPlanIt/testplanit/compare/v0.21.12...v0.21.13) (2026-04-15)

### Enhancements

- **api:** API token auth: report-endpoint fallback, Valkey cache with immediate invalidation, and capacity test suite ([#199](https://github.com/TestPlanIt/testplanit/issues/199)) ([cd82846](https://github.com/TestPlanIt/testplanit/commit/cd8284678334e8a392c4c01ca78a55a5c211bada))

## [0.21.12](https://github.com/TestPlanIt/testplanit/compare/v0.21.11...v0.21.12) (2026-04-15)

### Bug Fixes

- Shared Steps improvements (group permissions + resizable panels) ([#195](https://github.com/TestPlanIt/testplanit/issues/195)) ([f9b9c61](https://github.com/TestPlanIt/testplanit/commit/f9b9c619d4ef92eb470baa2d96f655294ac85711)), closes [#193](https://github.com/TestPlanIt/testplanit/issues/193)

## [0.21.11](https://github.com/TestPlanIt/testplanit/compare/v0.21.10...v0.21.11) (2026-04-15)

### Enhancements

- Reports polish (consistent issue display, filters, column fixes) ([#194](https://github.com/TestPlanIt/testplanit/issues/194)) ([61705a0](https://github.com/TestPlanIt/testplanit/commit/61705a09f69d2b5e7a4e1b51b2a1abf1646f7f60))

## [0.21.10](https://github.com/TestPlanIt/testplanit/compare/v0.21.9...v0.21.10) (2026-04-14)

### Enhancements

- **api:** add API token auth fallback to remaining report utility handlers ([#192](https://github.com/TestPlanIt/testplanit/issues/192)) ([d978b21](https://github.com/TestPlanIt/testplanit/commit/d978b212e76dd1f1b3dc9279297048fe892d55cc))

## [0.21.9](https://github.com/TestPlanIt/testplanit/compare/v0.21.8...v0.21.9) (2026-04-13)

### Enhancements

- **llm:** improve test case generation context and add missing translations ([#191](https://github.com/TestPlanIt/testplanit/issues/191)) ([6c071c7](https://github.com/TestPlanIt/testplanit/commit/6c071c73399096e5b493b506bfbcba05629071af))

## [0.21.8](https://github.com/TestPlanIt/testplanit/compare/v0.21.7...v0.21.8) (2026-04-13)

### Enhancements

- **api:** add API token auth to custom endpoints and k6 load test suite ([#189](https://github.com/TestPlanIt/testplanit/issues/189)) ([aef211a](https://github.com/TestPlanIt/testplanit/commit/aef211a2119f429acacae7c4f12af75429a1893a))
- multi-project integration support ([#188](https://github.com/TestPlanIt/testplanit/issues/188)) ([580b174](https://github.com/TestPlanIt/testplanit/commit/580b174647b15025b3378fa8e489309bbad62f55))

## [0.21.7](https://github.com/TestPlanIt/testplanit/compare/v0.21.6...v0.21.7) (2026-04-12)

### Enhancements

- **integration:** enhance IntegrationConfigForm with credential management and UI improvements ([64e8377](https://github.com/TestPlanIt/testplanit/commit/64e8377a3d50fef8b2bfa9fa9d627f08a579bc11))

## [0.21.6](https://github.com/TestPlanIt/testplanit/compare/v0.21.5...v0.21.6) (2026-04-11)

### Bug Fixes

- **ssrf:** respect ALLOWED_PRIVATE_HOSTS in isSsrfSafe and assertSsrfSafeResolved ([#187](https://github.com/TestPlanIt/testplanit/issues/187)) ([167d113](https://github.com/TestPlanIt/testplanit/commit/167d113be9e0615c752d3d44f0fd69e25286c8ab))

## [0.21.5](https://github.com/TestPlanIt/testplanit/compare/v0.21.4...v0.21.5) (2026-04-10)

### Bug Fixes

- **auth:** preserve Magic Link provider settings on pod restart ([9780863](https://github.com/TestPlanIt/testplanit/commit/97808630f882856e27d4e6788ea4b44ebd316e2d))

## [0.21.4](https://github.com/TestPlanIt/testplanit/compare/v0.21.3...v0.21.4) (2026-04-09)

### Bug Fixes

- **docs:** pin webpackbar to 7.x to satisfy webpack 5.106 ProgressPlugin schema ([#186](https://github.com/TestPlanIt/testplanit/issues/186)) ([e5b3b85](https://github.com/TestPlanIt/testplanit/commit/e5b3b85e8b32c309bb8fdf4b5e35bd34672bd54a))
- **pagination:** update pagination button text condition ([71262a9](https://github.com/TestPlanIt/testplanit/commit/71262a9aabe221edcbe171e66f28257f2b94371c))

## [0.21.3](https://github.com/TestPlanIt/testplanit/compare/v0.21.2...v0.21.3) (2026-04-09)

### Bug Fixes

- **modals:** Refactor/modal form state leak ([#185](https://github.com/TestPlanIt/testplanit/issues/185)) ([978027e](https://github.com/TestPlanIt/testplanit/commit/978027e585639bf5fbe6cef701022bdacae2cd34)), closes [#181](https://github.com/TestPlanIt/testplanit/issues/181) [#181](https://github.com/TestPlanIt/testplanit/issues/181)

## [0.21.2](https://github.com/TestPlanIt/testplanit/compare/v0.21.1...v0.21.2) (2026-04-08)

### Bug Fixes

- **add-user:** reset form values and clear errors when closing user creation dialog ([#181](https://github.com/TestPlanIt/testplanit/issues/181)) ([846f3b3](https://github.com/TestPlanIt/testplanit/commit/846f3b3742a01f3c90da41f839fc45ed1743d4d9))

## [0.21.1](https://github.com/TestPlanIt/testplanit/compare/v0.21.0...v0.21.1) (2026-04-06)

### Enhancements

- implement snapshot case ID resolution for repository cases ([#180](https://github.com/TestPlanIt/testplanit/issues/180)) ([e849c77](https://github.com/TestPlanIt/testplanit/commit/e849c775a2f0fa680842cbe40f00372a2e4d88e1))

## [0.21.0](https://github.com/TestPlanIt/testplanit/compare/v0.20.4...v0.21.0) (2026-04-06)

### Features

- **61-01:** implement SSRF-safe fetch utility ([f82ee0d](https://github.com/TestPlanIt/testplanit/commit/f82ee0df2ed7e84ead58d3437897ef3c9c3feec8))
- **61-02:** add generate-from-url queue, LLM constants, and schema enum ([ce0c13a](https://github.com/TestPlanIt/testplanit/commit/ce0c13ab516add84c8eaa936fcfafb586b910ce1))
- **61-02:** create generate-from-url API routes, stub worker, and registration ([d169a45](https://github.com/TestPlanIt/testplanit/commit/d169a45bc572903a8f8f15f6f72caf62d346eaf1))
- **62-01:** implement content extraction pipeline ([d858b29](https://github.com/TestPlanIt/testplanit/commit/d858b29247eab4b977dba74d9a07db5150b703a9))
- **62-02:** extend worker with BFS crawl loop and extraction pipeline ([2c86651](https://github.com/TestPlanIt/testplanit/commit/2c866511b752f38a0485ca42546352f990d8ef48))
- **62-02:** implement crawl helper functions ([f5d2aa8](https://github.com/TestPlanIt/testplanit/commit/f5d2aa83c023d8c840afd2cf6847bc11cc98789f))
- **62-03:** add From URL tab to Generate Test Cases wizard ([60b4074](https://github.com/TestPlanIt/testplanit/commit/60b40747f190977a06ab89197a3af621aefd1137))
- **63-01:** wire LLM pipeline into generateFromUrlWorker with notifications ([8b5d024](https://github.com/TestPlanIt/testplanit/commit/8b5d024d1b50e3469cdedb0d59c5a4b3b16a9a95))
- **63-02:** wire URL submit payload, collapsible crawled pages UI, and notification link reopening ([27e7ae0](https://github.com/TestPlanIt/testplanit/commit/27e7ae0a7cd95d106bb02ff6af9b9997249c6187))
- **63:** add clickable review link to URL generation notifications ([3f4a15b](https://github.com/TestPlanIt/testplanit/commit/3f4a15b768e1942a3a6a3c8dfdffc2a3c76e6f13))
- **63:** add per-page filter to review step for URL-generated test cases ([d220010](https://github.com/TestPlanIt/testplanit/commit/d220010798b80cd646aecac4a396553021cb9e08))
- **63:** add progress bar and improved text during per-page generation ([5b31974](https://github.com/TestPlanIt/testplanit/commit/5b3197421887046fd5ad203f1921c5050d9adde4))
- **63:** add requirements vs application mode for URL generation ([ece3761](https://github.com/TestPlanIt/testplanit/commit/ece3761a85cd03f75a5d7613a3e0f09d93e467cb))
- **63:** move page filter above scroll area so it's always visible ([cc04186](https://github.com/TestPlanIt/testplanit/commit/cc04186d4b03ce848fd41644719b2723b342ca2b))
- **63:** render test cases incrementally in review step during generation ([33d69cf](https://github.com/TestPlanIt/testplanit/commit/33d69cf4292c2039217201290acad7c75e6e48d5))
- **63:** retry failed per-page LLM calls once before marking as failed ([8a3ed80](https://github.com/TestPlanIt/testplanit/commit/8a3ed80d645269c8706f1b31e00fcd11379d45db))
- **63:** show per-page generation progress in URL wizard ([ed65a13](https://github.com/TestPlanIt/testplanit/commit/ed65a13164496ddd99d99fab9720bbf64ca3b336))
- **63:** show per-page generation progress overlay on any wizard step ([12fbe49](https://github.com/TestPlanIt/testplanit/commit/12fbe49be692b1c4f0b2dac9c588e99cb6b3c7b3))
- **63:** show test cases incrementally as each page completes ([986b529](https://github.com/TestPlanIt/testplanit/commit/986b5294b245ce9f63ac6238999167d649bc6e5d))
- **63:** stream test case fields incrementally as LLM generates them ([5101677](https://github.com/TestPlanIt/testplanit/commit/5101677221b5b9d014d9e979871c62ede40e6f3a))
- **63:** switch to streaming LLM calls for real-time case count feedback ([f7dea27](https://github.com/TestPlanIt/testplanit/commit/f7dea2702871724a7671ffb05d37f1a9f3ac6d11))
- **63:** template-only fields, per-page folders, dead code cleanup, abort fixes ([f2e698a](https://github.com/TestPlanIt/testplanit/commit/f2e698ada8043e1f94071223788299ddfbe2a8c2))
- add folder name derivation from URL and enhance GeneratedTestCaseCard component ([52ecad9](https://github.com/TestPlanIt/testplanit/commit/52ecad9b98538031dcbbc921a06867e1e60af8be))
- add new upgrade notification for test case generation from URL ([03c2def](https://github.com/TestPlanIt/testplanit/commit/03c2def501dce947de478f4f10950a24e7fe8df8))
- add new URL handling features and progress indicators in Spanish and French translations ([ff9c0de](https://github.com/TestPlanIt/testplanit/commit/ff9c0de2f70967e713508a35db6c4b5c53304c81))
- enhance DeleteFolderModal and GenerateTestCasesWizard with new functionality ([3e905f6](https://github.com/TestPlanIt/testplanit/commit/3e905f651ecc54709988bd2950fde6014890f585))
- enhance GenerateTestCasesWizard and localization for loading states ([79dbb5f](https://github.com/TestPlanIt/testplanit/commit/79dbb5f7c9a77b17ffc0984b7b7d86b7580590f6))
- enhance HTML generation in tiptapToHtml utility ([7d94d93](https://github.com/TestPlanIt/testplanit/commit/7d94d9385d0d1ffd7dc076b42425d11a65c6a59d))
- enhance LLM integrations and URL-based test case generation ([db7be2a](https://github.com/TestPlanIt/testplanit/commit/db7be2aa30d2ba6db4d85559299b460d880f6117))
- enhance URL test case generation and improve user experience ([31aad14](https://github.com/TestPlanIt/testplanit/commit/31aad14d5c9bb96bca1e84fa6327beebe5950f99))
- implement upsert for folder creation in importGeneratedTestCases, enhance example values in buildSystemPrompt, and improve notification message with project name ([5e257ee](https://github.com/TestPlanIt/testplanit/commit/5e257ee645dbfc1e510d0e4c4dae8f06a100b02d))

### Bug Fixes

- **61-01:** wire SSRF agent to http/https.request for DNS rebinding prevention ([755a84e](https://github.com/TestPlanIt/testplanit/commit/755a84ef57695a749ae228ff78ed0913a33f522f))
- **62-01:** move jsdom from devDependencies to dependencies ([faeb6b1](https://github.com/TestPlanIt/testplanit/commit/faeb6b15c1e802e01af321d97b7b6992a1423c00))
- **62:** use post-redirect hostname for same-domain link filtering ([8c5d8f3](https://github.com/TestPlanIt/testplanit/commit/8c5d8f3efca2ddb6010579a027eb7c4ce542c451))
- **63:** accumulate all steps in streaming stub, show full step details ([2f87a4b](https://github.com/TestPlanIt/testplanit/commit/2f87a4bb05e0f3fd64220671c0b75725a2fd2905))
- **63:** add missing reviewGeneratedCases i18n key ([54edbba](https://github.com/TestPlanIt/testplanit/commit/54edbba59d09ee7ecc25835431ec96f39d6d625c))
- **63:** always check Redis for partial results when job is active ([c58a667](https://github.com/TestPlanIt/testplanit/commit/c58a6676df5317e6fbc3777a810613136d080084))
- **63:** assign unique IDs to test cases across per-page LLM calls ([b998b8c](https://github.com/TestPlanIt/testplanit/commit/b998b8cd71588926ad9f7944d76930c0a71919cd))
- **63:** cancel active URL job when user clicks Cancel in wizard ([31f41c0](https://github.com/TestPlanIt/testplanit/commit/31f41c07043e9182a9f18650cea0f4e6bb8dd64f))
- **63:** cancel existing URL job before submitting a new one ([c2d028a](https://github.com/TestPlanIt/testplanit/commit/c2d028ae37eae7e65ad843f2ead3522d339e5208))
- **63:** clean up wizard state for URL generation lifecycle ([b66fb4e](https://github.com/TestPlanIt/testplanit/commit/b66fb4eb4afb41fea94f7ed0764ac54cbc9f12f1))
- **63:** convert field option names to IDs for URL-generated test cases ([731cc11](https://github.com/TestPlanIt/testplanit/commit/731cc1141b06aa1f9acf524d2e8c21168436e95b))
- **63:** count test cases against accumulated stream, not per-chunk ([2d6e37b](https://github.com/TestPlanIt/testplanit/commit/2d6e37b3dde477929f55d59e12f63afceeec6b53))
- **63:** default URL mode to Application instead of Requirements ([244e8af](https://github.com/TestPlanIt/testplanit/commit/244e8af7cdd747b59ca1b05d2acffb2ee68fe255))
- **63:** fix parentheses in Select page filter options ([dbdce67](https://github.com/TestPlanIt/testplanit/commit/dbdce67422cace841879d1a03daba63f35421343))
- **63:** force-fail active jobs on cancel instead of just setting flag ([737930f](https://github.com/TestPlanIt/testplanit/commit/737930fb3714a06358f427bbe69c0fd7485cccfe))
- **63:** gate field auto-select on wizard step instead of ref flag ([68e3e21](https://github.com/TestPlanIt/testplanit/commit/68e3e21300c7875154c79255954b37765ae6040f))
- **63:** generate test case quantity per page, not per crawl ([ebc067b](https://github.com/TestPlanIt/testplanit/commit/ebc067b2851aae6bb46876cac387496dc5937aee))
- **63:** handle crawlOnly in notification reopen and add debug logging ([2ed2993](https://github.com/TestPlanIt/testplanit/commit/2ed2993aa1b70cf9c68a947eca3f7ec0f7d9cebb))
- **63:** handle Node 24 dns.lookup all-results format in SSRF pinned agent ([8d572ae](https://github.com/TestPlanIt/testplanit/commit/8d572aeda862662f98db9590c75de0651b668927))
- **63:** improve notification-link wizard reopen UX ([c6b0dae](https://github.com/TestPlanIt/testplanit/commit/c6b0dae2a3b3a32dbb26e64661de8e1424bc5102))
- **63:** include completedTestCases in all progress updates, not just post-page ([c179a8b](https://github.com/TestPlanIt/testplanit/commit/c179a8b6ccc592ea2d99e1d008f191998da8f71f))
- **63:** include template field instructions in URL generation prompts ([59a6d5a](https://github.com/TestPlanIt/testplanit/commit/59a6d5a8d08e48a759b970b0243a25c75af4b35a))
- **63:** match BullMQ lock extension to provider's configured LLM timeout ([db0aa93](https://github.com/TestPlanIt/testplanit/commit/db0aa93a7749987082fc95623d0c0ba9e1debe3a))
- **63:** move parentheses to JSX string expressions ([04cc4ea](https://github.com/TestPlanIt/testplanit/commit/04cc4ea03c651fd79effdb680f5f7d96d846e539))
- **63:** only include user-selected fields in LLM prompt ([c85adc6](https://github.com/TestPlanIt/testplanit/commit/c85adc676710ba07d26682853f7ac1bd486072e6))
- **63:** pass selectedFieldIds explicitly to streamUrlTestCases ([ebc066d](https://github.com/TestPlanIt/testplanit/commit/ebc066d76dbe8cea1ed582cc6b04d755e4586808))
- **63:** preserve selected field IDs in URL generation job results ([7df488d](https://github.com/TestPlanIt/testplanit/commit/7df488d83724112bfde17c8ae661a61918ab5461))
- **63:** prevent notification re-trigger, show page info during streaming, remove debug logs ([d409a3e](https://github.com/TestPlanIt/testplanit/commit/d409a3e8d7720f932bd1c7438d72fe6cf90842d6))
- **63:** prevent template-change effect from overriding restored field selection ([53ab4d2](https://github.com/TestPlanIt/testplanit/commit/53ab4d26d7c5a299ff9ec1907fd08a0b9d0ba61e))
- **63:** remove hardcoded 120s LLM timeout, use provider config ([a8af049](https://github.com/TestPlanIt/testplanit/commit/a8af0496aadf2c8779d05bc424261170d688a61f))
- **63:** remove unused pageSuccess variable ([ed0fc46](https://github.com/TestPlanIt/testplanit/commit/ed0fc465ca48cb5f62c30d1a67de3b94ee46f0d9))
- **63:** replace remaining hardcoded strings in URL tab progress display ([6f7dab9](https://github.com/TestPlanIt/testplanit/commit/6f7dab9530abff5afafd6d557132c0fdd2a40865))
- **63:** restore syntheticIssue for parseAndValidateTestCases ([58ec922](https://github.com/TestPlanIt/testplanit/commit/58ec922244b9a4ecc22b4ad7dcf325e1155fc949))
- **63:** restore template and field selection when loading URL job results ([d6a6b0d](https://github.com/TestPlanIt/testplanit/commit/d6a6b0d64f8dc179b307ed1ee9386d092eac2515))
- **63:** set 120s LLM timeout for URL generation to handle large prompts ([19c57e3](https://github.com/TestPlanIt/testplanit/commit/19c57e3f26c83a0107affeca43101e12f60841d9))
- **63:** set currentStep before restoreTemplateFromResult in setInterval ([c104c47](https://github.com/TestPlanIt/testplanit/commit/c104c471b45f8525baa489314285a94629059a58))
- **63:** set currentStep to REVIEW_GENERATED before restoring template ([2ed1f83](https://github.com/TestPlanIt/testplanit/commit/2ed1f83ff0b9606b8d3c8c70ba89510a2bf68495))
- **63:** show actual pages fetched instead of misleading max cap ([5f4e52e](https://github.com/TestPlanIt/testplanit/commit/5f4e52ea349c0614bbf7f360a8760053b7f2951d))
- **63:** show progress overlay immediately after job submit ([2e818b0](https://github.com/TestPlanIt/testplanit/commit/2e818b089f6b5c4155f14024315a64b1df7fa91a))
- **63:** show simpler progress message for single-page URL generation ([392020e](https://github.com/TestPlanIt/testplanit/commit/392020ebdc0457ab1f77f812bb6734417cd64ebf))
- **63:** show streaming case count badge during generation, not just after ([40d2f59](https://github.com/TestPlanIt/testplanit/commit/40d2f591e2e00e4a4fc12e3950738e851b549f76))
- **63:** start page generation count at 1 instead of 0 ([0629f74](https://github.com/TestPlanIt/testplanit/commit/0629f7483f4d288cc404057afad0b0b325c28f9d))
- **63:** store crawled page content in Redis instead of BullMQ result ([81e646e](https://github.com/TestPlanIt/testplanit/commit/81e646eafe90fd18c5349964b140ba168d1112a8))
- **63:** store partial test cases in Redis instead of BullMQ progress ([71a6a7a](https://github.com/TestPlanIt/testplanit/commit/71a6a7a2450b9029e1ca1ab43a956da98e9b274f))
- **63:** use i18n translations for hardcoded progress strings ([43c6f3f](https://github.com/TestPlanIt/testplanit/commit/43c6f3fe5f04660442f78d11b7c67e0d01e836f9))
- **63:** use mode-specific fallback prompts instead of generic buildSystemPrompt ([fafa4b8](https://github.com/TestPlanIt/testplanit/commit/fafa4b8d8838de664b84997f664d3a8a08fa340a))
- add undici as explicit dependency for Next.js bundler ([aac7a13](https://github.com/TestPlanIt/testplanit/commit/aac7a139dc2c46639c566089ff8f8eb69df55731))
- allow localhost/private IPs for Ollama and Custom LLM providers ([df40518](https://github.com/TestPlanIt/testplanit/commit/df4051838f0c26c3b4dc7deb4d0ec28f9c9ab77c))
- bypass Node.js undici 5-minute body timeout for LLM chat calls ([4b0f748](https://github.com/TestPlanIt/testplanit/commit/4b0f748ac8c5edcaa31d3e04b781a8d96bb1432d))
- throw error when private URL blocked for providers with no default ([bacf98b](https://github.com/TestPlanIt/testplanit/commit/bacf98b0f08cee9cf02b2742dc59e7207b8eb0ef))
- use operator-level ALLOWED_PRIVATE_HOSTS for self-hosted providers ([6262247](https://github.com/TestPlanIt/testplanit/commit/6262247a908a2cfac8b63ecd0483a3db9ecdfc5f))
- use provider's configured timeout for SSE stream LLM calls ([9bba7e5](https://github.com/TestPlanIt/testplanit/commit/9bba7e5af308b0d82a5898fad75d22d7c71ad3e2))
- use safeFetchLongRunning for all chatStream methods too ([78a6017](https://github.com/TestPlanIt/testplanit/commit/78a6017eea9236d244f6ae07cdc5af63012de287))

## [0.20.4](https://github.com/TestPlanIt/testplanit/compare/v0.20.3...v0.20.4) (2026-04-05)

### Enhancements

- **notifications:** add "Delete All" functionality for notifications ([#179](https://github.com/TestPlanIt/testplanit/issues/179)) ([30a3ecb](https://github.com/TestPlanIt/testplanit/commit/30a3ecb2488fb06e533c604b8782499bc7fca63c))

## [0.20.3](https://github.com/TestPlanIt/testplanit/compare/v0.20.2...v0.20.3) (2026-04-03)

### Bug Fixes

- Bugfix/permission issue ([#178](https://github.com/TestPlanIt/testplanit/issues/178)) ([81863e3](https://github.com/TestPlanIt/testplanit/commit/81863e35503a66fd48c5e0c7cce6882e0a34a137))

## [0.20.2](https://github.com/TestPlanIt/testplanit/compare/v0.20.1...v0.20.2) (2026-04-02)

### Bug Fixes

- **ci:** prevent false version detection in semantic release workflow ([b1be150](https://github.com/TestPlanIt/testplanit/commit/b1be150afc737b65baaf40d22ae10c20179c8ddf))

## [0.20.1](https://github.com/TestPlanIt/testplanit/compare/v0.20.0...v0.20.1) (2026-04-02)

### Enhancements

- **tags:** Enhance Tag Detail Page with Filters and Improved Readability ([#171](https://github.com/TestPlanIt/testplanit/issues/171)) ([188461d](https://github.com/TestPlanIt/testplanit/commit/188461def6880d59a7a07224e83fe7350262f032))

## [0.20.0](https://github.com/TestPlanIt/testplanit/compare/v0.19.1...v0.20.0) (2026-04-01)

### Features

- Multi-Configuration Sessions, Session Duplication, and PDF Export for Sessions & Test Runs ([#170](https://github.com/TestPlanIt/testplanit/issues/170)) ([61a17c4](https://github.com/TestPlanIt/testplanit/commit/61a17c459ec100a9afbe499ef6f2f8af78be0678))

## [0.19.1](https://github.com/TestPlanIt/testplanit/compare/v0.19.0...v0.19.1) (2026-03-31)

### Bug Fixes

- **integrations:** Add validation for external project and default issue type before saving settings ([#169](https://github.com/TestPlanIt/testplanit/issues/169)) ([66b9e6a](https://github.com/TestPlanIt/testplanit/commit/66b9e6a422c3141e1c4464f9e9dd84d83eb42c61))

## [0.19.0](https://github.com/TestPlanIt/testplanit/compare/v0.18.12...v0.19.0) (2026-03-28)

### Features

- **coderepo:** Add Gitea support and enhance repository configuration ([#164](https://github.com/TestPlanIt/testplanit/issues/164)) ([3e349de](https://github.com/TestPlanIt/testplanit/commit/3e349de572ce059b5f75682a6c58f4bd18ff232a))

### Bug Fixes

- **ci:** fix Docker latest tag not updating and harden semantic-release version detection ([5167980](https://github.com/TestPlanIt/testplanit/commit/5167980c32bf51f1d9b5eea7e500eafc3f41ebbe))

## [0.18.12](https://github.com/TestPlanIt/testplanit/compare/v0.18.11...v0.18.12) (2026-03-28)

### Features

- Improve auto tagging ([#160](https://github.com/TestPlanIt/testplanit/issues/160)) ([2cd5ac6](https://github.com/TestPlanIt/testplanit/commit/2cd5ac64db78d9d83cb73d5e1c325b942bbc5284))

### Enhancements

- Enhance auto tag new tag handling ([#161](https://github.com/TestPlanIt/testplanit/issues/161)) ([d01bae1](https://github.com/TestPlanIt/testplanit/commit/d01bae17040735670229b524e2ce9ff02e3f8ff8))

## [0.18.11](https://github.com/TestPlanIt/testplanit/compare/v0.18.10...v0.18.11) (2026-03-28)

### Enhancements

- Enhance GenerateTestCasesWizard with streaming support and progress tracking ([3405f95](https://github.com/TestPlanIt/testplanit/commit/3405f95ae8560dfd6ba5b8bc4b00bb6f44331594))

## [0.18.10](https://github.com/TestPlanIt/testplanit/compare/v0.18.9...v0.18.10) (2026-03-27)

### Bug Fixes

- Update dependencies to latest versions ([0525833](https://github.com/TestPlanIt/testplanit/commit/0525833cd9814f203b61f48766647a45a20b0def))
- Update documentation link for Magic Select background worker setup ([e15a341](https://github.com/TestPlanIt/testplanit/commit/e15a341bfa6b6c0226728737c2421907d5c06951))

### Enhancements

- Improve LLM Request Handling: Token Management, Retry Logic, and Background Processing ([#159](https://github.com/TestPlanIt/testplanit/issues/159)) ([07a5e39](https://github.com/TestPlanIt/testplanit/commit/07a5e39b3bc0c1f08bc7881329e0d123b5185e1e))

## [0.18.9](https://github.com/TestPlanIt/testplanit/compare/v0.18.8...v0.18.9) (2026-03-27)

### Bug Fixes

- Fixed Docker custom ports and updated docs ([#158](https://github.com/TestPlanIt/testplanit/issues/158)) ([8f355e0](https://github.com/TestPlanIt/testplanit/commit/8f355e03ddcb6e73c338873468ef1582a307dc6a))

## [0.18.8](https://github.com/TestPlanIt/testplanit/compare/v0.18.7...v0.18.8) (2026-03-27)

### Bug Fixes

- **permissions:** Fix ACLs on Steps table ([#156](https://github.com/TestPlanIt/testplanit/issues/156)) ([c75ee1f](https://github.com/TestPlanIt/testplanit/commit/c75ee1fd2a3f6e07404f14db57eec9d63b83b3ed))

## [0.18.7](https://github.com/TestPlanIt/testplanit/compare/v0.18.6...v0.18.7) (2026-03-26)

### Enhancements

- **page titles:** Enhancement/page routing improvements ([#154](https://github.com/TestPlanIt/testplanit/issues/154)) ([6470b7e](https://github.com/TestPlanIt/testplanit/commit/6470b7e8e94f2dbb490bc4ea2a8d6b426122a5ed))

## [0.18.6](https://github.com/TestPlanIt/testplanit/compare/v0.18.5...v0.18.6) (2026-03-26)

### Bug Fixes

- Authentication with Microsoft SSO by sanitizeAccountData function for OAuth account linking ([#153](https://github.com/TestPlanIt/testplanit/issues/153)) ([0c79039](https://github.com/TestPlanIt/testplanit/commit/0c7903978d10c028cdf4827ffc438fc55abdf077))

## [0.18.5](https://github.com/TestPlanIt/testplanit/compare/v0.18.4...v0.18.5) (2026-03-26)

### Enhancements

- **auditLog:** enhance tenantId handling in audit events ([ea40819](https://github.com/TestPlanIt/testplanit/commit/ea408193f33bd05f56ebc5b0cf6ad95d6aed47f6))

## [0.18.4](https://github.com/TestPlanIt/testplanit/compare/v0.18.3...v0.18.4) (2026-03-26)

### Enhancements

- enhance queue management and job handling ([ebc9171](https://github.com/TestPlanIt/testplanit/commit/ebc9171b104516c8c35f041bfe420a4ed1fd6122))

## [0.18.3](https://github.com/TestPlanIt/testplanit/compare/v0.18.2...v0.18.3) (2026-03-25)

### Bug Fixes

- enhance Prisma client usage in shared steps resolution ([7e8cc1e](https://github.com/TestPlanIt/testplanit/commit/7e8cc1e414f9a1cf28e17748e97df50711dd445e))

## [0.18.2](https://github.com/TestPlanIt/testplanit/compare/v0.18.1...v0.18.2) (2026-03-25)

### Bug Fixes

- **workers:** add new step sequence scan worker ([4ffdc5e](https://github.com/TestPlanIt/testplanit/commit/4ffdc5e257517a3f79c2b221f48d8822deec0cab))

## [0.18.1](https://github.com/TestPlanIt/testplanit/compare/v0.18.0...v0.18.1) (2026-03-25)

### Enhancements

- **workers:** add new workers for copy-move and duplicate-scan processes ([5762a38](https://github.com/TestPlanIt/testplanit/commit/5762a3866724c86f4b977b84769e4ed82cce9cee))

## [0.18.0](https://github.com/TestPlanIt/testplanit/compare/v0.17.1...v0.18.0) (2026-03-25)

### Features

- Find/Resolve duplicate test cases and test steps ([#152](https://github.com/TestPlanIt/testplanit/issues/152)) ([5fb99ac](https://github.com/TestPlanIt/testplanit/commit/5fb99ac552ea44a8af31cb1d9f33f2ce887b93c7)), closes [#3](https://github.com/TestPlanIt/testplanit/issues/3) [#ID](https://github.com/TestPlanIt/testplanit/issues/ID)

## [0.17.1](https://github.com/TestPlanIt/testplanit/compare/v0.17.0...v0.17.1) (2026-03-24)

### Bug Fixes

- **auditLog:** simplify tenantId inclusion in audit events ([#148](https://github.com/TestPlanIt/testplanit/issues/148)) ([e0e2f5a](https://github.com/TestPlanIt/testplanit/commit/e0e2f5a5ee42e55af3aad4a590a966db9a4f9360))
- **docs:** update links in LLM integrations and prompt configurations documentation ([97844d9](https://github.com/TestPlanIt/testplanit/commit/97844d9590359f6aafcbdefb8c67249ba5681c1f))

### Enhancements

- **docs:** add Google Ads script to Docusaurus configuration ([c855d57](https://github.com/TestPlanIt/testplanit/commit/c855d579cb22ed471932bb2c032034de312703b0))

## [0.17.0](https://github.com/TestPlanIt/testplanit/compare/v0.16.28...v0.17.0) (2026-03-22)

### Features

- Release v0.17.0 — adds two major features: Copy/Move Test Cases Between Projects and Per-Prompt LLM Configuration, along with worker audit logging, comprehensive test coverage improvements, and bug fixes ([#147](https://github.com/TestPlanIt/testplanit/issues/147)) ([4116cb7](https://github.com/TestPlanIt/testplanit/commit/4116cb78afd507261b1f20120519ac576c05f0f9)), closes [#143](https://github.com/TestPlanIt/testplanit/issues/143) [#143](https://github.com/TestPlanIt/testplanit/issues/143) [#144](https://github.com/TestPlanIt/testplanit/issues/144)

## [0.16.28](https://github.com/TestPlanIt/testplanit/compare/v0.16.27...v0.16.28) (2026-03-19)

### Enhancements

- **users:** Enhance EditUserModal with avatar management features ([f69d715](https://github.com/TestPlanIt/testplanit/commit/f69d715495a93b635f507b76e986391e598dc11c))

## [0.16.27](https://github.com/TestPlanIt/testplanit/compare/v0.16.26...v0.16.27) (2026-03-19)

### Bug Fixes

- **llm:** Fix LLM integration test from add/edit form by adding default model handling ([3cce6ad](https://github.com/TestPlanIt/testplanit/commit/3cce6ad15c25ce7b3297a1c4579994bc6e175fde))

## [0.16.26](https://github.com/TestPlanIt/testplanit/compare/v0.16.25...v0.16.26) (2026-03-18)

### Enhancements

- **test runs, session:** Use comboboxes for long selects ([#140](https://github.com/TestPlanIt/testplanit/issues/140)) ([433a798](https://github.com/TestPlanIt/testplanit/commit/433a7981f2b498287912559cc23ca82a2b2b5dad))

## [0.16.25](https://github.com/TestPlanIt/testplanit/compare/v0.16.24...v0.16.25) (2026-03-18)

### Bug Fixes

- **ci:** pass NPM_TOKEN to semantic-release step ([30086f2](https://github.com/TestPlanIt/testplanit/commit/30086f2875a2be9148a60c707a4035cfea79e3ef))

## [0.16.24](https://github.com/TestPlanIt/testplanit/compare/v0.16.23...v0.16.24) (2026-03-18)

### Bug Fixes

- **lint:** remove unused variable assignments in SlashCommand and CLI config ([974bbfd](https://github.com/TestPlanIt/testplanit/commit/974bbfd49499f72bf46dd3838560b5e10d8adb31))

## [0.16.23](https://github.com/TestPlanIt/testplanit/compare/v0.16.22...v0.16.23) (2026-03-18)

### Enhancements

- **scheduler:** replace repeatable job removal with upsertJobScheduler ([4018b66](https://github.com/TestPlanIt/testplanit/commit/4018b66984b8e815adb97eb7816bbd0c48e075f8))

## [0.16.22](https://github.com/TestPlanIt/testplanit/compare/v0.16.21...v0.16.22) (2026-03-17)

### Enhancements

- **GitRepoAdapter, repoCacheRefreshService:** implement rate-limit handling for file content fetching ([9ace2f7](https://github.com/TestPlanIt/testplanit/commit/9ace2f7950f0ae79b63cc77aca4281de27c28e93))

## [0.16.21](https://github.com/TestPlanIt/testplanit/compare/v0.16.20...v0.16.21) (2026-03-17)

### Enhancements

- **Dockerfile, scheduler:** enhance PM2 installation and job scheduling cleanup ([2b13f8d](https://github.com/TestPlanIt/testplanit/commit/2b13f8de3a1046b31e81361f3f20d92235bcd20f))

## [0.16.20](https://github.com/TestPlanIt/testplanit/compare/v0.16.19...v0.16.20) (2026-03-16)

### Bug Fixes

- **api:** update file upload handling to use Uint8Array for Buffer instances ([1d4dba0](https://github.com/TestPlanIt/testplanit/commit/1d4dba0a1ca549ae1eb8604bf677c8151700cd71))

## [0.16.19](https://github.com/TestPlanIt/testplanit/compare/v0.16.18...v0.16.19) (2026-03-16)

### Enhancements

- Chore/code cleanup ([#133](https://github.com/TestPlanIt/testplanit/issues/133)) ([a6bd870](https://github.com/TestPlanIt/testplanit/commit/a6bd8708d05cb7a76a41fbd487fba0a617b38c00))

## [0.16.18](https://github.com/TestPlanIt/testplanit/compare/v0.16.17...v0.16.18) (2026-03-16)

### Bug Fixes

- **charts:** Limit automated result in chart plus more code cleanup ([#132](https://github.com/TestPlanIt/testplanit/issues/132)) ([bf0071c](https://github.com/TestPlanIt/testplanit/commit/bf0071cec57d06c9774d79c7146a33c6db68da5a)), closes [#130](https://github.com/TestPlanIt/testplanit/issues/130)

## [0.16.17](https://github.com/TestPlanIt/testplanit/compare/v0.16.16...v0.16.17) (2026-03-15)

### Enhancements

- Chore/remove unused imports ([#131](https://github.com/TestPlanIt/testplanit/issues/131)) ([e85b125](https://github.com/TestPlanIt/testplanit/commit/e85b125093de591aabd79a6ae085b7b69483a867))

## [0.16.16](https://github.com/TestPlanIt/testplanit/compare/v0.16.15...v0.16.16) (2026-03-15)

### Enhancements

- add feedback survey functionality and integrate tw-animate-css ([073e4cb](https://github.com/TestPlanIt/testplanit/commit/073e4cb4908075aa86641c8a6ddc6013616effb2))

## [0.16.15](https://github.com/TestPlanIt/testplanit/compare/v0.16.14...v0.16.15) (2026-03-15)

### Bug Fixes

- revert broken ZenStack query optimization and provider changes ([b99f696](https://github.com/TestPlanIt/testplanit/commit/b99f6968d5488e1047f6320860d37b5818191ec5))

## [0.16.14](https://github.com/TestPlanIt/testplanit/compare/v0.16.13...v0.16.14) (2026-03-15)

### Enhancements

- **Providers, Cases, TestRunPage:** streamline component logic and enhance data fetching ([e799864](https://github.com/TestPlanIt/testplanit/commit/e7998648d82ef4f20d8ffdbfa9117403923ff570))

## [0.16.13](https://github.com/TestPlanIt/testplanit/compare/v0.16.12...v0.16.13) (2026-03-15)

### Enhancements

- integrate ZenStack for optimized query handling ([70520b8](https://github.com/TestPlanIt/testplanit/commit/70520b8466bfbd784d21e6bb2d15105b165e5f75))

## [0.16.12](https://github.com/TestPlanIt/testplanit/compare/v0.16.11...v0.16.12) (2026-03-14)

### Bug Fixes

- **JunitTableSection:** streamline JUnit results fetching logic ([359999e](https://github.com/TestPlanIt/testplanit/commit/359999e20a961cd912a2de7f4c027beac427fa38))

## [0.16.11](https://github.com/TestPlanIt/testplanit/compare/v0.16.10...v0.16.11) (2026-03-14)

### Bug Fixes

- **TestRunPage, Loading:** enhance loading behavior and JUnit data fetching ([482a767](https://github.com/TestPlanIt/testplanit/commit/482a76789ecf7df505a9b99ce5cd3ecc8c8567bd))

## [0.16.10](https://github.com/TestPlanIt/testplanit/compare/v0.16.9...v0.16.10) (2026-03-14)

### Bug Fixes

- **AddCase, BulkEditModal, FieldValueInput:** optimize issue data handling - performance refactor ([246d038](https://github.com/TestPlanIt/testplanit/commit/246d038065f79939a2701e0594ac94281ddc7d8b))

## [0.16.9](https://github.com/TestPlanIt/testplanit/compare/v0.16.8...v0.16.9) (2026-03-14)

### Enhancements

- **workers:** Enhancement/add code cache worker ([#129](https://github.com/TestPlanIt/testplanit/issues/129)) ([45b4ba9](https://github.com/TestPlanIt/testplanit/commit/45b4ba925abec6c8069e80cab044d89b709ed002))

## [0.16.8](https://github.com/TestPlanIt/testplanit/compare/v0.16.7...v0.16.8) (2026-03-14)

### Bug Fixes

- **llm:** enhance error handling in LLM integration connection tests ([a4e75e2](https://github.com/TestPlanIt/testplanit/commit/a4e75e2b64f156328f6e44c6ba7c7a5b0662b51b))

## [0.16.7](https://github.com/TestPlanIt/testplanit/compare/v0.16.6...v0.16.7) (2026-03-14)

### Enhancements

- **llm:** enhance LLM integration with updated provider configurations and connection testing ([fdbc5ab](https://github.com/TestPlanIt/testplanit/commit/fdbc5ab635f0fec7e0774d5de0dae07a596a1f3a))

## [0.16.6](https://github.com/TestPlanIt/testplanit/compare/v0.16.5...v0.16.6) (2026-03-13)

### Bug Fixes

- **dependencies:** bump undici override to >=7.24.0 for security patches ([cabe2ba](https://github.com/TestPlanIt/testplanit/commit/cabe2baae042e5d9236c3984aceaf3af87cb1332))
- **workers:** enhance multi-tenant support in syncWorker and autoTagWorker ([641b894](https://github.com/TestPlanIt/testplanit/commit/641b89402a9bd29f56b61d3cb9e3e23d794d81e7))

## [0.16.5](https://github.com/TestPlanIt/testplanit/compare/v0.16.4...v0.16.5) (2026-03-13)

### Bug Fixes

- **workers:** pass tenant Prisma client to IntegrationManager.getAdapter ([9a97412](https://github.com/TestPlanIt/testplanit/commit/9a9741246ad16552fb5496c66ae07c9bb2425015))

## [0.16.4](https://github.com/TestPlanIt/testplanit/compare/v0.16.3...v0.16.4) (2026-03-13)

### Bug Fixes

- **docker:** increase memory limits and optimize service configurations ([358c5c1](https://github.com/TestPlanIt/testplanit/commit/358c5c1b84bc864d3dbfc6754388ca1a940f2a87))

## [0.16.2](https://github.com/TestPlanIt/testplanit/compare/v0.16.1...v0.16.2) (2026-03-13)

### Bug Fixes

- **workers:** add new background workers and update concurrency settings ([0327595](https://github.com/TestPlanIt/testplanit/commit/032759562d80cf5d8f954e020953728643b6c37f))

## [0.16.1](https://github.com/TestPlanIt/testplanit/compare/v0.16.0...v0.16.1) (2026-03-13)

### Bug Fixes

- Unable to expand project/admin menu sections in mobile mode ([3f0ab56](https://github.com/TestPlanIt/testplanit/commit/3f0ab565fdbe017b94ff3762b59440b4d56071b1))

## [0.16.0](https://github.com/TestPlanIt/testplanit/compare/v0.15.4...v0.16.0) (2026-03-12)

### Features

- **auto-tag:** add AI-powered auto-tagging for cases, runs, and sessions ([#127](https://github.com/TestPlanIt/testplanit/issues/127)) ([d01a8da](https://github.com/TestPlanIt/testplanit/commit/d01a8da))

## [0.15.4](https://github.com/TestPlanIt/testplanit/compare/v0.15.3...v0.15.4) (2026-03-11)

### Bug Fixes

- update hono and other dependencies for improved compatibility ([6c92666](https://github.com/TestPlanIt/testplanit/commit/6c926661e499f67773e8681257f02990abfd31e8))

## [0.15.3](https://github.com/TestPlanIt/testplanit/compare/v0.15.2...v0.15.3) (2026-03-11)

### Enhancements

- Replaced deprecated methods with new hooks for fetching project data ([#116](https://github.com/TestPlanIt/testplanit/issues/116)) ([f2edeef](https://github.com/TestPlanIt/testplanit/commit/f2edeef31d2540dc32d25edab002fe0b4ddbe372))

## [0.15.2](https://github.com/TestPlanIt/testplanit/compare/v0.15.1...v0.15.2) (2026-03-09)

### Bug Fixes

- enhance error handling and logging in seed process ([a8e5b53](https://github.com/TestPlanIt/testplanit/commit/a8e5b53650cd38cee0d7070e71a0018beac56906))

## [0.15.0](https://github.com/TestPlanIt/testplanit/compare/v0.14.3...v0.15.0) (2026-03-08)

### Features

- export templates ([adf0655](https://github.com/TestPlanIt/testplanit/commit/adf0655ab24e588a59d238c01e6ec588a843d004))
- export templates ([#84](https://github.com/TestPlanIt/testplanit/issues/84)) ([641bc8b](https://github.com/TestPlanIt/testplanit/commit/641bc8b5f2b2dbdec3d2be3e5c81a44012030e08))
- trigger release ([11d1ca7](https://github.com/TestPlanIt/testplanit/commit/11d1ca7401824d582add416a0652d75f59e9c574))
- trigger v0.15.0 release ([92b19b1](https://github.com/TestPlanIt/testplanit/commit/92b19b132cf91da81c56308e336a9200ce48dc2d))

## [0.15.0](https://github.com/TestPlanIt/testplanit/compare/v0.14.3...v0.15.0) (2026-03-08)

### Features

- export templates ([adf0655](https://github.com/TestPlanIt/testplanit/commit/adf0655ab24e588a59d238c01e6ec588a843d004))
- export templates ([#84](https://github.com/TestPlanIt/testplanit/issues/84)) ([641bc8b](https://github.com/TestPlanIt/testplanit/commit/641bc8b5f2b2dbdec3d2be3e5c81a44012030e08))

## [0.14.3](https://github.com/TestPlanIt/testplanit/compare/v0.14.2...v0.14.3) (2026-03-06)

### Bug Fixes

- **ci:** auto-approve Dependabot PRs before auto-merge ([#110](https://github.com/TestPlanIt/testplanit/issues/110)) ([ccc614d](https://github.com/TestPlanIt/testplanit/commit/ccc614d7311b64db4bc26614644fe0f4913e7e8b))
- **ci:** exclude @types/node from dev-dependency groups ([c9b92c0](https://github.com/TestPlanIt/testplanit/commit/c9b92c05c1657c5eafdd5bd2fb3b5ede9cf3b88b))
- **ci:** ignore major version bumps for packages that break testplanit ([fe5280d](https://github.com/TestPlanIt/testplanit/commit/fe5280d9c7f41272cd03de4d0d0191e035eb656b))
- **docs:** update Jira Forge app documentation with new sections for Test Runs, Sessions, and Test Cases ([8228306](https://github.com/TestPlanIt/testplanit/commit/82283065bf881c420d41230f1730769b1f30d219))
- **forge-app:** strip trailing slashes from URLs in resolver functions ([c2eae82](https://github.com/TestPlanIt/testplanit/commit/c2eae82dffd470e1f5f70aa237ed1175239308a0))

### Enhancements

- **docs:** add Jira Forge app to sidebars configuration ([67a0d87](https://github.com/TestPlanIt/testplanit/commit/67a0d8794f40c39cd2fc1033716da364f3b35d5f))

## [0.14.2](https://github.com/TestPlanIt/testplanit/compare/v0.14.1...v0.14.2) (2026-02-25)

### Features

- **docs:** add client redirects for LLM integrations to prompt configurations ([f7d89aa](https://github.com/TestPlanIt/testplanit/commit/f7d89aab2e29f599d455d39bdb057337ccca2d95))

### Bug Fixes

- **integrations:** add Forge API key authentication for Jira test-info endpoint ([9e1cbe3](https://github.com/TestPlanIt/testplanit/commit/9e1cbe35723c61d1e360392b6058e24c8e3c4fc1))
- **integrations:** add Forge API key authentication for Jira test-info endpoint ([2183a6b](https://github.com/TestPlanIt/testplanit/commit/2183a6b72a9c00c059da41958259e215a2445ef8))

### Enhancements

- **integrations:** add Forge API key authentication for Jira integration ([be246b5](https://github.com/TestPlanIt/testplanit/commit/be246b55698f588ee3f3ab7881ceef9c7629858e))

## [0.15.0](https://github.com/TestPlanIt/testplanit/compare/v0.14.1...v0.15.0) (2026-02-25)

### Features

- **docs:** add client redirects for LLM integrations to prompt configurations ([f7d89aa](https://github.com/TestPlanIt/testplanit/commit/f7d89aab2e29f599d455d39bdb057337ccca2d95))

## [0.14.1](https://github.com/TestPlanIt/testplanit/compare/v0.14.0...v0.14.1) (2026-02-25)

### Bug Fixes

- **docs:** clarify role of Project Administrators in prompt configuration settings ([d0e15aa](https://github.com/TestPlanIt/testplanit/commit/d0e15aa9ffb396e3fb6af64a4e288be918ad2129))
- **docs:** correct link to Prompt Configuration in LLM integrations documentation ([fb17000](https://github.com/TestPlanIt/testplanit/commit/fb170008461750f5b733607c89b782c554b580bd))

## [0.14.0](https://github.com/TestPlanIt/testplanit/compare/v0.13.4...v0.14.0) (2026-02-25)

### Features

- **AdminMenu:** restructure menu options into sections and enhance functionality ([5897547](https://github.com/TestPlanIt/testplanit/commit/5897547ee8bafe838bf77f05bfcbc1e29185dbb2))
- **ProjectMenu:** enhance menu structure and add new settings options ([d515c98](https://github.com/TestPlanIt/testplanit/commit/d515c9815a2ee82cb38b532532ed039aa0e230cf))
- **prompt-config:** add unit tests ([4710b8a](https://github.com/TestPlanIt/testplanit/commit/4710b8a37c120502fa9de6db0334d3c6fb69f649))
- **prompt-config:** introduce PromptConfig and PromptConfigPrompt models ([caf4c9b](https://github.com/TestPlanIt/testplanit/commit/caf4c9b5351966f2d78b6c5b2f02bd750b4021cd))
- **prompts:** enhance project display in prompt configurations ([55b5df0](https://github.com/TestPlanIt/testplanit/commit/55b5df0ecd35b24373eba047aa9a210546679e38))
- **release:** remove v0.13.0 release notes and update v0.14.0 blog title ([089007f](https://github.com/TestPlanIt/testplanit/commit/089007f0a7d89693f6ed97336dbd3842e7b19788))
- **translations:** add prompt configuration translations for Spanish and French ([ceb2df8](https://github.com/TestPlanIt/testplanit/commit/ceb2df8aab14995f4c45d9ef6212d17b20543d1d))
- **user-guide:** update LLM integrations and add prompt configurations section ([17c6ce6](https://github.com/TestPlanIt/testplanit/commit/17c6ce6db5b661dcb7ef4e6b4d014f5496fffbe5))
- **wdio-reporter:** add launcher service for single test run across all spec files ([d1588ba](https://github.com/TestPlanIt/testplanit/commit/d1588ba85bcad5d7ca65dd329258f422f18d055b))

### Bug Fixes

- **ci:** add js-yaml v3 override for read-yaml-file used by changesets ([4e7d15e](https://github.com/TestPlanIt/testplanit/commit/4e7d15ee3347fa3fc2a4bc9e75e091bf37628ac6))
- **ci:** pass --run flag through to vitest in packages-release workflow ([5cbf992](https://github.com/TestPlanIt/testplanit/commit/5cbf992a113f1aa9a2921da02f437cc570c7ebcc))

## [0.13.4](https://github.com/TestPlanIt/testplanit/compare/v0.13.3...v0.13.4) (2026-02-23)

## [0.13.3](https://github.com/TestPlanIt/testplanit/compare/v0.13.2...v0.13.3) (2026-02-23)

### Bug Fixes

- resolve issues with file handling in ImportCasesWizard ([db3f98b](https://github.com/TestPlanIt/testplanit/commit/db3f98b0d61a55cf9ef488d88d27818e369cd15e))

## [0.13.2](https://github.com/TestPlanIt/testplanit/compare/v0.13.1...v0.13.2) (2026-02-23)

### Bug Fixes

- fix the failing unit tests due to UploadAttachments changes ([eff0fdc](https://github.com/TestPlanIt/testplanit/commit/eff0fdc27c47688be4e9cdad2305db17ba501680))
- move ref to useEffect ([7b525f8](https://github.com/TestPlanIt/testplanit/commit/7b525f8bb86fdf4cd58aef595983b82713f191d3))

## [0.13.1](https://github.com/TestPlanIt/testplanit/compare/v0.13.0...v0.13.1) (2026-02-22)

### Bug Fixes

- prevent double-firing of auto-select effect in Cases component ([3d59c0c](https://github.com/TestPlanIt/testplanit/commit/3d59c0c89330bece32efdf425ed4c6d0e040958a))

# [0.13.0](https://github.com/TestPlanIt/testplanit/compare/v0.12.4...v0.13.0) (2026-02-22)

### Bug Fixes

- fix search unit tests since adding pagination info to the search header as well as footer ([82a2676](https://github.com/TestPlanIt/testplanit/commit/82a267620b05141cf87a0e30444f19d8d382fa95))
- implement tenant-aware Elasticsearch sync for multi-tenant support ([5bc207c](https://github.com/TestPlanIt/testplanit/commit/5bc207cdaef94cf4e6e786fc4423b20eb02ae019))
- stabilize DataTable column refs to prevent dialog/modal remounts ([5f57bb5](https://github.com/TestPlanIt/testplanit/commit/5f57bb51fabff02163d1eeb0c2bb6d93824cf5da))
- stabilize DataTable column refs to prevent dialog/modal remounts ([77cf664](https://github.com/TestPlanIt/testplanit/commit/77cf664201dea66b09e0b2c6d87ae347c3cbbe75))
- stabilize mutation refs in admin components to prevent remounts ([dcb3ec5](https://github.com/TestPlanIt/testplanit/commit/dcb3ec5d96fcb6e4ca7d2cb7c3ac42b81a7f4ee4))
- stabilize mutation refs in admin components to prevent remounts ([c2573fb](https://github.com/TestPlanIt/testplanit/commit/c2573fbff7501ffece022c6846bf363308383b05))
- top toast was being covered by bottom toasts preventing text from displaying ([e7fb54d](https://github.com/TestPlanIt/testplanit/commit/e7fb54d85bf30f59c62480affc114d7549a647e2))
- update default color value in FieldIconPicker to undefined ([5b48a54](https://github.com/TestPlanIt/testplanit/commit/5b48a5475a2454cd94a8c56508b0d2cbec01912b))

### Features

- enhance sorting functionality in API tokens and projects ([c41b38b](https://github.com/TestPlanIt/testplanit/commit/c41b38b14a186f8b9da3e9dd7437581309381473))

## [0.12.4](https://github.com/TestPlanIt/testplanit/compare/v0.12.3...v0.12.4) (2026-02-21)

### Bug Fixes

- remove debug console.log statements from production code ([dae2346](https://github.com/TestPlanIt/testplanit/commit/dae2346d2191c68ed25b6597735f005762d4cdb2))

## [0.12.3](https://github.com/TestPlanIt/testplanit/compare/v0.12.2...v0.12.3) (2026-02-21)

## [0.12.2](https://github.com/TestPlanIt/testplanit/compare/v0.12.1...v0.12.2) (2026-02-20)

# [0.12.0](https://github.com/TestPlanIt/testplanit/compare/v0.11.23...v0.12.0) (2026-02-20)

### Features

- add Microsoft SSO integration and demo project with guided tour ([#70](https://github.com/TestPlanIt/testplanit/issues/70)) ([2ab8f62](https://github.com/TestPlanIt/testplanit/commit/2ab8f62d896716ac0617cedd5eb58ed7f200331f))

## [0.11.23](https://github.com/TestPlanIt/testplanit/compare/v0.11.22...v0.11.23) (2026-02-15)

## [0.11.22](https://github.com/TestPlanIt/testplanit/compare/v0.11.21...v0.11.22) (2026-02-13)

## [0.11.21](https://github.com/TestPlanIt/testplanit/compare/v0.11.20...v0.11.21) (2026-02-13)

## [0.11.20](https://github.com/TestPlanIt/testplanit/compare/v0.11.19...v0.11.20) (2026-02-10)

### Bug Fixes

- remap HTTP status codes to prevent nginx ingress interception of API error responses ([ccc1d62](https://github.com/TestPlanIt/testplanit/commit/ccc1d6205be66fe6fb0a0ecb66212c44ff45e8fc))

## [0.11.19](https://github.com/TestPlanIt/testplanit/compare/v0.11.18...v0.11.19) (2026-02-10)

### Bug Fixes

- enhance multi-tenant support in notification service ([#69](https://github.com/TestPlanIt/testplanit/issues/69)) ([6d6037b](https://github.com/TestPlanIt/testplanit/commit/6d6037b93cb0816360788c38c45869aecab23dfa))

## [0.11.18](https://github.com/TestPlanIt/testplanit/compare/v0.11.17...v0.11.18) (2026-02-06)

### Bug Fixes

- Feat/multi tenant testmo import ([#68](https://github.com/TestPlanIt/testplanit/issues/68)) ([44cd5b4](https://github.com/TestPlanIt/testplanit/commit/44cd5b434b6f6f7606ca92cd11a94f7e1b7e0108))

## [0.11.17](https://github.com/TestPlanIt/testplanit/compare/v0.11.16...v0.11.17) (2026-02-06)

### Bug Fixes

- add Node types to TypeScript configuration and clean up test file imports ([101f528](https://github.com/TestPlanIt/testplanit/commit/101f5289f9ce5c9c7b9ba04d0a1754fa3b3bbf5e))

## [0.11.16](https://github.com/TestPlanIt/testplanit/compare/v0.11.15...v0.11.16) (2026-02-05)

### Bug Fixes

- Handle default values for text long / link result fields ([#67](https://github.com/TestPlanIt/testplanit/issues/67)) ([f20a5d4](https://github.com/TestPlanIt/testplanit/commit/f20a5d43423a40e90b18b01d7ecb61fe35f06150))

## [0.11.15](https://github.com/TestPlanIt/testplanit/compare/v0.11.14...v0.11.15) (2026-02-03)

### Bug Fixes

- Long Text/Link case field default does not populate correctly. ([#59](https://github.com/TestPlanIt/testplanit/issues/59)) ([5fc335c](https://github.com/TestPlanIt/testplanit/commit/5fc335cc8e5a0cd20f04b71aac3cfb26cf71869e))

## [0.11.14](https://github.com/TestPlanIt/testplanit/compare/v0.11.13...v0.11.14) (2026-02-02)

### Bug Fixes

- implement batch fetching of test run summaries to optimize performance ([672915b](https://github.com/TestPlanIt/testplanit/commit/672915b12392436ef74cc7c374a4e2b5421b2830))

## [0.11.13](https://github.com/TestPlanIt/testplanit/compare/v0.11.12...v0.11.13) (2026-01-31)

### Performance Improvements

- Performance/optimize test run summary page queries ([#58](https://github.com/TestPlanIt/testplanit/issues/58)) ([64b78a7](https://github.com/TestPlanIt/testplanit/commit/64b78a78ce134cac21834c5e1cbd3ceb86f4d3f6))

## [0.11.12](https://github.com/TestPlanIt/testplanit/compare/v0.11.11...v0.11.12) (2026-01-31)

### Bug Fixes

- add CORS headers to health endpoint for cross-origin requests ([5bdd471](https://github.com/TestPlanIt/testplanit/commit/5bdd471120799cf8e3df891a8b1c45f724fb749f))

## [0.11.11](https://github.com/TestPlanIt/testplanit/compare/v0.11.10...v0.11.11) (2026-01-31)

## [0.11.10](https://github.com/TestPlanIt/testplanit/compare/v0.11.9...v0.11.10) (2026-01-30)

### Bug Fixes

- add request timeout handling and improve GitHub issue ID construction ([cc95702](https://github.com/TestPlanIt/testplanit/commit/cc957021a678abd8a61b57fe629977a6b91c0bce))

## [0.11.9](https://github.com/TestPlanIt/testplanit/compare/v0.11.8...v0.11.9) (2026-01-29)

### Bug Fixes

- update field labels and improve translation handling in IntegrationConfigForm ([0dea63b](https://github.com/TestPlanIt/testplanit/commit/0dea63bb8b06ab52c886a04affae086772695040))

## [0.11.8](https://github.com/TestPlanIt/testplanit/compare/v0.11.7...v0.11.8) (2026-01-29)

## [0.11.7](https://github.com/TestPlanIt/testplanit/compare/v0.11.6...v0.11.7) (2026-01-28)

## [0.11.6](https://github.com/TestPlanIt/testplanit/compare/v0.11.5...v0.11.6) (2026-01-27)

### Bug Fixes

- add manual index sync for when the ehnahnced prisma client is bypassed ([b8e4354](https://github.com/TestPlanIt/testplanit/commit/b8e43543d316ffc8d1f7cd9a7139fb15980cc1db))

## [0.11.5](https://github.com/TestPlanIt/testplanit/compare/v0.11.4...v0.11.5) (2026-01-26)

## [0.11.4](https://github.com/TestPlanIt/testplanit/compare/v0.11.3...v0.11.4) (2026-01-26)

## [0.11.3](https://github.com/TestPlanIt/testplanit/compare/v0.11.2...v0.11.3) (2026-01-25)

### Bug Fixes

- **proxy:** improve language preference handling and preserve error parameters in redirects ([197e339](https://github.com/TestPlanIt/testplanit/commit/197e339701e188e5b798cef3ec14afdfaca5cb13))

## [0.11.2](https://github.com/TestPlanIt/testplanit/compare/v0.11.1...v0.11.2) (2026-01-25)

### Bug Fixes

- **auth:** update GET and POST handlers to await context.params in Next.js 15+ ([35aef69](https://github.com/TestPlanIt/testplanit/commit/35aef6975896b5e721e86a7f3be74c7fbc70f455))

## [0.11.1](https://github.com/TestPlanIt/testplanit/compare/v0.11.0...v0.11.1) (2026-01-25)

# [0.11.0](https://github.com/TestPlanIt/testplanit/compare/v0.10.14...v0.11.0) (2026-01-25)

### Features

- add Share Links feature for secure report and content sharing ([#54](https://github.com/TestPlanIt/testplanit/issues/54)) ([78ad1f7](https://github.com/TestPlanIt/testplanit/commit/78ad1f7038035dc2f26aec1d01a50dc8db9a8337))

## [0.10.14](https://github.com/TestPlanIt/testplanit/compare/v0.10.13...v0.10.14) (2026-01-23)

### Bug Fixes

- update dependencies and enhance user profile features ([180b34b](https://github.com/TestPlanIt/testplanit/commit/180b34bf6450bb01edc54839978feecc396c8586))
- update dependency specifiers in pnpm-lock.yaml ([2265e4c](https://github.com/TestPlanIt/testplanit/commit/2265e4c408dec19bca57d992a907091b774dfba1))

## [0.10.13](https://github.com/TestPlanIt/testplanit/compare/v0.10.12...v0.10.13) (2026-01-23)

### Bug Fixes

- Fix/minor bug fixes ([#53](https://github.com/TestPlanIt/testplanit/issues/53)) ([932fce9](https://github.com/TestPlanIt/testplanit/commit/932fce96c9cbccedb90b87b74f410e2ff5b93f5f))

## [0.10.12](https://github.com/TestPlanIt/testplanit/compare/v0.10.11...v0.10.12) (2026-01-22)

### Bug Fixes

- add pnpm overrides for security vulnerabilities ([87d845a](https://github.com/TestPlanIt/testplanit/commit/87d845a397f49dbf5f9414802eadd0fcc6f1830b))
- Fix/e2e test fixes ([#52](https://github.com/TestPlanIt/testplanit/issues/52)) ([df8cc36](https://github.com/TestPlanIt/testplanit/commit/df8cc369d07b01e85f54eebb4eca22a5a9a3afb9)), closes [#96](https://github.com/TestPlanIt/testplanit/issues/96) [#94](https://github.com/TestPlanIt/testplanit/issues/94) [#99](https://github.com/TestPlanIt/testplanit/issues/99) [#98](https://github.com/TestPlanIt/testplanit/issues/98) [#102-107](https://github.com/TestPlanIt/testplanit/issues/102-107)

## [0.10.11](https://github.com/TestPlanIt/testplanit/compare/v0.10.10...v0.10.11) (2026-01-22)

### Bug Fixes

- resolve Dependabot security vulnerabilities ([9a17d3f](https://github.com/TestPlanIt/testplanit/commit/9a17d3f8a6926014d7796365d2fed74432a472e2)), closes [#96](https://github.com/TestPlanIt/testplanit/issues/96) [#94](https://github.com/TestPlanIt/testplanit/issues/94) [#99](https://github.com/TestPlanIt/testplanit/issues/99) [#98](https://github.com/TestPlanIt/testplanit/issues/98) [#102-107](https://github.com/TestPlanIt/testplanit/issues/102-107)

## [0.10.10](https://github.com/TestPlanIt/testplanit/compare/v0.10.9...v0.10.10) (2026-01-21)

### Bug Fixes

- enhance user profile link accessibility and update API usage ([fc01faf](https://github.com/TestPlanIt/testplanit/commit/fc01faf2992e7bdf994fb2dcb339bcbb80d68253))

## [0.10.9](https://github.com/TestPlanIt/testplanit/compare/v0.10.8...v0.10.9) (2026-01-21)

### Bug Fixes

- streamline query refetching in user management components ([e859352](https://github.com/TestPlanIt/testplanit/commit/e859352759901394429f54b666816d55d775c27f))

## [0.10.8](https://github.com/TestPlanIt/testplanit/compare/v0.10.7...v0.10.8) (2026-01-20)

### Bug Fixes

- apply Redis connection type fix to workers and scripts ([65d843d](https://github.com/TestPlanIt/testplanit/commit/65d843d5963eec0bc5f4c8435f274bc556a65d66))

## [0.10.7](https://github.com/TestPlanIt/testplanit/compare/v0.10.6...v0.10.7) (2026-01-20)

### Bug Fixes

- update Redis connection type in queue initialization ([76bc417](https://github.com/TestPlanIt/testplanit/commit/76bc4178841d9fb2ce03edcc58a4ba2743cb60f4))

## [0.10.6](https://github.com/TestPlanIt/testplanit/compare/v0.10.5...v0.10.6) (2026-01-19)

### Bug Fixes

- prevent race condition when trying to add new user preferences before the user is created ([d8586e5](https://github.com/TestPlanIt/testplanit/commit/d8586e5b67ee12d88850d48b1744ed9d57ff6178))

## [0.10.5](https://github.com/TestPlanIt/testplanit/compare/v0.10.4...v0.10.5) (2026-01-17)

## [0.10.4](https://github.com/TestPlanIt/testplanit/compare/v0.10.3...v0.10.4) (2026-01-17)

### Bug Fixes

- ensure db-init-prod service builds correctly in Docker production ([#48](https://github.com/TestPlanIt/testplanit/issues/48)) ([558c735](https://github.com/TestPlanIt/testplanit/commit/558c735b7ce8aa4ebaa43795bd8c00a541d7ea9f))

## [0.10.3](https://github.com/TestPlanIt/testplanit/compare/v0.10.2...v0.10.3) (2026-01-16)

## [0.10.2](https://github.com/TestPlanIt/testplanit/compare/v0.10.1...v0.10.2) (2026-01-14)

### Bug Fixes

- add validation checks for data integrity in various charts ([8861224](https://github.com/TestPlanIt/testplanit/commit/886122471a869a37bfe1c0c8f8991a6c6eeac959))

## [0.10.1](https://github.com/TestPlanIt/testplanit/compare/v0.10.0...v0.10.1) (2026-01-13)

### Bug Fixes

- **FlakyTestsBubbleChart:** enhance execution checks and data handling ([ee9097c](https://github.com/TestPlanIt/testplanit/commit/ee9097c82c5f6d24a65f6f0d68a308c3c6a35436))

# [0.10.0](https://github.com/TestPlanIt/testplanit/compare/v0.9.30...v0.10.0) (2026-01-13)

### Features

- release v0.10.0 - reporting enhancements and version management improvements ([#46](https://github.com/TestPlanIt/testplanit/issues/46)) ([9e73faf](https://github.com/TestPlanIt/testplanit/commit/9e73faf62efbd7eca26ab9f1020a048a83fe00d3))

## [0.9.30](https://github.com/TestPlanIt/testplanit/compare/v0.9.29...v0.9.30) (2026-01-13)

### Bug Fixes

- **dependencies:** update package versions and improve two-factor authentication handling ([63e178f](https://github.com/TestPlanIt/testplanit/commit/63e178f37bc15f2b362330f8d8cea99de93f3ee8))

## [0.9.29](https://github.com/TestPlanIt/testplanit/compare/v0.9.28...v0.9.29) (2026-01-10)

### Bug Fixes

- **issue-columns:** Update Issue Tracking report dimensions ([0170744](https://github.com/TestPlanIt/testplanit/commit/0170744fbf5e75f4c5c9b48bae99e60abcd945ae))

## [0.9.28](https://github.com/TestPlanIt/testplanit/compare/v0.9.27...v0.9.28) (2026-01-09)

### Bug Fixes

- **notification:** enhance notification preferences with global mode label ([79a27a9](https://github.com/TestPlanIt/testplanit/commit/79a27a9b58f6f7d0a599b12fba35774eea01e733))

## [0.9.27](https://github.com/TestPlanIt/testplanit/compare/v0.9.26...v0.9.27) (2026-01-09)

### Bug Fixes

- **localization:** update notification and digest messages for English, Spanish, and French ([f698d68](https://github.com/TestPlanIt/testplanit/commit/f698d68332d0ae99a927709c05c6ab4c563fb37b))

## [0.9.26](https://github.com/TestPlanIt/testplanit/compare/v0.9.25...v0.9.26) (2026-01-09)

## [0.9.25](https://github.com/TestPlanIt/testplanit/compare/v0.9.24...v0.9.25) (2026-01-08)

### Bug Fixes

- **db:** accept data loss on db push due to a new unique constraint ([0d8bc0f](https://github.com/TestPlanIt/testplanit/commit/0d8bc0fb338e8d1bae55dd66c93aa5c5d02ef600))

## [0.9.24](https://github.com/TestPlanIt/testplanit/compare/v0.9.23...v0.9.24) (2026-01-08)

## [0.9.23](https://github.com/TestPlanIt/testplanit/compare/v0.9.22...v0.9.23) (2026-01-08)

### Bug Fixes

- **dependencies:** downgrade form-data version in pnpm-lock.yaml ([660f218](https://github.com/TestPlanIt/testplanit/commit/660f218e266fb501234dacf329d6796e0f004fd4))
- **dependencies:** update package versions in pnpm-lock.yaml and package.json ([fb6c0ba](https://github.com/TestPlanIt/testplanit/commit/fb6c0ba0156e618956a0364b8089aac6e2db0251))

## [0.9.22](https://github.com/TestPlanIt/testplanit/compare/v0.9.21...v0.9.22) (2026-01-07)

### Bug Fixes

- **prisma:** update workflow states in seed data ([5d9c573](https://github.com/TestPlanIt/testplanit/commit/5d9c573687cd2f5519f67c08f04ad02eeaae77fe))

## [0.9.21](https://github.com/TestPlanIt/testplanit/compare/v0.9.20...v0.9.21) (2026-01-07)

## [0.9.20](https://github.com/TestPlanIt/testplanit/compare/v0.9.19...v0.9.20) (2026-01-06)

### Bug Fixes

- **theme:** update theme reference in MilestoneDisplay component ([13747b4](https://github.com/TestPlanIt/testplanit/commit/13747b460a09100b27503b003a534479b3723c41))

## [0.9.19](https://github.com/TestPlanIt/testplanit/compare/v0.9.18...v0.9.19) (2026-01-06)

### Bug Fixes

- **theme:** replace theme with resolvedTheme in multiple components and update theme options ([ce9cfb7](https://github.com/TestPlanIt/testplanit/commit/ce9cfb77b91fa9f47cd3db4c6d8bf243d8806ed1))

## [0.9.18](https://github.com/TestPlanIt/testplanit/compare/v0.9.17...v0.9.18) (2026-01-06)

### Bug Fixes

- **cli-release:** enable npm publishing in release configuration ([5c751a9](https://github.com/TestPlanIt/testplanit/commit/5c751a926d40660c71303a71ce47753ffa531cc3))

## [0.9.17](https://github.com/TestPlanIt/testplanit/compare/v0.9.16...v0.9.17) (2026-01-05)

## [0.9.16](https://github.com/TestPlanIt/testplanit/compare/v0.9.15...v0.9.16) (2026-01-04)

### Bug Fixes

- **JunitTableSection:** update translation key for completed date display ([c474c32](https://github.com/TestPlanIt/testplanit/commit/c474c321f00ccc88fa4ed5009187840cb4c45f69))

## [0.9.15](https://github.com/TestPlanIt/testplanit/compare/v0.9.14...v0.9.15) (2026-01-04)

## [0.9.14](https://github.com/TestPlanIt/testplanit/compare/v0.9.13...v0.9.14) (2026-01-04)

## [0.9.13](https://github.com/TestPlanIt/testplanit/compare/v0.9.12...v0.9.13) (2026-01-04)

### Bug Fixes

- **translations:** streamline translation usage across components ([de33bcb](https://github.com/TestPlanIt/testplanit/commit/de33bcb5963118c77bfba0e2534d1db8a6cf73f7))

## [0.9.12](https://github.com/TestPlanIt/testplanit/compare/v0.9.11...v0.9.12) (2026-01-04)

### Bug Fixes

- **testResultsParser:** update duration normalization logic to ensure consistent conversion from milliseconds to seconds ([9094504](https://github.com/TestPlanIt/testplanit/commit/9094504fce2cda2119f1ef2ed9bc5761c2cba1be))

## [0.9.11](https://github.com/TestPlanIt/testplanit/compare/v0.9.10...v0.9.11) (2026-01-04)

### Bug Fixes

- **translations:** Update related import messages for consistency across test result formats. ([19e69b8](https://github.com/TestPlanIt/testplanit/commit/19e69b86ae2b49fb992f9c4696ddafd4017c372d))

## [0.9.10](https://github.com/TestPlanIt/testplanit/compare/v0.9.9...v0.9.10) (2026-01-01)

### Bug Fixes

- **Cases, columns:** show grip handle when data table rows are sortable in Cases.tsx ([89bba65](https://github.com/TestPlanIt/testplanit/commit/89bba6563ec9fbb10b6a3fc952f3995e0b466740))

## [0.9.9](https://github.com/TestPlanIt/testplanit/compare/v0.9.8...v0.9.9) (2025-12-31)

### Bug Fixes

- **CustomNode:** remove CustomNode component ([876af42](https://github.com/TestPlanIt/testplanit/commit/876af429d5abbce51f34d4b2e194f2f076c1567e))

## [0.9.8](https://github.com/TestPlanIt/testplanit/compare/v0.9.7...v0.9.8) (2025-12-31)

### Bug Fixes

- **tags:** implement case-insensitive tag matching and restore soft-deleted tags ([c395d73](https://github.com/TestPlanIt/testplanit/commit/c395d73b7e1ef2406cfaf232b0d73548c12b3722))
- **tags:** update tag handling in CSV import process ([c85328f](https://github.com/TestPlanIt/testplanit/commit/c85328faa92bbd89a650c0e4dded1cb2be5b531c))

## [0.9.7](https://github.com/TestPlanIt/testplanit/compare/v0.9.6...v0.9.7) (2025-12-31)

### Bug Fixes

- **TestRunPage:** wrap AddTestRunModal in SimpleDndProvider for drag-and-drop context ([f667303](https://github.com/TestPlanIt/testplanit/commit/f6673036c59bc7929a09446b4d96ca5db6e7f5af))

## [0.9.6](https://github.com/TestPlanIt/testplanit/compare/v0.9.5...v0.9.6) (2025-12-31)

### Bug Fixes

- **columns:** improve error handling in column data processing ([a859481](https://github.com/TestPlanIt/testplanit/commit/a859481cde0be1887eac20fa8b4b8d8c402c8d2b))

## [0.9.5](https://github.com/TestPlanIt/testplanit/compare/v0.9.4...v0.9.5) (2025-12-31)

### Bug Fixes

- **columns:** add optional chaining to prevent runtime errors ([2f71454](https://github.com/TestPlanIt/testplanit/commit/2f71454a4a5ec8d72ab19a7ed26ce919bfce831b))

## [0.9.4](https://github.com/TestPlanIt/testplanit/compare/v0.9.3...v0.9.4) (2025-12-31)

### Bug Fixes

- **UserProfile:** enhance date formatting logic to include time format ([1f4d45e](https://github.com/TestPlanIt/testplanit/commit/1f4d45ef8d3471cb169217001263c6402b468ae9))

## [0.9.3](https://github.com/TestPlanIt/testplanit/compare/v0.9.2...v0.9.3) (2025-12-30)

### Bug Fixes

- **folders:** Fix the folder issues described in Issue 33 ([#35](https://github.com/TestPlanIt/testplanit/issues/35)) ([f94a1a0](https://github.com/TestPlanIt/testplanit/commit/f94a1a0f9c9e3950fec28a7024f81b32ea3b94c0))

## [0.9.2](https://github.com/TestPlanIt/testplanit/compare/v0.9.1...v0.9.2) (2025-12-30)

### Bug Fixes

- **tooltip:** update TooltipTrigger components to include type="button" ([d0fb809](https://github.com/TestPlanIt/testplanit/commit/d0fb80906584768da6da81c969ef9c62c7284b0d))

## [0.9.1](https://github.com/TestPlanIt/testplanit/compare/v0.9.0...v0.9.1) (2025-12-30)

### Bug Fixes

- **tiptap:** prevent rendering of ContentItemMenu when editor lacks plugin support ([d33d52f](https://github.com/TestPlanIt/testplanit/commit/d33d52f38645c2ccb5c6d36df3c86d63f3e5f1e7))

# [0.9.0](https://github.com/TestPlanIt/testplanit/compare/v0.8.27...v0.9.0) (2025-12-30)

### Features

- **tiptap:** add ContentItemMenu and drag handle functionality ([85d8c4a](https://github.com/TestPlanIt/testplanit/commit/85d8c4a66e623fc89c488ae64989a981472cfdbb))

## [0.8.27](https://github.com/TestPlanIt/testplanit/compare/v0.8.26...v0.8.27) (2025-12-30)

### Bug Fixes

- **bulk-edit:** increment version number in bulk edit route ([ba93044](https://github.com/TestPlanIt/testplanit/commit/ba93044041037e39b77183d5f670976d2dd222da))

## [0.8.26](https://github.com/TestPlanIt/testplanit/compare/v0.8.25...v0.8.26) (2025-12-30)

### Bug Fixes

- **bulk-edit:** update state handling in bulk edit route ([18e68c9](https://github.com/TestPlanIt/testplanit/commit/18e68c93b4b9cbb3d78bd19f05c02bc17e092307))

## [0.8.25](https://github.com/TestPlanIt/testplanit/compare/v0.8.24...v0.8.25) (2025-12-29)

### Bug Fixes

- **translations:** update error messages and display names for better user experience ([05967df](https://github.com/TestPlanIt/testplanit/commit/05967dfc469947eb1f78818143a0f011a9c6aa0e))

## [0.8.24](https://github.com/TestPlanIt/testplanit/compare/v0.8.23...v0.8.24) (2025-12-29)

## [0.8.23](https://github.com/TestPlanIt/testplanit/compare/v0.8.22...v0.8.23) (2025-12-29)

### Bug Fixes

- **translations:** add new translation keys for workflow types and dimensions ([475c5cc](https://github.com/TestPlanIt/testplanit/commit/475c5ccb38187cfa6197b4d109fdc5842351e359))

## [0.8.22](https://github.com/TestPlanIt/testplanit/compare/v0.8.21...v0.8.22) (2025-12-29)

### Bug Fixes

- **translations:** update translation keys and improve localization consistency ([c733c9d](https://github.com/TestPlanIt/testplanit/commit/c733c9db5665de8621b167d752b4bedf02ad30f3))

## [0.8.21](https://github.com/TestPlanIt/testplanit/compare/v0.8.20...v0.8.21) (2025-12-28)

### Bug Fixes

- **adapter:** enhance URL validation in AzureOpenAIAdapter's testConnection method ([fb3d0fa](https://github.com/TestPlanIt/testplanit/commit/fb3d0fab714f66c81bfb3d747ab9cf94665c7a66))

## [0.8.20](https://github.com/TestPlanIt/testplanit/compare/v0.8.19...v0.8.20) (2025-12-27)

## [0.8.18](https://github.com/TestPlanIt/testplanit/compare/v0.8.17...v0.8.18) (2025-12-16)

### Bug Fixes

- **env:** update DATABASE_URL in .env.example for consistency with Docker setup ([28ac66e](https://github.com/TestPlanIt/testplanit/commit/28ac66ee1d757557ee35b36e3b98d22859f73146))

## [0.8.17](https://github.com/TestPlanIt/testplanit/compare/v0.8.16...v0.8.17) (2025-12-16)

### Bug Fixes

- **env:** update DATABASE_URL in .env.example for Docker compatibility ([398838c](https://github.com/TestPlanIt/testplanit/commit/398838c053ca8be445dcc7fac730b3034637754d))

## [0.8.16](https://github.com/TestPlanIt/testplanit/compare/v0.8.15...v0.8.16) (2025-12-16)

### Bug Fixes

- **docker:** use testplanit-specific lockfile instead of monorepo lockfile ([da46c98](https://github.com/TestPlanIt/testplanit/commit/da46c984918b13a01c0711ec6a6b1fabb5ea0898))

## [0.8.15](https://github.com/TestPlanIt/testplanit/compare/v0.8.14...v0.8.15) (2025-12-16)

### Bug Fixes

- **env:** update DATABASE_URL port in .env.example for consistency with Docker setup ([93d6bd9](https://github.com/TestPlanIt/testplanit/commit/93d6bd932f89e0ee238c9ff72f59ef1f771c69c0))

## [0.8.14](https://github.com/TestPlanIt/testplanit/compare/v0.8.13...v0.8.14) (2025-12-15)

### Bug Fixes

- **docker:** add lockfile to testplanit for local Docker builds ([3d1dd94](https://github.com/TestPlanIt/testplanit/commit/3d1dd9475e38184fffbd922f622e0a2ff65f0ded))

## [0.8.13](https://github.com/TestPlanIt/testplanit/compare/v0.8.12...v0.8.13) (2025-12-15)

### Bug Fixes

- **docker:** resolve lockfile not found error in Docker builds ([f9e48f6](https://github.com/TestPlanIt/testplanit/commit/f9e48f6e74784f53bf4f3fff80360b47f2403804))

## [0.8.12](https://github.com/TestPlanIt/testplanit/compare/v0.8.11...v0.8.12) (2025-12-15)

### Bug Fixes

- **emailWorker:** update notification handling for SYSTEM_ANNOUNCEMENT ([978c773](https://github.com/TestPlanIt/testplanit/commit/978c7735696b4bd1f95ebf0e5e33ca8cca2a7974))

## [0.8.10](https://github.com/TestPlanIt/testplanit/compare/v0.8.9...v0.8.10) (2025-12-15)

### Bug Fixes

- **changesets:** use correct package names in ignore list ([e0a61cb](https://github.com/TestPlanIt/testplanit/commit/e0a61cb4650a2d824071b54bdc8a6114a74cd0ce))

## [0.8.9](https://github.com/TestPlanIt/testplanit/compare/v0.8.8...v0.8.9) (2025-12-15)

### Bug Fixes

- **ci:** skip postinstall scripts in package release workflow ([4624c92](https://github.com/TestPlanIt/testplanit/commit/4624c92ebdd6de67097ad7f371ac39a236d31735))

## [0.8.8](https://github.com/TestPlanIt/testplanit/compare/v0.8.7...v0.8.8) (2025-12-13)

## [0.8.7](https://github.com/TestPlanIt/testplanit/compare/v0.8.6...v0.8.7) (2025-12-12)

### Bug Fixes

- **dependencies:** update package versions and add new translations ([0d2ce7c](https://github.com/TestPlanIt/testplanit/commit/0d2ce7cda1e2399fe2dc5b742654a032c7c322c5))

## [0.8.6](https://github.com/TestPlanIt/testplanit/compare/v0.8.5...v0.8.6) (2025-12-12)

## [0.8.5](https://github.com/TestPlanIt/testplanit/compare/v0.8.4...v0.8.5) (2025-12-11)

### Bug Fixes

- **ci:** use PAT token to trigger Docker build workflow ([5f34752](https://github.com/TestPlanIt/testplanit/commit/5f347528f945818ddde652b4873847fa23ac049d))

## [0.8.4](https://github.com/TestPlanIt/testplanit/compare/v0.8.3...v0.8.4) (2025-12-11)

### Bug Fixes

- **audit-logs:** add new audit actions for API key management ([62bed46](https://github.com/TestPlanIt/testplanit/commit/62bed466997c1e0e5260af70df31257aece605a2))

## [0.8.2](https://github.com/TestPlanIt/testplanit/compare/v0.8.1...v0.8.2) (2025-12-11)

### Bug Fixes

- **comments:** add milestone support to UserMentionedComments component ([88cf140](https://github.com/TestPlanIt/testplanit/commit/88cf140afd15d25f8a868a5426a3a64a93f4a6e3))

## [0.8.1](https://github.com/TestPlanIt/testplanit/compare/v0.8.0...v0.8.1) (2025-12-11)

### Bug Fixes

- **docs:** update CLI installation instructions and enhance notification content ([374bd2e](https://github.com/TestPlanIt/testplanit/commit/374bd2ee7908bfdd64e609f9532a07202c2ccc1d))

# [0.8.0](https://github.com/TestPlanIt/testplanit/compare/v0.7.2...v0.8.0) (2025-12-11)

### Features

- add CLI tool for test result imports and API token authentication ([#22](https://github.com/TestPlanIt/testplanit/issues/22)) ([4c889c3](https://github.com/TestPlanIt/testplanit/commit/4c889c385b964a82b936022eb045a40bd2cf78dc))

## [0.7.1](https://github.com/TestPlanIt/testplanit/compare/v0.7.0...v0.7.1) (2025-12-09)

### Bug Fixes

- **docs:** update data-domain in Docusaurus config and improve form handling in TestResultsImportDialog ([97f2823](https://github.com/TestPlanIt/testplanit/commit/97f2823923ae00c13033e83d6c1911722a53b7c3))

# [0.7.0](https://github.com/TestPlanIt/testplanit/compare/v0.6.1...v0.7.0) (2025-12-09)

### Features

- **import:** expand automated test results import for JUnit, TestNG, NUnit, xUnit, MSTest, Mocha, and Cucumber ([#20](https://github.com/TestPlanIt/testplanit/issues/20)) ([a7856cd](https://github.com/TestPlanIt/testplanit/commit/a7856cde96c0d3482f78469dfb720beb86e7196d))

## [0.6.1](https://github.com/TestPlanIt/testplanit/compare/v0.6.0...v0.6.1) (2025-12-09)

# [0.6.0](https://github.com/TestPlanIt/testplanit/compare/v0.5.3...v0.6.0) (2025-12-09)

### Features

- **auth:** add two-factor authentication ([#19](https://github.com/TestPlanIt/testplanit/issues/19)) ([662ce57](https://github.com/TestPlanIt/testplanit/commit/662ce5742f659bbeb84f6eab1e8e3768db31b193))

## [0.5.3](https://github.com/TestPlanIt/testplanit/compare/v0.5.2...v0.5.3) (2025-12-08)

### Bug Fixes

- **auditLog:** validate projectId existence before logging and handle non-existent projects ([75e85a8](https://github.com/TestPlanIt/testplanit/commit/75e85a8e194b1316a81eabfaf07528fef1584b3d))
- **testCase:** sync case field values on details page ([1fc701a](https://github.com/TestPlanIt/testplanit/commit/1fc701a526021901d62a184c6184b2af3a9786f6))

## [0.5.2](https://github.com/TestPlanIt/testplanit/compare/v0.5.1...v0.5.2) (2025-12-08)

### Bug Fixes

- **build:** add auditLogWorker to entry points ([001a432](https://github.com/TestPlanIt/testplanit/commit/001a43233580e90dfc5e8e88e9841b635e5d67e9))

## [0.5.1](https://github.com/TestPlanIt/testplanit/compare/v0.5.0...v0.5.1) (2025-12-08)

# [0.5.0](https://github.com/TestPlanIt/testplanit/compare/v0.4.1...v0.5.0) (2025-12-08)

### Features

- add audit logging for compliance and traceability ([#18](https://github.com/TestPlanIt/testplanit/issues/18)) ([7695a46](https://github.com/TestPlanIt/testplanit/commit/7695a461cb9129cfc0c62b75638dff71fa39064d))

## [0.4.1](https://github.com/TestPlanIt/testplanit/compare/v0.4.0...v0.4.1) (2025-12-07)

### Bug Fixes

- **issues:** add status and priority filters to issues page ([182be68](https://github.com/TestPlanIt/testplanit/commit/182be680cf33cfbeb8bacf57d72189bde79c192e))

# [0.4.0](https://github.com/TestPlanIt/testplanit/compare/v0.3.0...v0.4.0) (2025-12-07)

### Features

- bump version to 0.3.0 and add Magic Select announcement ([d98b977](https://github.com/TestPlanIt/testplanit/commit/d98b977115d8fe2634bcf51bafc5ac71bc4c1ecf))

## [0.2.7](https://github.com/TestPlanIt/testplanit/compare/v0.2.6...v0.2.7) (2025-12-07)

### Bug Fixes

- **api:** enhance project access control logic ([6a1548c](https://github.com/TestPlanIt/testplanit/commit/6a1548c8b2bc9c18c4971fb25703aa00e753d839))

## [0.2.6](https://github.com/TestPlanIt/testplanit/compare/v0.2.5...v0.2.6) (2025-12-06)

### Bug Fixes

- **issues:** simplify access control logic and remove redundant project filter ([86d6632](https://github.com/TestPlanIt/testplanit/commit/86d663236a9e19e0c1a0b00dd679bb93d72d640e))

## [0.2.5](https://github.com/TestPlanIt/testplanit/compare/v0.2.4...v0.2.5) (2025-12-06)

### Bug Fixes

- **api:** add cache-control headers to prevent stale API responses ([5a8ac7f](https://github.com/TestPlanIt/testplanit/commit/5a8ac7f45400d7250013c03c7f931c6f07db56ac))

## [0.2.4](https://github.com/TestPlanIt/testplanit/compare/v0.2.3...v0.2.4) (2025-12-06)

### Bug Fixes

- **permissions:** enhance access control for notifications and user data retrieval ([d9037ec](https://github.com/TestPlanIt/testplanit/commit/d9037ec4abe22d33ca468ce5705eb46f889ca94c))

## [0.2.3](https://github.com/TestPlanIt/testplanit/compare/v0.2.2...v0.2.3) (2025-12-06)

### Bug Fixes

- **ci:** improve version extraction and Docker build trigger logic in semantic-release workflow ([b873eaa](https://github.com/TestPlanIt/testplanit/commit/b873eaa68ead89e5e14c0a241affb54a938b498e))

## [0.2.2](https://github.com/TestPlanIt/testplanit/compare/v0.2.1...v0.2.2) (2025-12-06)

### Bug Fixes

- **permissions:** improve access control checks and notification handling ([c7984c7](https://github.com/TestPlanIt/testplanit/commit/c7984c7b7b11e8863a43785243a25176e2364121))

## [0.2.1](https://github.com/TestPlanIt/testplanit/compare/v0.2.0...v0.2.1) (2025-12-06)

### Bug Fixes

- **permissions:** enhance project access control logic ([8151e83](https://github.com/TestPlanIt/testplanit/commit/8151e83c72a3a2c91ed455a794b86ab4c50f8345))

# [0.2.0](https://github.com/TestPlanIt/testplanit/compare/v0.1.40...v0.2.0) (2025-12-06)

### Features

- **ProjectRepository:** implement auto-paging for selected test case in run mode ([e8d638c](https://github.com/TestPlanIt/testplanit/commit/e8d638c870bdfe2a6a93d7a3430fd95ef8bc7fd6))

## [0.1.40](https://github.com/TestPlanIt/testplanit/compare/v0.1.39...v0.1.40) (2025-12-06)

### Bug Fixes

- **tags:** enhance project access logic to include PROJECTADMIN role ([7972ac1](https://github.com/TestPlanIt/testplanit/commit/7972ac1abceea74c0b2f1cee46120c08cf1677fa))

# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.1.39](https://github.com/TestPlanIt/testplanit/compare/v0.1.38...v0.1.39) (2025-12-05)

### Features

- **milestones:** add comments support ([#15](https://github.com/TestPlanIt/testplanit/issues/15)) ([a5e60b2](https://github.com/TestPlanIt/testplanit/commit/a5e60b2d6a150e0a618d3f0f93e819d9c7aebf1c))

## [0.1.38](https://github.com/TestPlanIt/testplanit/compare/v0.1.37...v0.1.38) (2025-12-05)

### Features

- **api:** Enhance API documentation and integrate Swagger UI ([#6](https://github.com/TestPlanIt/testplanit/issues/6)) ([8b6d6b2](https://github.com/TestPlanIt/testplanit/commit/8b6d6b218d9d92277aee963ae43a83da4b83fa6d))
- **api:** Implement external API request detection and enhance JWT handling ([6924a79](https://github.com/TestPlanIt/testplanit/commit/6924a79b093ec7f133fc6c0c5969c3f96c6e9f34))
- **auth:** Hash magic link token before storing in database ([0d7ce6e](https://github.com/TestPlanIt/testplanit/commit/0d7ce6eee218016f85029d1433d5b0302aec3277))
- **elasticsearch:** Add multi-tenant mode support in ElasticsearchAdmin ([1003b40](https://github.com/TestPlanIt/testplanit/commit/1003b40259ce51457f6ce46f018dcf31648f1166))
- **email:** Add baseUrl to notification and digest email data for tenant-specific URLs ([7474df6](https://github.com/TestPlanIt/testplanit/commit/7474df6c90eff155cf2485deb4088cb9100b7f09))
- Enhance Elasticsearch index filtering for multi-tenant support ([63662b6](https://github.com/TestPlanIt/testplanit/commit/63662b6b0e5c1d0bf98252dc4b82531e785256ee))
- **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/TestPlanIt/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
- Milestone auto-completion and due date notifications ([#10](https://github.com/TestPlanIt/testplanit/issues/10)) ([665b5a2](https://github.com/TestPlanIt/testplanit/commit/665b5a208090246f7f75eccf54ae79451ea9450e))
- **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/TestPlanIt/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))
- **multiTenant:** Add baseUrl to TenantConfig and update email worker to utilize tenant-specific base URLs for notifications ([28dc26e](https://github.com/TestPlanIt/testplanit/commit/28dc26eac1675f23f7638bcc3b169fc7ff713044))
- **multiTenant:** Enhance storage mode detection and add baseUrl to tenant configurations ([60af2f4](https://github.com/TestPlanIt/testplanit/commit/60af2f4a31d38959eb2451cf8ebb333fa7f3d8e2))
- **multiTenant:** Update tenant configuration to include baseUrl in environment variable format ([f7be7de](https://github.com/TestPlanIt/testplanit/commit/f7be7dec4964a820dd37cc4bc684ea83dd89cf8f))
- **permissions:** Enhance access control for project roles ([39292f6](https://github.com/TestPlanIt/testplanit/commit/39292f6dc34f9f72b9b3fe301544ad4bd636262a))
- **permissions:** Expand access control for project roles ([429fd42](https://github.com/TestPlanIt/testplanit/commit/429fd426f1387d01c176301caaef20beab2b935c))
- **translations:** Add "required for Admin" translations in English, Spanish, and French ([356b392](https://github.com/TestPlanIt/testplanit/commit/356b3924915d33d16435a63bd3db98ecbbf9eb53))
- **users:** Enhance user management with API access control for ADMIN users ([6e06acf](https://github.com/TestPlanIt/testplanit/commit/6e06acff204b5dfa50090dd7324e9fa401f1ade1))

### Bug Fixes

- **auth:** Clarify comments in magic link token hashing logic ([ccb5ee7](https://github.com/TestPlanIt/testplanit/commit/ccb5ee784a7f8558cdb6dee929d173965d4e68de))
- **Dockerfile:** Ensure translation files are copied to both reference and distribution directories for email worker ([6fe3cf4](https://github.com/TestPlanIt/testplanit/commit/6fe3cf472ba27e7f2223ffb32bbc07c4b2cc1c03))
- **docker:** Replace postgresql15-client with postgresql-client in Dockerfile for compatibility ([deb29ec](https://github.com/TestPlanIt/testplanit/commit/deb29ecffdb0faba1afeae6d269fd5642da4f249))
- Improve days difference calculation for milestone notifications ([2954364](https://github.com/TestPlanIt/testplanit/commit/29543646b65784a4e474c40419924ba067178e5c))
- Invalidate cached Prisma clients when tenant credentials change ([437c8dc](https://github.com/TestPlanIt/testplanit/commit/437c8dcfa17851f9c68ef929473c2ba47c5ff0c5))
- **layout:** Refactor storage mode detection logic for clarity ([3c060e5](https://github.com/TestPlanIt/testplanit/commit/3c060e56d73f1a8f376d29aab42fa04c998032c5))
- **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/TestPlanIt/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))
- **tags:** simplify access control logic ([3945a39](https://github.com/TestPlanIt/testplanit/commit/3945a39936f46ef22ada05fb34efe31d823280c7))
- **users:** Disable API toggle for ADMIN access level ([29f3df9](https://github.com/TestPlanIt/testplanit/commit/29f3df9561fcdad5174355f4179076151c46eb1f))
- **workers:** testmoImportWorker was using old generateRandomPassword code. ([be87543](https://github.com/TestPlanIt/testplanit/commit/be87543b9b7f97f1b6dc1330dd4ee9999a3fbed7))

### Miscellaneous Chores

- **dependencies:** update package versions and add new dependencies ([be87543](https://github.com/TestPlanIt/testplanit/commit/be87543b9b7f97f1b6dc1330dd4ee9999a3fbed7))
- **dependencies:** Update package versions and improve compatibility ([407257e](https://github.com/TestPlanIt/testplanit/commit/407257e906159cb810e222f9b966484822466fbe))
- **dependencies:** Update package versions in pnpm-lock.yaml and package.json ([becab7f](https://github.com/TestPlanIt/testplanit/commit/becab7f268d03dc9b6e5d69962574d71a9ce223c))
- release main ([#13](https://github.com/TestPlanIt/testplanit/issues/13)) ([c066160](https://github.com/TestPlanIt/testplanit/commit/c0661604d81acc5c6b5a8a50373388cc236afbe0))
- **release:** ([#11](https://github.com/TestPlanIt/testplanit/issues/11)) ([b829cb0](https://github.com/TestPlanIt/testplanit/commit/b829cb0af0a5fb6fc6dd5d58ec1e91db630f8cad))
- **release:** ([#12](https://github.com/TestPlanIt/testplanit/issues/12)) ([18bbce6](https://github.com/TestPlanIt/testplanit/commit/18bbce63720eae88c42fbfabd191b4aeaa40a807))
- **release:** 0.0.1 ([fe7e773](https://github.com/TestPlanIt/testplanit/commit/fe7e77391ee0a6f13ce0f026d6bcb24bf6385a81))
- **release:** 0.0.10 ([549a4c1](https://github.com/TestPlanIt/testplanit/commit/549a4c1d2c83a9e39db86c90cdc47fc3f78d92a4))
- **release:** 0.0.11 ([360cca4](https://github.com/TestPlanIt/testplanit/commit/360cca4530cff3a091aecc8b5367ce1d0f153603))
- **release:** 0.0.12 ([3ad4e17](https://github.com/TestPlanIt/testplanit/commit/3ad4e17a90f7d26ac4baed65a8c9853a4d904b4a))
- **release:** 0.0.13 ([9e48064](https://github.com/TestPlanIt/testplanit/commit/9e480648a8cf83ecb63ea87c5c08d94c11293982))
- **release:** 0.0.14 ([a8d9baa](https://github.com/TestPlanIt/testplanit/commit/a8d9baa4c7a0621477ed4a80131698e1490eeed2))
- **release:** 0.0.15 ([b8f4cd2](https://github.com/TestPlanIt/testplanit/commit/b8f4cd2cb022c75c689a4d465f26eb7af9fbbe81))
- **release:** 0.0.16 ([379b694](https://github.com/TestPlanIt/testplanit/commit/379b6940f08c2cf60f39b566bf2179a00ea6dac0))
- **release:** 0.0.16 ([2a13165](https://github.com/TestPlanIt/testplanit/commit/2a131656e1f528c179a6b038053a832623bd80df))
- **release:** 0.0.17 ([ef19a4d](https://github.com/TestPlanIt/testplanit/commit/ef19a4db852c9d93aa06dec2cabdd420149337f5))
- **release:** 0.0.17 ([f58a9fd](https://github.com/TestPlanIt/testplanit/commit/f58a9fdf5a30d4ea572ed45915537ea71fb84fea))
- **release:** 0.0.18 ([766121e](https://github.com/TestPlanIt/testplanit/commit/766121e06b37dd4bae8b5441ea95929b9458b59f))
- **release:** 0.0.18 ([e4e691b](https://github.com/TestPlanIt/testplanit/commit/e4e691b4a08e7b7d8f1cb0febdf34778489dc05a))
- **release:** 0.0.19 ([895fe05](https://github.com/TestPlanIt/testplanit/commit/895fe05ec879a37412e345499b52db2aa4095de5))
- **release:** 0.0.2 ([18c72cd](https://github.com/TestPlanIt/testplanit/commit/18c72cd937c280ff179fc4671290d7a833fe3cdc))
- **release:** 0.0.20 ([95d5037](https://github.com/TestPlanIt/testplanit/commit/95d503763f423bccbef5d4dc29d4c5f2ea13d486))
- **release:** 0.0.21 ([6a26d3e](https://github.com/TestPlanIt/testplanit/commit/6a26d3e4eb1b96ad503eb07fdc42eaa8ec7285cf))
- **release:** 0.0.22 ([15f134e](https://github.com/TestPlanIt/testplanit/commit/15f134e56b5bb5968c0d0e3aed27a3e9160be806))
- **release:** 0.0.23 ([cc289a7](https://github.com/TestPlanIt/testplanit/commit/cc289a741dbc6b9593dada2043ef0c852bf58f9e))
- **release:** 0.0.24 ([765e660](https://github.com/TestPlanIt/testplanit/commit/765e6600e318eb47c64f0d83553512701c728d78))
- **release:** 0.0.25 ([3b8d427](https://github.com/TestPlanIt/testplanit/commit/3b8d427cd0426e78de1ae22fa3045541797dadd1))
- **release:** 0.0.26 ([a22b518](https://github.com/TestPlanIt/testplanit/commit/a22b51831a2eebfe20a058176eafd6a6758136ef))
- **release:** 0.0.27 ([649df38](https://github.com/TestPlanIt/testplanit/commit/649df385c2d2f4b02a4f7bb1b6fe5fc9e8ee1df3))
- **release:** 0.0.28 ([1e3115b](https://github.com/TestPlanIt/testplanit/commit/1e3115b62b9f3adc7143377300cd7c450fcd9499))
- **release:** 0.0.3 ([62f7b52](https://github.com/TestPlanIt/testplanit/commit/62f7b524826f93cd81882037e819975e9adb0a85))
- **release:** 0.0.4 ([debf15f](https://github.com/TestPlanIt/testplanit/commit/debf15ff5b2ec7cfd1450b61c6bb2bbd581fb351))
- **release:** 0.0.5 ([c3408fe](https://github.com/TestPlanIt/testplanit/commit/c3408fed14df6cef3c0d4f344cab26817af81bc5))
- **release:** 0.0.6 ([67af12f](https://github.com/TestPlanIt/testplanit/commit/67af12f2737c4727184e6dca3c499fcff4dcb60d))
- **release:** 0.0.7 ([e737f74](https://github.com/TestPlanIt/testplanit/commit/e737f74ce50154ce3880022cce5abf25c24c6fbc))
- **release:** 0.0.8 ([f4cc476](https://github.com/TestPlanIt/testplanit/commit/f4cc476a5cdb6cf1c16fd1913521a9fd4d69a9bc))
- **release:** 0.0.9 ([c08ddc3](https://github.com/TestPlanIt/testplanit/commit/c08ddc3503cc4d9aaff20502c3bcb330be33a2ce))
- **release:** 0.1.0 ([4e71744](https://github.com/TestPlanIt/testplanit/commit/4e71744d0eb208520814d04b7a7f7d4ef683ef5f))
- **release:** 0.1.1 ([301b7ae](https://github.com/TestPlanIt/testplanit/commit/301b7aee0d2968e30a3a204873047c78a02f9d27))
- **release:** 0.1.10 ([95e18c1](https://github.com/TestPlanIt/testplanit/commit/95e18c1ab8419dc919b448d59e0aa51da8bb02e9))
- **release:** 0.1.11 ([ca24d7b](https://github.com/TestPlanIt/testplanit/commit/ca24d7bcc01ed613a5c6a0c044ea914fd50da212))
- **release:** 0.1.12 ([b051dee](https://github.com/TestPlanIt/testplanit/commit/b051dee8a682eafef639cae5d5fec0399cc48d1d))
- **release:** 0.1.13 ([4d19ad2](https://github.com/TestPlanIt/testplanit/commit/4d19ad2c26a23deae469fef336c71ea07d3f811f))
- **release:** 0.1.14 ([1018328](https://github.com/TestPlanIt/testplanit/commit/1018328e2d05316a67660f623e43d6224930bbdc))
- **release:** 0.1.14 ([02073eb](https://github.com/TestPlanIt/testplanit/commit/02073eb36dba43d6540234bb2977123c68828896))
- **release:** 0.1.15 ([c9e09c0](https://github.com/TestPlanIt/testplanit/commit/c9e09c003f1153efa97670d4bb65c65f6c56debe))
- **release:** 0.1.16 ([1180d35](https://github.com/TestPlanIt/testplanit/commit/1180d35d957b454685c9eb120c90f53bf02e2ba1))
- **release:** 0.1.17 ([1f1abc1](https://github.com/TestPlanIt/testplanit/commit/1f1abc158f6e2ea619266ed131a56689ce3873ea))
- **release:** 0.1.18 ([e57cdea](https://github.com/TestPlanIt/testplanit/commit/e57cdea2b05405b93535101fe850ae8a5ebd83d8))
- **release:** 0.1.19 ([85b51a7](https://github.com/TestPlanIt/testplanit/commit/85b51a71d39dea75720537028f19dc4d0347da28))
- **release:** 0.1.2 ([f19b65c](https://github.com/TestPlanIt/testplanit/commit/f19b65ce22db7ddea30658dc65a07aa31eb5f6f1))
- **release:** 0.1.20 ([c31d740](https://github.com/TestPlanIt/testplanit/commit/c31d7408110173a2d860bccb48b48caa1224d4d4))
- **release:** 0.1.21 ([94f84fc](https://github.com/TestPlanIt/testplanit/commit/94f84fc3306d7478b399da2b3b3adde3e32d05a7))
- **release:** 0.1.22 ([3ce16b9](https://github.com/TestPlanIt/testplanit/commit/3ce16b9ba72c86a38b501bb82c3a554bc5db3637))
- **release:** 0.1.23 ([b99576c](https://github.com/TestPlanIt/testplanit/commit/b99576cb92ff4b7f83a93600d43f197f6c6dc5a1))
- **release:** 0.1.24 ([9f613fe](https://github.com/TestPlanIt/testplanit/commit/9f613fe523a874c8d808dcd19f4e791495a5dae2))
- **release:** 0.1.25 ([eaa7f1f](https://github.com/TestPlanIt/testplanit/commit/eaa7f1fec56b2888a4538c7c4fea9692bbc1e178))
- **release:** 0.1.26 ([1c9f845](https://github.com/TestPlanIt/testplanit/commit/1c9f84563c6dc7dd58dfd9fdfadbd7a820e2398b))
- **release:** 0.1.27 ([4595696](https://github.com/TestPlanIt/testplanit/commit/4595696649a194eb672293931d0ddcbc1120a607))
- **release:** 0.1.28 ([fbc5b62](https://github.com/TestPlanIt/testplanit/commit/fbc5b62212e44fa3735fb73e5de9cee7cbdce877))
- **release:** 0.1.29 ([3cab009](https://github.com/TestPlanIt/testplanit/commit/3cab009516a9eeb9f7a1fd34929679a0b618187b))
- **release:** 0.1.3 ([0c519ac](https://github.com/TestPlanIt/testplanit/commit/0c519ac676519f96b07e005dfb355e60cff40d01))
- **release:** 0.1.30 ([a5eae31](https://github.com/TestPlanIt/testplanit/commit/a5eae3198005ed3e6677a3811a93e525aa55acc8))
- **release:** 0.1.31 ([d900c9a](https://github.com/TestPlanIt/testplanit/commit/d900c9a27537d84dcd58bfac6485f5e4acded4a0))
- **release:** 0.1.32 ([83e1f25](https://github.com/TestPlanIt/testplanit/commit/83e1f258be55ac1e76a9cbb7141c71efbee68cf7))
- **release:** 0.1.33 ([35e02af](https://github.com/TestPlanIt/testplanit/commit/35e02af0d44bc75605921123b5cce4c2cc085663))
- **release:** 0.1.34 ([e473ad9](https://github.com/TestPlanIt/testplanit/commit/e473ad96d301ea536756e79b0b8472eef1dfeea9))
- **release:** 0.1.4 ([ccccf12](https://github.com/TestPlanIt/testplanit/commit/ccccf12b3ee63d3034faddf209cce84969b7582e))
- **release:** 0.1.5 ([9c251e8](https://github.com/TestPlanIt/testplanit/commit/9c251e802f8a8a36d8d2ba29e9a1a36ece48e2ba))
- **release:** 0.1.6 ([5043c47](https://github.com/TestPlanIt/testplanit/commit/5043c472c34239ac3616e8f7b3d18d452b451aee))
- **release:** 0.1.7 ([1bc8fa3](https://github.com/TestPlanIt/testplanit/commit/1bc8fa33ba5445c81abc63eae3381ce302da0b61))
- **release:** 0.1.8 ([54d03f9](https://github.com/TestPlanIt/testplanit/commit/54d03f9f95550160da54218db1ebe94562bceea7))
- **release:** 0.1.9 ([037b18f](https://github.com/TestPlanIt/testplanit/commit/037b18fd1933580ab40d27a1f3758f63a4b5c0bf))
- **release:** 0.4.52 ([2bfc27c](https://github.com/TestPlanIt/testplanit/commit/2bfc27ca59df024e5b10bd7064ec10c710f52953))
- **release:** update Next.js version to 16.0.5, fix repository link in release notes, and remove obsolete TRIAL_CONFIGURATION.md file ([0eb7b16](https://github.com/TestPlanIt/testplanit/commit/0eb7b16f7c6e5569e0f26174147331b2cba4d162))
- **workflows:** Update CI and version bump configurations ([8e5cff4](https://github.com/TestPlanIt/testplanit/commit/8e5cff41a307599210eaab9d9c661b98841a65a2))

### Code Refactoring

- **prisma-middleware:** Remove bulk operations logging test ([c3e0f71](https://github.com/TestPlanIt/testplanit/commit/c3e0f710646871e56497c8991e2cb9a1c47a018f))
- **proxy:** Simplify root route handling in middleware ([c338484](https://github.com/TestPlanIt/testplanit/commit/c338484707e8d3934d68336e2ecc3ddd2140240f))
- Remove console.log statements for cleaner code ([280e68d](https://github.com/TestPlanIt/testplanit/commit/280e68d671446231a66561a36e0b4193cf656170))
- **reports:** Remove reportTypes prop from ReportBuilder and fetch report types internally ([c29b5d0](https://github.com/TestPlanIt/testplanit/commit/c29b5d0a8d081671b82d4bf2fe51c3791a24ffb4))
- **users:** Simplify access field watching in user modals ([ae3f2e4](https://github.com/TestPlanIt/testplanit/commit/ae3f2e41b201421e87ca1d4515a819e5cf4b0331))

### Build System

- **release:** migrate from standard-version to release-please ([117f60a](https://github.com/TestPlanIt/testplanit/commit/117f60aaff113516735cd4008cfbf8e9dbc7f50f))

## [0.1.37](https://github.com/TestPlanIt/testplanit/compare/testplanit-v0.1.36...testplanit-v0.1.37) (2025-12-05)

### Features

- **api:** Enhance API documentation and integrate Swagger UI ([#6](https://github.com/TestPlanIt/testplanit/issues/6)) ([8b6d6b2](https://github.com/TestPlanIt/testplanit/commit/8b6d6b218d9d92277aee963ae43a83da4b83fa6d))
- **api:** Implement external API request detection and enhance JWT handling ([6924a79](https://github.com/TestPlanIt/testplanit/commit/6924a79b093ec7f133fc6c0c5969c3f96c6e9f34))
- **auth:** Hash magic link token before storing in database ([0d7ce6e](https://github.com/TestPlanIt/testplanit/commit/0d7ce6eee218016f85029d1433d5b0302aec3277))
- **elasticsearch:** Add multi-tenant mode support in ElasticsearchAdmin ([1003b40](https://github.com/TestPlanIt/testplanit/commit/1003b40259ce51457f6ce46f018dcf31648f1166))
- **email:** Add baseUrl to notification and digest email data for tenant-specific URLs ([7474df6](https://github.com/TestPlanIt/testplanit/commit/7474df6c90eff155cf2485deb4088cb9100b7f09))
- Enhance Elasticsearch index filtering for multi-tenant support ([63662b6](https://github.com/TestPlanIt/testplanit/commit/63662b6b0e5c1d0bf98252dc4b82531e785256ee))
- **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/TestPlanIt/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
- Milestone auto-completion and due date notifications ([#10](https://github.com/TestPlanIt/testplanit/issues/10)) ([665b5a2](https://github.com/TestPlanIt/testplanit/commit/665b5a208090246f7f75eccf54ae79451ea9450e))
- **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/TestPlanIt/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))
- **multiTenant:** Add baseUrl to TenantConfig and update email worker to utilize tenant-specific base URLs for notifications ([28dc26e](https://github.com/TestPlanIt/testplanit/commit/28dc26eac1675f23f7638bcc3b169fc7ff713044))
- **multiTenant:** Enhance storage mode detection and add baseUrl to tenant configurations ([60af2f4](https://github.com/TestPlanIt/testplanit/commit/60af2f4a31d38959eb2451cf8ebb333fa7f3d8e2))
- **multiTenant:** Update tenant configuration to include baseUrl in environment variable format ([f7be7de](https://github.com/TestPlanIt/testplanit/commit/f7be7dec4964a820dd37cc4bc684ea83dd89cf8f))
- **permissions:** Enhance access control for project roles ([39292f6](https://github.com/TestPlanIt/testplanit/commit/39292f6dc34f9f72b9b3fe301544ad4bd636262a))
- **permissions:** Expand access control for project roles ([429fd42](https://github.com/TestPlanIt/testplanit/commit/429fd426f1387d01c176301caaef20beab2b935c))
- **translations:** Add "required for Admin" translations in English, Spanish, and French ([356b392](https://github.com/TestPlanIt/testplanit/commit/356b3924915d33d16435a63bd3db98ecbbf9eb53))
- **users:** Enhance user management with API access control for ADMIN users ([6e06acf](https://github.com/TestPlanIt/testplanit/commit/6e06acff204b5dfa50090dd7324e9fa401f1ade1))

### Bug Fixes

- **auth:** Clarify comments in magic link token hashing logic ([ccb5ee7](https://github.com/TestPlanIt/testplanit/commit/ccb5ee784a7f8558cdb6dee929d173965d4e68de))
- **Dockerfile:** Ensure translation files are copied to both reference and distribution directories for email worker ([6fe3cf4](https://github.com/TestPlanIt/testplanit/commit/6fe3cf472ba27e7f2223ffb32bbc07c4b2cc1c03))
- **docker:** Replace postgresql15-client with postgresql-client in Dockerfile for compatibility ([deb29ec](https://github.com/TestPlanIt/testplanit/commit/deb29ecffdb0faba1afeae6d269fd5642da4f249))
- Improve days difference calculation for milestone notifications ([2954364](https://github.com/TestPlanIt/testplanit/commit/29543646b65784a4e474c40419924ba067178e5c))
- Invalidate cached Prisma clients when tenant credentials change ([437c8dc](https://github.com/TestPlanIt/testplanit/commit/437c8dcfa17851f9c68ef929473c2ba47c5ff0c5))
- **layout:** Refactor storage mode detection logic for clarity ([3c060e5](https://github.com/TestPlanIt/testplanit/commit/3c060e56d73f1a8f376d29aab42fa04c998032c5))
- **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/TestPlanIt/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))
- **tags:** simplify access control logic ([3945a39](https://github.com/TestPlanIt/testplanit/commit/3945a39936f46ef22ada05fb34efe31d823280c7))
- **users:** Disable API toggle for ADMIN access level ([29f3df9](https://github.com/TestPlanIt/testplanit/commit/29f3df9561fcdad5174355f4179076151c46eb1f))
- **workers:** testmoImportWorker was using old generateRandomPassword code. ([be87543](https://github.com/TestPlanIt/testplanit/commit/be87543b9b7f97f1b6dc1330dd4ee9999a3fbed7))

### Miscellaneous Chores

- **dependencies:** update package versions and add new dependencies ([be87543](https://github.com/TestPlanIt/testplanit/commit/be87543b9b7f97f1b6dc1330dd4ee9999a3fbed7))
- **dependencies:** Update package versions and improve compatibility ([407257e](https://github.com/TestPlanIt/testplanit/commit/407257e906159cb810e222f9b966484822466fbe))
- **dependencies:** Update package versions in pnpm-lock.yaml and package.json ([becab7f](https://github.com/TestPlanIt/testplanit/commit/becab7f268d03dc9b6e5d69962574d71a9ce223c))
- **release:** ([#11](https://github.com/TestPlanIt/testplanit/issues/11)) ([b829cb0](https://github.com/TestPlanIt/testplanit/commit/b829cb0af0a5fb6fc6dd5d58ec1e91db630f8cad))
- **release:** ([#12](https://github.com/TestPlanIt/testplanit/issues/12)) ([18bbce6](https://github.com/TestPlanIt/testplanit/commit/18bbce63720eae88c42fbfabd191b4aeaa40a807))
- **release:** 0.0.1 ([fe7e773](https://github.com/TestPlanIt/testplanit/commit/fe7e77391ee0a6f13ce0f026d6bcb24bf6385a81))
- **release:** 0.0.10 ([549a4c1](https://github.com/TestPlanIt/testplanit/commit/549a4c1d2c83a9e39db86c90cdc47fc3f78d92a4))
- **release:** 0.0.11 ([360cca4](https://github.com/TestPlanIt/testplanit/commit/360cca4530cff3a091aecc8b5367ce1d0f153603))
- **release:** 0.0.12 ([3ad4e17](https://github.com/TestPlanIt/testplanit/commit/3ad4e17a90f7d26ac4baed65a8c9853a4d904b4a))
- **release:** 0.0.13 ([9e48064](https://github.com/TestPlanIt/testplanit/commit/9e480648a8cf83ecb63ea87c5c08d94c11293982))
- **release:** 0.0.14 ([a8d9baa](https://github.com/TestPlanIt/testplanit/commit/a8d9baa4c7a0621477ed4a80131698e1490eeed2))
- **release:** 0.0.15 ([b8f4cd2](https://github.com/TestPlanIt/testplanit/commit/b8f4cd2cb022c75c689a4d465f26eb7af9fbbe81))
- **release:** 0.0.16 ([379b694](https://github.com/TestPlanIt/testplanit/commit/379b6940f08c2cf60f39b566bf2179a00ea6dac0))
- **release:** 0.0.16 ([2a13165](https://github.com/TestPlanIt/testplanit/commit/2a131656e1f528c179a6b038053a832623bd80df))
- **release:** 0.0.17 ([ef19a4d](https://github.com/TestPlanIt/testplanit/commit/ef19a4db852c9d93aa06dec2cabdd420149337f5))
- **release:** 0.0.17 ([f58a9fd](https://github.com/TestPlanIt/testplanit/commit/f58a9fdf5a30d4ea572ed45915537ea71fb84fea))
- **release:** 0.0.18 ([766121e](https://github.com/TestPlanIt/testplanit/commit/766121e06b37dd4bae8b5441ea95929b9458b59f))
- **release:** 0.0.18 ([e4e691b](https://github.com/TestPlanIt/testplanit/commit/e4e691b4a08e7b7d8f1cb0febdf34778489dc05a))
- **release:** 0.0.19 ([895fe05](https://github.com/TestPlanIt/testplanit/commit/895fe05ec879a37412e345499b52db2aa4095de5))
- **release:** 0.0.2 ([18c72cd](https://github.com/TestPlanIt/testplanit/commit/18c72cd937c280ff179fc4671290d7a833fe3cdc))
- **release:** 0.0.20 ([95d5037](https://github.com/TestPlanIt/testplanit/commit/95d503763f423bccbef5d4dc29d4c5f2ea13d486))
- **release:** 0.0.21 ([6a26d3e](https://github.com/TestPlanIt/testplanit/commit/6a26d3e4eb1b96ad503eb07fdc42eaa8ec7285cf))
- **release:** 0.0.22 ([15f134e](https://github.com/TestPlanIt/testplanit/commit/15f134e56b5bb5968c0d0e3aed27a3e9160be806))
- **release:** 0.0.23 ([cc289a7](https://github.com/TestPlanIt/testplanit/commit/cc289a741dbc6b9593dada2043ef0c852bf58f9e))
- **release:** 0.0.24 ([765e660](https://github.com/TestPlanIt/testplanit/commit/765e6600e318eb47c64f0d83553512701c728d78))
- **release:** 0.0.25 ([3b8d427](https://github.com/TestPlanIt/testplanit/commit/3b8d427cd0426e78de1ae22fa3045541797dadd1))
- **release:** 0.0.26 ([a22b518](https://github.com/TestPlanIt/testplanit/commit/a22b51831a2eebfe20a058176eafd6a6758136ef))
- **release:** 0.0.27 ([649df38](https://github.com/TestPlanIt/testplanit/commit/649df385c2d2f4b02a4f7bb1b6fe5fc9e8ee1df3))
- **release:** 0.0.28 ([1e3115b](https://github.com/TestPlanIt/testplanit/commit/1e3115b62b9f3adc7143377300cd7c450fcd9499))
- **release:** 0.0.3 ([62f7b52](https://github.com/TestPlanIt/testplanit/commit/62f7b524826f93cd81882037e819975e9adb0a85))
- **release:** 0.0.4 ([debf15f](https://github.com/TestPlanIt/testplanit/commit/debf15ff5b2ec7cfd1450b61c6bb2bbd581fb351))
- **release:** 0.0.5 ([c3408fe](https://github.com/TestPlanIt/testplanit/commit/c3408fed14df6cef3c0d4f344cab26817af81bc5))
- **release:** 0.0.6 ([67af12f](https://github.com/TestPlanIt/testplanit/commit/67af12f2737c4727184e6dca3c499fcff4dcb60d))
- **release:** 0.0.7 ([e737f74](https://github.com/TestPlanIt/testplanit/commit/e737f74ce50154ce3880022cce5abf25c24c6fbc))
- **release:** 0.0.8 ([f4cc476](https://github.com/TestPlanIt/testplanit/commit/f4cc476a5cdb6cf1c16fd1913521a9fd4d69a9bc))
- **release:** 0.0.9 ([c08ddc3](https://github.com/TestPlanIt/testplanit/commit/c08ddc3503cc4d9aaff20502c3bcb330be33a2ce))
- **release:** 0.1.0 ([4e71744](https://github.com/TestPlanIt/testplanit/commit/4e71744d0eb208520814d04b7a7f7d4ef683ef5f))
- **release:** 0.1.1 ([301b7ae](https://github.com/TestPlanIt/testplanit/commit/301b7aee0d2968e30a3a204873047c78a02f9d27))
- **release:** 0.1.10 ([95e18c1](https://github.com/TestPlanIt/testplanit/commit/95e18c1ab8419dc919b448d59e0aa51da8bb02e9))
- **release:** 0.1.11 ([ca24d7b](https://github.com/TestPlanIt/testplanit/commit/ca24d7bcc01ed613a5c6a0c044ea914fd50da212))
- **release:** 0.1.12 ([b051dee](https://github.com/TestPlanIt/testplanit/commit/b051dee8a682eafef639cae5d5fec0399cc48d1d))
- **release:** 0.1.13 ([4d19ad2](https://github.com/TestPlanIt/testplanit/commit/4d19ad2c26a23deae469fef336c71ea07d3f811f))
- **release:** 0.1.14 ([1018328](https://github.com/TestPlanIt/testplanit/commit/1018328e2d05316a67660f623e43d6224930bbdc))
- **release:** 0.1.14 ([02073eb](https://github.com/TestPlanIt/testplanit/commit/02073eb36dba43d6540234bb2977123c68828896))
- **release:** 0.1.15 ([c9e09c0](https://github.com/TestPlanIt/testplanit/commit/c9e09c003f1153efa97670d4bb65c65f6c56debe))
- **release:** 0.1.16 ([1180d35](https://github.com/TestPlanIt/testplanit/commit/1180d35d957b454685c9eb120c90f53bf02e2ba1))
- **release:** 0.1.17 ([1f1abc1](https://github.com/TestPlanIt/testplanit/commit/1f1abc158f6e2ea619266ed131a56689ce3873ea))
- **release:** 0.1.18 ([e57cdea](https://github.com/TestPlanIt/testplanit/commit/e57cdea2b05405b93535101fe850ae8a5ebd83d8))
- **release:** 0.1.19 ([85b51a7](https://github.com/TestPlanIt/testplanit/commit/85b51a71d39dea75720537028f19dc4d0347da28))
- **release:** 0.1.2 ([f19b65c](https://github.com/TestPlanIt/testplanit/commit/f19b65ce22db7ddea30658dc65a07aa31eb5f6f1))
- **release:** 0.1.20 ([c31d740](https://github.com/TestPlanIt/testplanit/commit/c31d7408110173a2d860bccb48b48caa1224d4d4))
- **release:** 0.1.21 ([94f84fc](https://github.com/TestPlanIt/testplanit/commit/94f84fc3306d7478b399da2b3b3adde3e32d05a7))
- **release:** 0.1.22 ([3ce16b9](https://github.com/TestPlanIt/testplanit/commit/3ce16b9ba72c86a38b501bb82c3a554bc5db3637))
- **release:** 0.1.23 ([b99576c](https://github.com/TestPlanIt/testplanit/commit/b99576cb92ff4b7f83a93600d43f197f6c6dc5a1))
- **release:** 0.1.24 ([9f613fe](https://github.com/TestPlanIt/testplanit/commit/9f613fe523a874c8d808dcd19f4e791495a5dae2))
- **release:** 0.1.25 ([eaa7f1f](https://github.com/TestPlanIt/testplanit/commit/eaa7f1fec56b2888a4538c7c4fea9692bbc1e178))
- **release:** 0.1.26 ([1c9f845](https://github.com/TestPlanIt/testplanit/commit/1c9f84563c6dc7dd58dfd9fdfadbd7a820e2398b))
- **release:** 0.1.27 ([4595696](https://github.com/TestPlanIt/testplanit/commit/4595696649a194eb672293931d0ddcbc1120a607))
- **release:** 0.1.28 ([fbc5b62](https://github.com/TestPlanIt/testplanit/commit/fbc5b62212e44fa3735fb73e5de9cee7cbdce877))
- **release:** 0.1.29 ([3cab009](https://github.com/TestPlanIt/testplanit/commit/3cab009516a9eeb9f7a1fd34929679a0b618187b))
- **release:** 0.1.3 ([0c519ac](https://github.com/TestPlanIt/testplanit/commit/0c519ac676519f96b07e005dfb355e60cff40d01))
- **release:** 0.1.30 ([a5eae31](https://github.com/TestPlanIt/testplanit/commit/a5eae3198005ed3e6677a3811a93e525aa55acc8))
- **release:** 0.1.31 ([d900c9a](https://github.com/TestPlanIt/testplanit/commit/d900c9a27537d84dcd58bfac6485f5e4acded4a0))
- **release:** 0.1.32 ([83e1f25](https://github.com/TestPlanIt/testplanit/commit/83e1f258be55ac1e76a9cbb7141c71efbee68cf7))
- **release:** 0.1.33 ([35e02af](https://github.com/TestPlanIt/testplanit/commit/35e02af0d44bc75605921123b5cce4c2cc085663))
- **release:** 0.1.34 ([e473ad9](https://github.com/TestPlanIt/testplanit/commit/e473ad96d301ea536756e79b0b8472eef1dfeea9))
- **release:** 0.1.4 ([ccccf12](https://github.com/TestPlanIt/testplanit/commit/ccccf12b3ee63d3034faddf209cce84969b7582e))
- **release:** 0.1.5 ([9c251e8](https://github.com/TestPlanIt/testplanit/commit/9c251e802f8a8a36d8d2ba29e9a1a36ece48e2ba))
- **release:** 0.1.6 ([5043c47](https://github.com/TestPlanIt/testplanit/commit/5043c472c34239ac3616e8f7b3d18d452b451aee))
- **release:** 0.1.7 ([1bc8fa3](https://github.com/TestPlanIt/testplanit/commit/1bc8fa33ba5445c81abc63eae3381ce302da0b61))
- **release:** 0.1.8 ([54d03f9](https://github.com/TestPlanIt/testplanit/commit/54d03f9f95550160da54218db1ebe94562bceea7))
- **release:** 0.1.9 ([037b18f](https://github.com/TestPlanIt/testplanit/commit/037b18fd1933580ab40d27a1f3758f63a4b5c0bf))
- **release:** 0.4.52 ([2bfc27c](https://github.com/TestPlanIt/testplanit/commit/2bfc27ca59df024e5b10bd7064ec10c710f52953))
- **release:** update Next.js version to 16.0.5, fix repository link in release notes, and remove obsolete TRIAL_CONFIGURATION.md file ([0eb7b16](https://github.com/TestPlanIt/testplanit/commit/0eb7b16f7c6e5569e0f26174147331b2cba4d162))
- **workflows:** Update CI and version bump configurations ([8e5cff4](https://github.com/TestPlanIt/testplanit/commit/8e5cff41a307599210eaab9d9c661b98841a65a2))

### Code Refactoring

- **prisma-middleware:** Remove bulk operations logging test ([c3e0f71](https://github.com/TestPlanIt/testplanit/commit/c3e0f710646871e56497c8991e2cb9a1c47a018f))
- **proxy:** Simplify root route handling in middleware ([c338484](https://github.com/TestPlanIt/testplanit/commit/c338484707e8d3934d68336e2ecc3ddd2140240f))
- Remove console.log statements for cleaner code ([280e68d](https://github.com/TestPlanIt/testplanit/commit/280e68d671446231a66561a36e0b4193cf656170))
- **reports:** Remove reportTypes prop from ReportBuilder and fetch report types internally ([c29b5d0](https://github.com/TestPlanIt/testplanit/commit/c29b5d0a8d081671b82d4bf2fe51c3791a24ffb4))
- **users:** Simplify access field watching in user modals ([ae3f2e4](https://github.com/TestPlanIt/testplanit/commit/ae3f2e41b201421e87ca1d4515a819e5cf4b0331))

### Build System

- **release:** migrate from standard-version to release-please ([117f60a](https://github.com/TestPlanIt/testplanit/commit/117f60aaff113516735cd4008cfbf8e9dbc7f50f))

## [0.1.36](https://github.com/TestPlanIt/testplanit/compare/v0.1.35...v0.1.36) (2025-12-05)

### Bug Fixes

- **tags:** simplify access control logic ([3945a39](https://github.com/TestPlanIt/testplanit/commit/3945a39936f46ef22ada05fb34efe31d823280c7))

## [0.1.35](https://github.com/TestPlanIt/testplanit/compare/v0.1.34...v0.1.35) (2025-12-05)

### Build System

- **release:** migrate from standard-version to release-please ([117f60a](https://github.com/TestPlanIt/testplanit/commit/117f60aaff113516735cd4008cfbf8e9dbc7f50f))

### [0.1.34](https://github.com/testplanit/testplanit/compare/v0.1.33...v0.1.34) (2025-12-05)

### Code Refactoring

- **proxy:** Simplify root route handling in middleware ([c338484](https://github.com/testplanit/testplanit/commit/c338484707e8d3934d68336e2ecc3ddd2140240f))

### [0.1.33](https://github.com/testplanit/testplanit/compare/v0.1.32...v0.1.33) (2025-12-05)

### Bug Fixes

- **docker:** Replace postgresql15-client with postgresql-client in Dockerfile for compatibility ([deb29ec](https://github.com/testplanit/testplanit/commit/deb29ecffdb0faba1afeae6d269fd5642da4f249))

### [0.1.32](https://github.com/testplanit/testplanit/compare/v0.1.31...v0.1.32) (2025-12-04)

### Features

- **permissions:** Expand access control for project roles ([429fd42](https://github.com/testplanit/testplanit/commit/429fd426f1387d01c176301caaef20beab2b935c))

### [0.1.31](https://github.com/testplanit/testplanit/compare/v0.1.30...v0.1.31) (2025-12-04)

### Features

- **permissions:** Enhance access control for project roles ([39292f6](https://github.com/testplanit/testplanit/commit/39292f6dc34f9f72b9b3fe301544ad4bd636262a))

### [0.1.30](https://github.com/testplanit/testplanit/compare/v0.1.29...v0.1.30) (2025-12-04)

### [0.1.29](https://github.com/testplanit/testplanit/compare/v0.1.28...v0.1.29) (2025-12-04)

### [0.1.28](https://github.com/testplanit/testplanit/compare/v0.1.27...v0.1.28) (2025-12-04)

### Bug Fixes

- **users:** Disable API toggle for ADMIN access level ([29f3df9](https://github.com/testplanit/testplanit/commit/29f3df9561fcdad5174355f4179076151c46eb1f))

### [0.1.27](https://github.com/testplanit/testplanit/compare/v0.1.26...v0.1.27) (2025-12-04)

### Bug Fixes

- **release:** Update GitHub CLI commands for consistency ([94e252b](https://github.com/testplanit/testplanit/commit/94e252b7119f8ad97f33c77647045cfcccdb1948))

### [0.1.26](https://github.com/testplanit/testplanit/compare/v0.1.25...v0.1.26) (2025-12-04)

### Bug Fixes

- **release:** Update lowercase repo name setting in workflows ([43bf90b](https://github.com/testplanit/testplanit/commit/43bf90bcd936218d18cc874b290f797a2e6d854e))

### [0.1.25](https://github.com/testplanit/testplanit/compare/v0.1.24...v0.1.25) (2025-12-04)

### Code Refactoring

- **prisma-middleware:** Remove bulk operations logging test ([c3e0f71](https://github.com/testplanit/testplanit/commit/c3e0f710646871e56497c8991e2cb9a1c47a018f))

### [0.1.24](https://github.com/testplanit/testplanit/compare/v0.1.23...v0.1.24) (2025-12-04)

### Features

- Milestone auto-completion and due date notifications ([#10](https://github.com/testplanit/testplanit/issues/10)) ([665b5a2](https://github.com/testplanit/testplanit/commit/665b5a208090246f7f75eccf54ae79451ea9450e))

### Bug Fixes

- Improve days difference calculation for milestone notifications ([2954364](https://github.com/testplanit/testplanit/commit/29543646b65784a4e474c40419924ba067178e5c))

### Code Refactoring

- Remove console.log statements for cleaner code ([280e68d](https://github.com/testplanit/testplanit/commit/280e68d671446231a66561a36e0b4193cf656170))
- **reports:** Remove reportTypes prop from ReportBuilder and fetch report types internally ([c29b5d0](https://github.com/testplanit/testplanit/commit/c29b5d0a8d081671b82d4bf2fe51c3791a24ffb4))

### [0.1.23](https://github.com///compare/v0.1.22...v0.1.23) (2025-12-04)

### Features

- **multiTenant:** Enhance storage mode detection and add baseUrl to tenant configurations 60af2f4
- **multiTenant:** Update tenant configuration to include baseUrl in environment variable format f7be7de

### Bug Fixes

- **layout:** Refactor storage mode detection logic for clarity 3c060e5

### [0.1.22](https://github.com/testplanit/testplanit/compare/v0.1.21...v0.1.22) (2025-12-04)

### Features

- **email:** Add baseUrl to notification and digest email data for tenant-specific URLs ([7474df6](https://github.com/testplanit/testplanit/commit/7474df6c90eff155cf2485deb4088cb9100b7f09))

### [0.1.21](https://github.com/testplanit/testplanit/compare/v0.1.20...v0.1.21) (2025-12-04)

### Features

- **multiTenant:** Add baseUrl to TenantConfig and update email worker to utilize tenant-specific base URLs for notifications ([28dc26e](https://github.com/testplanit/testplanit/commit/28dc26eac1675f23f7638bcc3b169fc7ff713044))

### [0.1.20](https://github.com/testplanit/testplanit/compare/v0.1.19...v0.1.20) (2025-12-04)

### Bug Fixes

- **Dockerfile:** Ensure translation files are copied to both reference and distribution directories for email worker ([6fe3cf4](https://github.com/testplanit/testplanit/commit/6fe3cf472ba27e7f2223ffb32bbc07c4b2cc1c03))

### [0.1.19](https://github.com/testplanit/testplanit/compare/v0.1.18...v0.1.19) (2025-12-04)

### Features

- **translations:** Add "required for Admin" translations in English, Spanish, and French ([356b392](https://github.com/testplanit/testplanit/commit/356b3924915d33d16435a63bd3db98ecbbf9eb53))

### [0.1.18](https://github.com/testplanit/testplanit/compare/v0.1.17...v0.1.18) (2025-12-04)

### Code Refactoring

- **users:** Simplify access field watching in user modals ([ae3f2e4](https://github.com/testplanit/testplanit/commit/ae3f2e41b201421e87ca1d4515a819e5cf4b0331))

### [0.1.17](https://github.com/testplanit/testplanit/compare/v0.1.16...v0.1.17) (2025-12-04)

### [0.1.16](https://github.com/testplanit/testplanit/compare/v0.1.15...v0.1.16) (2025-12-04)

### Features

- **api:** Implement external API request detection and enhance JWT handling ([6924a79](https://github.com/testplanit/testplanit/commit/6924a79b093ec7f133fc6c0c5969c3f96c6e9f34))

### [0.1.14](https://github.com/testplanit/testplanit/compare/v0.1.13...v0.1.14) (2025-12-03)

### Bug Fixes

- **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/testplanit/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))

### [0.1.15](https://github.com/testplanit/testplanit/compare/v0.1.13...v0.1.15) (2025-12-04)

### Features

- **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/testplanit/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
- **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/testplanit/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))

### Bug Fixes

- **tags:** Correct tab content and pagination for sessions and test runs ([ade7a39](https://github.com/testplanit/testplanit/commit/ade7a3927e930db8019c2d407e02c62c5bffcc02))

### [0.1.14](https://github.com/testplanit/testplanit/compare/v0.1.13...v0.1.14) (2025-12-04)

### Features

- **file-storage:** Enhance file upload documentation and implement server action for proxy mode ([95782cc](https://github.com/testplanit/testplanit/commit/95782ccf774eece0918405d5c03377b04cdebefb))
- **multi-tenant:** Implement tenant ID handling for Testmo imports ([665efba](https://github.com/testplanit/testplanit/commit/665efbac8cc95cd5342bc7dccb53e343e60b189f))

### [0.1.13](https://github.com/testplanit/testplanit/compare/v0.1.12...v0.1.13) (2025-12-03)

### Features

- **api:** Enhance API documentation and integrate Swagger UI ([#6](https://github.com/testplanit/testplanit/issues/6)) ([8b6d6b2](https://github.com/testplanit/testplanit/commit/8b6d6b218d9d92277aee963ae43a83da4b83fa6d))

### [0.1.12](https://github.com/testplanit/testplanit/compare/v0.1.11...v0.1.12) (2025-12-02)

### Features

- **elasticsearch:** Add multi-tenant mode support in ElasticsearchAdmin ([1003b40](https://github.com/testplanit/testplanit/commit/1003b40259ce51457f6ce46f018dcf31648f1166))

### [0.1.11](https://github.com/testplanit/testplanit/compare/v0.1.10...v0.1.11) (2025-12-02)

### Bug Fixes

- Invalidate cached Prisma clients when tenant credentials change ([437c8dc](https://github.com/testplanit/testplanit/commit/437c8dcfa17851f9c68ef929473c2ba47c5ff0c5))

### [0.1.10](https://github.com/testplanit/testplanit/compare/v0.1.9...v0.1.10) (2025-12-02)

### Bug Fixes

- **auth:** Clarify comments in magic link token hashing logic ([ccb5ee7](https://github.com/testplanit/testplanit/commit/ccb5ee784a7f8558cdb6dee929d173965d4e68de))

### [0.1.9](https://github.com/testplanit/testplanit/compare/v0.1.8...v0.1.9) (2025-12-02)

### Features

- **auth:** Hash magic link token before storing in database ([0d7ce6e](https://github.com/testplanit/testplanit/commit/0d7ce6eee218016f85029d1433d5b0302aec3277))

### [0.1.8](https://github.com/testplanit/testplanit/compare/v0.1.7...v0.1.8) (2025-12-02)

### Features

- Enhance Elasticsearch index filtering for multi-tenant support ([63662b6](https://github.com/testplanit/testplanit/commit/63662b6b0e5c1d0bf98252dc4b82531e785256ee))

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

- **release:** update lowercase repo name setting in workflow ([edb0a8e](https://github.com/testplanit/testplanit/commit/edb0a8e74a5ef0bbcd30846f0f91157c6edaee67))

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
