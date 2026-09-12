## [1.1.0-beta.2](https://github.com/TestPlanIt/testplanit/compare/v1.1.0-beta.1...v1.1.0-beta.2) (2026-09-12)

### Bug Fixes

* **auth:** let read-only API tokens run report POSTs again ([896b842](https://github.com/TestPlanIt/testplanit/commit/896b84220b070c3235786f50742aa187c8d632db))
* **editor:** skip the read-only content sync on a destroyed editor ([#637](https://github.com/TestPlanIt/testplanit/issues/637)) ([41ebc02](https://github.com/TestPlanIt/testplanit/commit/41ebc028827a028bed23da9d8cfadcbcb46fdb1e))
* **mcp:** store result notes as rich text and document elapsed in seconds ([#642](https://github.com/TestPlanIt/testplanit/issues/642)) ([1b4bf39](https://github.com/TestPlanIt/testplanit/commit/1b4bf39af86bce705de7cec6623745a8e9e6bbc2)), closes [#639](https://github.com/TestPlanIt/testplanit/issues/639) [#640](https://github.com/TestPlanIt/testplanit/issues/640)
* **milestones:** save without a default type and keep every catalog's default ([#641](https://github.com/TestPlanIt/testplanit/issues/641)) ([8b44ecc](https://github.com/TestPlanIt/testplanit/commit/8b44ecc92436ee5e8ec05a3c4a1611b00e07156d)), closes [#638](https://github.com/TestPlanIt/testplanit/issues/638)
* **release:** update GitHub release body template to handle large notes ([a39fb5f](https://github.com/TestPlanIt/testplanit/commit/a39fb5f8be371709cf7a0ce8bfa717f43adb260a))

## [1.1.0-beta.1](https://github.com/TestPlanIt/testplanit/compare/v1.0.6...v1.1.0-beta.1) (2026-09-11)

### Features

* **27-05:** add getCaseLatestExecutedAt beside the shared latest-result CTE ([8f57584](https://github.com/TestPlanIt/testplanit/commit/8f575849728dc443e66f9385ec2c8fa832bcd966))
* **27-05:** add the isLinkageSuspect pure predicate ([1f60b3a](https://github.com/TestPlanIt/testplanit/commit/1f60b3a81f5f06829aba2177135a41c3882c8e57))
* **a11y:** add Accessible Dark theme and axe contrast smoke gate ([850b697](https://github.com/TestPlanIt/testplanit/commit/850b697b97d1e6d464c7d2473181853e0831f024))
* add CreateFirstProjectCard component for project initiation guidance ([6245446](https://github.com/TestPlanIt/testplanit/commit/62454466602ed6d21460c2e89f25498141d43296))
* add hideSelectAll prop to MultiAsyncCombobox and update select all functionality ([7b13fcf](https://github.com/TestPlanIt/testplanit/commit/7b13fcf51247d76501cf2770c77f5ad6a05e2718))
* add subject reference to webhook delivery and update related translations ([cf5efad](https://github.com/TestPlanIt/testplanit/commit/cf5efadf98bbd250f320b08195c374bdf4b54b14))
* add type prop to button elements for accessibility and consistency ([a0d3965](https://github.com/TestPlanIt/testplanit/commit/a0d396547640a27fa2ba5c7165ff4ea22140e738))
* **api-rate-limit:** add API_RATE_LIMIT override and default to professional ([ab6c2f7](https://github.com/TestPlanIt/testplanit/commit/ab6c2f7d2826f8339449fb5e9f27ea37d2d1d57c))
* **async-combobox:** add loading spinner during options fetch ([5f965bf](https://github.com/TestPlanIt/testplanit/commit/5f965bf80a8ebfa57537cf4372d54ebc90fb7f93))
* **attachments:** add attachments filtering and localization support ([ae3f463](https://github.com/TestPlanIt/testplanit/commit/ae3f463ba46371bef63ad83194f974af4981dd45))
* **attachments:** preview Word, Excel, and PowerPoint documents ([38cceed](https://github.com/TestPlanIt/testplanit/commit/38cceed5f34f8a4000092bd13707dcbb96a8dc79))
* **audit:** add sourceTable column to audit logs and enhance project ID backfill logic ([378e2e7](https://github.com/TestPlanIt/testplanit/commit/378e2e74a125e7ee51b97be8b935aad47c9a788e))
* **automationRuns:** add Automation Runs card with live updates ([9c70151](https://github.com/TestPlanIt/testplanit/commit/9c70151afc1a5a8a4bd3c75f6256091237dc2811))
* **automationRuns:** auto-close abandoned automated test runs ([9e3ee05](https://github.com/TestPlanIt/testplanit/commit/9e3ee059c7d27f1dbd36887b66dc015e573998f7))
* **button:** add type prop handling for button component ([22c04bc](https://github.com/TestPlanIt/testplanit/commit/22c04bcd444c14625fe1bf2750a48ca6adf58abd))
* **components:** add margin class to AsyncCombobox and MultiAsyncCombobox for improved spacing ([b4a23e4](https://github.com/TestPlanIt/testplanit/commit/b4a23e407e433a20ee8725924f37272907941193))
* **coverage-rollup:** add requirement-side raw-SQL role mirror ([3dae58a](https://github.com/TestPlanIt/testplanit/commit/3dae58a0ea2525e61d17b303502cad1cad948ada))
* **coverage:** add requirement coverage status vocabulary and precedence ladder ([603f2b5](https://github.com/TestPlanIt/testplanit/commit/603f2b513103901fa9ac3b8f715aaf4d40ebd3fc))
* **coverage:** add the one-statement hierarchical requirement rollup ([02796c4](https://github.com/TestPlanIt/testplanit/commit/02796c4e2c33e05123f011a7347d845ea1a13c6a))
* **coverage:** extract shared latest-case-result CTE fragment ([e44a3bf](https://github.com/TestPlanIt/testplanit/commit/e44a3bfe24360cd532772a899fef9bef4a3fb405))
* **datasets:** add DataSetRow lease primitive for test-data reservation ([c9e9794](https://github.com/TestPlanIt/testplanit/commit/c9e9794cf99670040cc3d3e655e33911f18b91e9))
* **db:** add opt-in PostgreSQL read-replica routing ([#198](https://github.com/TestPlanIt/testplanit/issues/198)) ([498b5fd](https://github.com/TestPlanIt/testplanit/commit/498b5fd3b3575967065ccf3823b148fa6c3f5b1a))
* **docs:** update passwordless sign-in documentation for default behavior and configuration options ([c60cf3a](https://github.com/TestPlanIt/testplanit/commit/c60cf3a25b4ec1cb9cd0294020baf4720902e46c))
* **duplicates:** highlight differing fields in the compare modal ([61bd658](https://github.com/TestPlanIt/testplanit/commit/61bd658216a282c0477a62278c4004eda09c7b26))
* **duplicates:** word-level diff for strings in the compare modal ([8d8edc2](https://github.com/TestPlanIt/testplanit/commit/8d8edc2cb5eb4909b2ec8e5109fbc2621bcd3f7c))
* **editorMediaAttachments:** implement media attachment resolution for embedded images and videos in descriptions ([09a3f53](https://github.com/TestPlanIt/testplanit/commit/09a3f53752d64bc907a3666ed8f51124162bbe4c))
* enhance milestone member coverage and user engagement metrics ([0e9b40b](https://github.com/TestPlanIt/testplanit/commit/0e9b40b0b2f579fe2f41215c737f97aea4e21140))
* enhance project overview with test case breakdown and localization updates ([a9d7e1f](https://github.com/TestPlanIt/testplanit/commit/a9d7e1f5fc12c3985ff4508fcec3e0bf5adea803))
* **execution:** trigger automated execution from test runs ([#636](https://github.com/TestPlanIt/testplanit/issues/636)) ([471c686](https://github.com/TestPlanIt/testplanit/commit/471c6862aaf746fa172843af3d6855f8aaa463c5))
* **forms:** make folder pickers searchable and virtualize long lists ([0ffb548](https://github.com/TestPlanIt/testplanit/commit/0ffb54835a22d6b51c4754e2d9695eca52ca3344))
* **generate:** respect field deselection and use issue-linked cases as context ([c6aa662](https://github.com/TestPlanIt/testplanit/commit/c6aa662503347ce02a2b2cc1772ee6bc350bdf48))
* **generation:** Jira issue screenshots as test-case generation context ([1ab5ad6](https://github.com/TestPlanIt/testplanit/commit/1ab5ad699a9efaa76032d031923d8b5a0487bcfb))
* **generation:** rich-text document source with embedded images ([8ba0537](https://github.com/TestPlanIt/testplanit/commit/8ba0537fcef8f59c78139328d27427b9913046a5))
* **generation:** URL-crawl page screenshots as context (env-gated) ([012b834](https://github.com/TestPlanIt/testplanit/commit/012b834e416650c462e4f608cfe3354acba22b5c))
* **header:** collapse action icons into a kebab menu on narrow screens ([770c4d0](https://github.com/TestPlanIt/testplanit/commit/770c4d0b0d8d77c9c349e2245338c8f841c98b46))
* **header:** modernize top nav and surface alerts on the collapsed kebab ([bc35d5a](https://github.com/TestPlanIt/testplanit/commit/bc35d5aefd41ccc79da421459f010ff03900decd))
* **health:** report event-loop lag from /api/health ([ecaea9d](https://github.com/TestPlanIt/testplanit/commit/ecaea9dfbc1d0cd2e75ea1950476d547f029ad1c))
* **helm:** single-tenant Kubernetes Helm chart + public self-host images ([41a6710](https://github.com/TestPlanIt/testplanit/commit/41a6710a15508317ba264182cb0eb288b7182edb))
* **i18n:** add Arabic language support and RTL layout across the interface ([0a6e853](https://github.com/TestPlanIt/testplanit/commit/0a6e853bcdf3aba430f2ae6aa72d75ed1fcc3149))
* **i18n:** add Czech language support ([#588](https://github.com/TestPlanIt/testplanit/issues/588)) ([cae4859](https://github.com/TestPlanIt/testplanit/commit/cae48590d01a6df26a26bae0fc5488f540731d9d))
* **i18n:** add requirements namespace ([6575adb](https://github.com/TestPlanIt/testplanit/commit/6575adbe1c9b1ceacb0c690c1b302ad498015b61))
* **i18n:** Arabic language support with RTL layout ([#500](https://github.com/TestPlanIt/testplanit/issues/500)) ([7ec54d0](https://github.com/TestPlanIt/testplanit/commit/7ec54d0e6b20d9f2d835fc68a447762e792842fa))
* **impact:** choose a pull request instead of two commits ([4919fbb](https://github.com/TestPlanIt/testplanit/commit/4919fbb9395d14cac18ae6c8d8050c8ce6f51eb5))
* **impact:** select affected tests from code changes ([b4cf840](https://github.com/TestPlanIt/testplanit/commit/b4cf840b7516b0cab8fcf61d6031a506600bdc0f))
* implement auto-flip for issue linking in result modals and add tests ([38e956c](https://github.com/TestPlanIt/testplanit/commit/38e956c4fa8aff317aa39cef57cedc478b6f0541))
* implement MultiAsyncCombobox for action and entity type filters in audit logs ([511ddcc](https://github.com/TestPlanIt/testplanit/commit/511ddccc58aa7e0e3a2c6176d14a6f2cb013b4a4))
* implement run completion notification system ([04a55cc](https://github.com/TestPlanIt/testplanit/commit/04a55cc12b04bf44308f5cec33df6a566f33078c))
* **integrations:** add requirements config read/merge/diff contract ([c308409](https://github.com/TestPlanIt/testplanit/commit/c308409a6d6094327ea2809f3b466a317f777517))
* **integrations:** add the requirements-config settings card ([d245790](https://github.com/TestPlanIt/testplanit/commit/d245790b08cf6104287e38a3b98a95ab85e4caf7))
* **integrations:** add the requirements-config write route ([537ab75](https://github.com/TestPlanIt/testplanit/commit/537ab75e3c0602418fbb1d6db351fac9c1412a0f))
* **integrations:** Azure DevOps work-item attachments as generation context ([16327c1](https://github.com/TestPlanIt/testplanit/commit/16327c1da10286a24e1a0960d95f2aabf0ab2428))
* **integrations:** bulk-import external issues into a project with a scoped filter ([#492](https://github.com/TestPlanIt/testplanit/issues/492)) ([0878f20](https://github.com/TestPlanIt/testplanit/commit/0878f209a69febf8b674a550555947ab8668447b)), closes [#452](https://github.com/TestPlanIt/testplanit/issues/452)
* **integrations:** classify Gitea requirements by label, matching GitHub ([695c695](https://github.com/TestPlanIt/testplanit/commit/695c695be790f906d09837801566139de632a735))
* **integrations:** classify GitHub requirements by label ([1793b8f](https://github.com/TestPlanIt/testplanit/commit/1793b8f2c5a178b5eb6c5f89b8259307199d7667))
* **integrations:** classify synced issues against configured requirement types ([ec4613f](https://github.com/TestPlanIt/testplanit/commit/ec4613f9cd07e9647ab79b21e88178d9dc13a7d3))
* **integrations:** complete synced parentId hierarchy within one import run ([b5229b6](https://github.com/TestPlanIt/testplanit/commit/b5229b6e2fed01f2093c07190835aaf2e515c4c4))
* **integrations:** give each linked project a single import action under Requirement Sync ([863771d](https://github.com/TestPlanIt/testplanit/commit/863771d1c0074b72b18f85cfab5c54462b64a40b))
* **integrations:** import every issue of the selected types, paged to completion ([423534c](https://github.com/TestPlanIt/testplanit/commit/423534c03183c587b70165bd8ae2a93047c085dd))
* **integrations:** let a project admin stop a running import ([2f4ee25](https://github.com/TestPlanIt/testplanit/commit/2f4ee253b499dd496af01afb05b14d6be2701aa6))
* **integrations:** let a search scope itself to specific issue types ([ea00ffc](https://github.com/TestPlanIt/testplanit/commit/ea00ffc3207d9484bb081e4c657cf20e8bdfa735))
* **integrations:** let one import dialog take issue types and the whole history ([3869d0b](https://github.com/TestPlanIt/testplanit/commit/3869d0bf81237bc3209c872b3ccd3c6060093e4f))
* **integrations:** mount the requirements-config card in project settings ([b3ee54f](https://github.com/TestPlanIt/testplanit/commit/b3ee54f658f30a60bee8858da4b3746cb4eefa1c))
* **integrations:** push issue-type scoping into Azure DevOps and Redmine queries ([0fadac2](https://github.com/TestPlanIt/testplanit/commit/0fadac2b173b8dfa3d2727762678ebc8e9209ebf))
* **integrations:** recompute isRequirement classification for a project ([af10b2d](https://github.com/TestPlanIt/testplanit/commit/af10b2d390702fc635ca0821034de6397cee4387))
* **integrations:** refresh expired OAuth tokens in background syncs and notify when re-auth is needed ([3ee6549](https://github.com/TestPlanIt/testplanit/commit/3ee6549f740939e6e7dafd39aa26241228eef0d7))
* **integrations:** report how many issues of the selected types the tracker holds ([11b82c8](https://github.com/TestPlanIt/testplanit/commit/11b82c8443f6baefd66b84cd2c2676ede0f8197c))
* **integrations:** resolve and write synced parentId on both sync write paths ([a92dd8c](https://github.com/TestPlanIt/testplanit/commit/a92dd8cb0d069f55b419583c985f312422f23bd7))
* **integrations:** scope GitLab searches by issue type one type at a time ([448197e](https://github.com/TestPlanIt/testplanit/commit/448197ee85def490832d57ba99c0cee825a13eeb))
* **issues:** add authoritative cycle guard trigger for Issue.parentId ([1822b29](https://github.com/TestPlanIt/testplanit/commit/1822b29bbb8a3b206699dd21a1db89472e400863))
* **issues:** add reviewed raw-write shell for locked requirement fields ([62ecb94](https://github.com/TestPlanIt/testplanit/commit/62ecb946a6dac00a7c017d84cc1b179c5120812c))
* **issues:** add the shared requirement/defect row scope predicate ([a8da871](https://github.com/TestPlanIt/testplanit/commit/a8da871407202740486db4bbebed11b21263a065))
* **issues:** attach tracker issues by key through the API, MCP server and import ([#597](https://github.com/TestPlanIt/testplanit/issues/597)) ([813fa6d](https://github.com/TestPlanIt/testplanit/commit/813fa6de3f6583605e054eb4d9cf7b4ae975a3ef)), closes [#596](https://github.com/TestPlanIt/testplanit/issues/596)
* **issues:** exclude requirement rows from the faceted-search issue picker ([fa393f4](https://github.com/TestPlanIt/testplanit/commit/fa393f46e6f46a933b322434a64c1494daebb321))
* **issues:** exclude requirement rows from the milestone linked-defect list ([9d5a1dd](https://github.com/TestPlanIt/testplanit/commit/9d5a1dde9f9e0583d68ef5d0b521bd4524a09d5c))
* **issues:** exclude requirement rows from the search-issues picker by default ([bd46789](https://github.com/TestPlanIt/testplanit/commit/bd467892b84c2dc395ae0dec91c20e732eed5c01))
* **issues:** extend the internal-or-tracker source toggle to the shared issue picker ([2f2f92b](https://github.com/TestPlanIt/testplanit/commit/2f2f92bd6a5f659884a2895b4c040f0903f2525c))
* **issues:** opt milestone membership into requirement rows, on purpose ([0d66216](https://github.com/TestPlanIt/testplanit/commit/0d662167333d0e2ef6bd4eb836a5b1e94db435fc))
* **issues:** scope the three issue list pages to defect rows ([cb318d4](https://github.com/TestPlanIt/testplanit/commit/cb318d42dac5dd7282022f4ff430119ff7b04f61))
* **jira-panel:** hide deleted cases without results, mark the rest as deleted ([20a56dc](https://github.com/TestPlanIt/testplanit/commit/20a56dc4f78c7c3102562c10c6579367aae876f6))
* **jira-panel:** per-template case field display in the Jira issue panel ([8e924a2](https://github.com/TestPlanIt/testplanit/commit/8e924a25f96e705de618758af8a7a21063f3433c))
* **jira-panel:** show Steps fields as a count chip with a step-list popover ([46d82df](https://github.com/TestPlanIt/testplanit/commit/46d82dfc2fa1d506e661de807675fcd08e71f768))
* **llm:** add DeepSeek as a first-class LLM provider ([fc7c36e](https://github.com/TestPlanIt/testplanit/commit/fc7c36eb5d0143a7ffca152fa7784e0eb928c1fa))
* **llm:** auto-populate model cost fields from provider pricing ([a69f82e](https://github.com/TestPlanIt/testplanit/commit/a69f82e8d65a7a45b5ff6b420e59e28163205930))
* **llm:** context-image pipeline for test-case generation ([36a6dc5](https://github.com/TestPlanIt/testplanit/commit/36a6dc53ca0914f7bcd23014adae7af84e30b670))
* **llm:** multimodal message contract with per-provider image translation ([b1aade9](https://github.com/TestPlanIt/testplanit/commit/b1aade98a289f8e68979f1520a15fd9ae3b7985f))
* **mcp-server:** add run-case editing tools and exclude soft-removed run cases ([37efc19](https://github.com/TestPlanIt/testplanit/commit/37efc19d1e0d6a0a95914c44b8692668605a06d9))
* **mcp-server:** repository reporting rollups — cases_count, subtree scoping, honest folder trees ([8e5338b](https://github.com/TestPlanIt/testplanit/commit/8e5338b8b4cb25d80783cd106dfcbcf0df3c2332))
* **mcp-server:** surface automated JUnit results through run results tools ([ce715f0](https://github.com/TestPlanIt/testplanit/commit/ce715f0495b1928f16b4dac248edb3f90e61deda))
* **mcp-server:** surface the user's Review inbox and let agents decide ([#569](https://github.com/TestPlanIt/testplanit/issues/569)) ([24d7386](https://github.com/TestPlanIt/testplanit/commit/24d7386b21cf5a21dfd33d15659c1338552ccbc4))
* **milestone:** add collapsible panels for left and right sections with transition effects ([72cfb1d](https://github.com/TestPlanIt/testplanit/commit/72cfb1d7e6727ebc48958614c87a0581ecede1ea))
* **milestones:** filter the import picker by Release/Sprint, and count the import button ([cee4b7a](https://github.com/TestPlanIt/testplanit/commit/cee4b7abbbef06a24c5472cc514414525f87a617))
* **milestones:** quick-generate test cases from scope issues table ([6c89162](https://github.com/TestPlanIt/testplanit/commit/6c8916261f9478fc63e5adc07dd2116a85804e30))
* **milestones:** show linked Jira project (space) on the source badge ([50c1d6e](https://github.com/TestPlanIt/testplanit/commit/50c1d6eab1fcbec97cbc8386d0690496a9e00dba))
* **milestones:** show the full Jira badge on child rows and pickers ([dca460f](https://github.com/TestPlanIt/testplanit/commit/dca460f943da2b0dd4e26e454fd257034b1b3f61))
* **milestones:** surface cross-project test cases and results on in-scope issues ([9a33099](https://github.com/TestPlanIt/testplanit/commit/9a33099cf077b40805de961fba91509b4111c961))
* **milestones:** sync milestones from Jira with issue membership, webhooks, and live updates ([#512](https://github.com/TestPlanIt/testplanit/issues/512)) ([fd34a5a](https://github.com/TestPlanIt/testplanit/commit/fd34a5a20893331d009faf81dbd98e7a314452d4)), closes [#496](https://github.com/TestPlanIt/testplanit/issues/496)
* **nginx:** log request timing, and load the http-context include ([1a51d26](https://github.com/TestPlanIt/testplanit/commit/1a51d26ed5028063915794cac130cbc6d3f7d6a9))
* **nginx:** support local overrides + ship a custom-error-pages drop-in ([#518](https://github.com/TestPlanIt/testplanit/issues/518)) ([bcbb429](https://github.com/TestPlanIt/testplanit/commit/bcbb429757fdaa13466d574b5b7b1d0c9e59fa01))
* **preview:** add preview messages for various languages ([dfd5ef1](https://github.com/TestPlanIt/testplanit/commit/dfd5ef1516918978c83ad36513b5ff3e90a3658e))
* **previews:** give shared links a card that says what they point to ([6aecdbf](https://github.com/TestPlanIt/testplanit/commit/6aecdbfe4eb96b4282dbe46c7bda151f55363839))
* **profile:** add role-scoped Assignments section to user profiles ([46f0d79](https://github.com/TestPlanIt/testplanit/commit/46f0d798cf4da2fa36b55b05ba94c45eed4661e7))
* **quickscript:** expose generation via API token, MCP, and Jira plugin ([bebfe3e](https://github.com/TestPlanIt/testplanit/commit/bebfe3e2d3f08bcce0adb41d058242795e098135))
* **record-keys:** add optional project-prefixed record identifiers ([0c10d76](https://github.com/TestPlanIt/testplanit/commit/0c10d76904a55a12c604fe3d756c2e723ee88aea))
* **release:** add upgrade notifications and release notes for TestPlanIt 1.1 ([55e7bc9](https://github.com/TestPlanIt/testplanit/commit/55e7bc98e5c8e6f1190ba277e855577ee31750e1))
* **release:** publish the Helm chart alongside the self-host images ([#621](https://github.com/TestPlanIt/testplanit/issues/621)) ([8eb82fe](https://github.com/TestPlanIt/testplanit/commit/8eb82fe60b132a822e151a9ab3bd0a009bf0f152))
* **reporters:** add excludeSkipped option to omit skipped results from runs ([fcdcd9c](https://github.com/TestPlanIt/testplanit/commit/fcdcd9c2adab7a555cd81373d0f322dd8f60c2f8))
* **reporters:** attach every Playwright execution to one externally managed run ([#557](https://github.com/TestPlanIt/testplanit/issues/557)) ([4b496cd](https://github.com/TestPlanIt/testplanit/commit/4b496cd1aa439c86eca5db99367f2b4f237ceff8))
* **reporters:** attach every wdio invocation to one externally managed run ([#555](https://github.com/TestPlanIt/testplanit/issues/555)) ([b01ba80](https://github.com/TestPlanIt/testplanit/commit/b01ba8030b629d0b00eaf46aa657eec4b287527a))
* **reporters:** attach links, files, and metadata to the test run itself ([#547](https://github.com/TestPlanIt/testplanit/issues/547)) ([44b7a92](https://github.com/TestPlanIt/testplanit/commit/44b7a92917691c3750b6d9a265ce4751edcf3574))
* **reporters:** flip explicitly linked cases to automated when they receive results ([2e0f2e2](https://github.com/TestPlanIt/testplanit/commit/2e0f2e245b17ed6fb741dd270656bd2d74d2e2e1))
* **reporters:** report the worker id of every attempt ([cb2d9ff](https://github.com/TestPlanIt/testplanit/commit/cb2d9ffaabbc77c9307be94f2bd931ca6807207d))
* **reports:** add column sets for the requirement coverage reports ([b7f41df](https://github.com/TestPlanIt/testplanit/commit/b7f41df0c4084b584fb41a80f319e1ae3d740469))
* **reports:** add cross-project LLM Usage report ([6ef5981](https://github.com/TestPlanIt/testplanit/commit/6ef5981fb62caf36cb2fc7d4c38d70b395b4ccaf))
* **reports:** add the requirement coverage gap and traceability handlers ([934496e](https://github.com/TestPlanIt/testplanit/commit/934496e889fd03407f73b9531aba95d2c3014e29))
* **reports:** carry per-type params through the share redirect for every pre-built report ([052fcb5](https://github.com/TestPlanIt/testplanit/commit/052fcb57e8c465b8062422c3b60ebf9fc8633759))
* **reports:** count metrics read the manual+automated result union ([148a7f6](https://github.com/TestPlanIt/testplanit/commit/148a7f66a1a166004d5c3f22ccfa50940ec9862b))
* **reports:** cross-project requirement reports and one filter menu ([edcb068](https://github.com/TestPlanIt/testplanit/commit/edcb0685f6ba84eb9754c3d9a3a8cecc0ca4119a))
* **reports:** dual-source metrics, dimension filters, and report API hardening ([2a9afb5](https://github.com/TestPlanIt/testplanit/commit/2a9afb549b733bba19737930cbf04a99f69a3516))
* **reports:** generate test cases from a coverage-gap row ([e678e54](https://github.com/TestPlanIt/testplanit/commit/e678e54da8335313ce8704d5ffd7bd2257f7bee9))
* **reports:** link Test Result History to elapsed-time report ([37ce519](https://github.com/TestPlanIt/testplanit/commit/37ce519fc1a951f7d39ddd6afda8e50b37ac5d13))
* **reports:** offer the requirement coverage reports and export them to csv ([9b4f2f7](https://github.com/TestPlanIt/testplanit/commit/9b4f2f7c2f86e2e8b02d79090030ed45141eda6b))
* **reports:** register the requirement coverage report endpoints ([af41401](https://github.com/TestPlanIt/testplanit/commit/af41401dff0967435bf91ca3ac7f0fe2c32aaa52))
* **reports:** requirement report columns, filters, and visualizations ([bd72661](https://github.com/TestPlanIt/testplanit/commit/bd72661f2682b3474bc99ad3b7fed1a5d89b15eb))
* **reports:** scope, filter, and tier the requirement report data ([f7c02d8](https://github.com/TestPlanIt/testplanit/commit/f7c02d8091aa6d33adfca83affb129de1cf72e22))
* **reports:** structural hardening — canonical result union, dimension whitelists, unit metadata ([787b1d3](https://github.com/TestPlanIt/testplanit/commit/787b1d364385c0a203eff5a97f76e5ca22e1e3f3))
* **reports:** view, compare, and manage traceability snapshots ([14583db](https://github.com/TestPlanIt/testplanit/commit/14583db3217a2f23fc91fd4623b03ceb41916bf8))
* **repository:** auto-save drafts while writing a test case ([#601](https://github.com/TestPlanIt/testplanit/issues/601)) ([e11fefe](https://github.com/TestPlanIt/testplanit/commit/e11fefee080bf4e7cd9e4fcb09ec5d0a819ff0d3))
* **repository:** column header menu with sort, hide, and remembered sort ([4f28e4c](https://github.com/TestPlanIt/testplanit/commit/4f28e4ced8f6439a401cd0dac5af70bccd4fec18))
* **repository:** current-run highlight and virtualized result history ([78c2aa4](https://github.com/TestPlanIt/testplanit/commit/78c2aa4f7e5a5a5447c00b311a8e0035587fad99))
* **repository:** dock test case details in a resizable side panel ([e0f09bb](https://github.com/TestPlanIt/testplanit/commit/e0f09bb93283dee432e9f65f6891e5dc2fc1d2c3))
* **repository:** filter test cases across multiple dimensions ([#568](https://github.com/TestPlanIt/testplanit/issues/568)) ([8caf880](https://github.com/TestPlanIt/testplanit/commit/8caf880bad5c35fe38f7ca4fbab1ae5e6bb5f697))
* **repository:** highlight the selected case's row in the list ([ac99b56](https://github.com/TestPlanIt/testplanit/commit/ac99b565d525ac4ea6bd554b43ca5dec48ab8d89))
* **repository:** make folders findable in large trees ([b5e6b7c](https://github.com/TestPlanIt/testplanit/commit/b5e6b7c9bbf68bb842730a50a826309453974848))
* **repository:** make the docked case-details panel drag-resizable ([72a44c5](https://github.com/TestPlanIt/testplanit/commit/72a44c5942229f658908224e540bf34512225be9))
* **repository:** reorderable, resizable columns with remembered order and width ([0ca956d](https://github.com/TestPlanIt/testplanit/commit/0ca956d35d4111f12872bd90f77e0cf4c02a5c90))
* **repository:** show a case's latest results instead of only the last one ([47a904b](https://github.com/TestPlanIt/testplanit/commit/47a904bc6f9c78b0284e3288dca5ed9cbe9b1239))
* **repository:** show where a dragged test case can be dropped ([1eb1b1f](https://github.com/TestPlanIt/testplanit/commit/1eb1b1fe3a32338e6cb969ae4246655f95b8e18a))
* **repository:** sort the case list by the status of the latest result ([35f2a6b](https://github.com/TestPlanIt/testplanit/commit/35f2a6b64db6ee981548229a15f1c87ebf59fa65))
* **requirements:** add a root-level drop zone to the requirement tree ([f67cdd4](https://github.com/TestPlanIt/testplanit/commit/f67cdd4cb2e7c321cc4b831b4f0dddb07604bb3a))
* **requirements:** add a shared case-requirement link hook ([ccf0148](https://github.com/TestPlanIt/testplanit/commit/ccf0148ec237a17c87d70d92fc6e0a0c5d32fb6d))
* **requirements:** add a sortable, hidden-by-default Created column ([a081a84](https://github.com/TestPlanIt/testplanit/commit/a081a8489251fb0dcfee726438fd6eead9ceaea4))
* **requirements:** add a sortable, visible-by-default Priority column ([717f3b6](https://github.com/TestPlanIt/testplanit/commit/717f3b6af7d81c3705f2e3305516cf9a5ac7848f))
* **requirements:** add an internal-or-tracker source toggle to the reference picker ([8283c56](https://github.com/TestPlanIt/testplanit/commit/8283c56ad88e8cd452fd2b1d75632fbc6d530b1b))
* **requirements:** add cascade soft-delete and symmetric restore for requirement subtrees ([793b0ab](https://github.com/TestPlanIt/testplanit/commit/793b0abca1d0e5b8933460fe8a850fc2081bacb8))
* **requirements:** add covering-case drill-down alongside the coverage rollup ([a930301](https://github.com/TestPlanIt/testplanit/commit/a930301261cc7d465cc5623710dc628f2f2e3ced))
* **requirements:** add DELETE references route to detach a reference ([c5e7bf0](https://github.com/TestPlanIt/testplanit/commit/c5e7bf0a2cd9bc5a1e2b00fdbe9fc93ebc0baadd))
* **requirements:** add descendant-id map and case-count sort keys ([10696a9](https://github.com/TestPlanIt/testplanit/commit/10696a9fc08d7fd741e49d0bf7929fbfd812a5da))
* **requirements:** add diff-aware contentUpdatedAt trigger and denylist it ([3f6efd2](https://github.com/TestPlanIt/testplanit/commit/3f6efd203a571d9c6c068d7d7a0fbffe8c264a23))
* **requirements:** add GET /api/repository-cases/[caseId]/latest-execution ([7eb424b](https://github.com/TestPlanIt/testplanit/commit/7eb424bbfb53672104bafda5e3949b4e9561f060))
* **requirements:** add issue ancestor map and subtree CTE ([4392932](https://github.com/TestPlanIt/testplanit/commit/439293215e7ecf8890254e43f939fa8d781972ee))
* **requirements:** add Linked/Covering Test Cases columns ([1966dac](https://github.com/TestPlanIt/testplanit/commit/1966dac86cdfb2c1b087b36551171a27c2257ab7))
* **requirements:** add POST references route for manual traceability ([f45dd18](https://github.com/TestPlanIt/testplanit/commit/f45dd18dadef4fec37aa05aa78b3b637591aea66))
* **requirements:** add priority sort case to the list comparator ([5e6c135](https://github.com/TestPlanIt/testplanit/commit/5e6c135a71170b6f551d47c6b92c0cf000379062))
* **requirements:** add reparent guards with RED-first proof ([2bf9418](https://github.com/TestPlanIt/testplanit/commit/2bf9418425aa7b242377bfb69acad70032bc479f))
* **requirements:** add subtree delete and restore routes ([e284717](https://github.com/TestPlanIt/testplanit/commit/e284717bbd2b982595ee270bcf752ce94f0f76a4))
* **requirements:** add suspect and references i18n namespaces ([9ac2e9c](https://github.com/TestPlanIt/testplanit/commit/9ac2e9c9f64b4239d24ce1872c73b946cbd2a237))
* **requirements:** add the coverage query hook ([07ea720](https://github.com/TestPlanIt/testplanit/commit/07ea720c4cb461215cf030296df713974d8b7aae))
* **requirements:** add the coverage, export, and report i18n keys ([bfe0eae](https://github.com/TestPlanIt/testplanit/commit/bfe0eae4e6f615f2ed9c393141eb99c84779cb43))
* **requirements:** add the covering-case drill-down panel ([dc31a0d](https://github.com/TestPlanIt/testplanit/commit/dc31a0d7f76152e49f0018035ab542825f479c9d))
* **requirements:** add the covering-case query hook ([3d7a6ba](https://github.com/TestPlanIt/testplanit/commit/3d7a6ba715a582ff676224968734fbbe1be56b97))
* **requirements:** add the detach route ([6bd3ef1](https://github.com/TestPlanIt/testplanit/commit/6bd3ef1a770d00d1021f578d75ace8e9ab6830ad))
* **requirements:** add the guarded reparent route ([8f843f8](https://github.com/TestPlanIt/testplanit/commit/8f843f812adaf6054e1f3d2db3e58fc639372a8e))
* **requirements:** add the list view column defs and name/actions cells ([3a0eb2a](https://github.com/TestPlanIt/testplanit/commit/3a0eb2a5a5572d59438e65ad6cf18761bc3564d4))
* **requirements:** add the project requirements route and nav entry ([7ede4d2](https://github.com/TestPlanIt/testplanit/commit/7ede4d2998309eed2668ba8f97b238ab5a6ff912))
* **requirements:** add the provenance badge with a detach action ([808d73a](https://github.com/TestPlanIt/testplanit/commit/808d73a61ee6b91b33d8c45247bc383b91ee349e))
* **requirements:** add the pure traceability row builders ([8bcc26b](https://github.com/TestPlanIt/testplanit/commit/8bcc26b8d04897ac0b6a0f661d5f157e946a2cec))
* **requirements:** add the References card and mount it in the detail panel ([0a92c13](https://github.com/TestPlanIt/testplanit/commit/0a92c13a05c3cb7dc8771e975d089ee5ccc50802))
* **requirements:** add the requirement detail panel ([1e08bd0](https://github.com/TestPlanIt/testplanit/commit/1e08bd056d7561d83497a40bafcfc143366faa67))
* **requirements:** add the traceability export and respect the project opt-in ([4241467](https://github.com/TestPlanIt/testplanit/commit/4241467508efa51f7d547c64244a38371213a609))
* **requirements:** add the tree coverage indicator ([c2d5336](https://github.com/TestPlanIt/testplanit/commit/c2d5336d9adeaab94862b466831d96d8e45632d6))
* **requirements:** add uncoveredWhen prop to CoverageChip ([9ae81b2](https://github.com/TestPlanIt/testplanit/commit/9ae81b2429c07e811b55cbb820f3d357e87fe33f))
* **requirements:** add useCaseLatestExecution hook with its own predicate-based invalidator ([a7eb2bf](https://github.com/TestPlanIt/testplanit/commit/a7eb2bfb6cf750072142f4aaa082e7183260f055))
* **requirements:** allow deleting a requirement from its details panel ([6e5dab0](https://github.com/TestPlanIt/testplanit/commit/6e5dab0066cc19abb738c62a2fbe6239c540a4af))
* **requirements:** apply attachment changes with the requirement's save, discard them with cancel ([496bc33](https://github.com/TestPlanIt/testplanit/commit/496bc33e621567f7cd290035890563820d605c6b))
* **requirements:** assemble the traceability matrix from the shipped coverage services ([fd4328e](https://github.com/TestPlanIt/testplanit/commit/fd4328e4f91386a37b75775fe01056f358c7823e))
* **requirements:** attach files to a requirement ([959ed2e](https://github.com/TestPlanIt/testplanit/commit/959ed2ea7180c160fe2915bd81040fa8073074ed))
* **requirements:** attach references from the Create Requirement dialog ([1c84fda](https://github.com/TestPlanIt/testplanit/commit/1c84fdaf66b1bd623f3cd37edce6f705987dd0a8))
* **requirements:** author rich-text notes on a requirement ([d92e332](https://github.com/TestPlanIt/testplanit/commit/d92e3329fa8ff1b3285ad781d88bd1035e49fee8))
* **requirements:** author suspect-flag and reference-join schema additions ([637508b](https://github.com/TestPlanIt/testplanit/commit/637508b532bf723518012ba90c599ae0d11522fb))
* **requirements:** build the tree-table list view shell ([c190d99](https://github.com/TestPlanIt/testplanit/commit/c190d99e9df368fd55c7b4fcde945431248c148f))
* **requirements:** capture point-in-time traceability snapshots ([f501766](https://github.com/TestPlanIt/testplanit/commit/f501766996a6ce5830aa1a01f5156f63c680af2f))
* **requirements:** carry each covering case's latest result in the drill-down ([b2120e9](https://github.com/TestPlanIt/testplanit/commit/b2120e9547e3c333eb4b1a26eab8ffdb3f8fc94d))
* **requirements:** create requirements natively ([9cd7023](https://github.com/TestPlanIt/testplanit/commit/9cd7023c63b922c443894ad81936c8716b119426))
* **requirements:** delete a requirement and its subtree ([9b22c4b](https://github.com/TestPlanIt/testplanit/commit/9b22c4b7d6d9dff4ea70c486a685d292f75d1f6f))
* **requirements:** derive list rows from a partially loaded tree ([64a67d2](https://github.com/TestPlanIt/testplanit/commit/64a67d215ad1563750353047d3ad15c097931537))
* **requirements:** enhance RequirementsList with coveringCases column and update filters layout ([08364e2](https://github.com/TestPlanIt/testplanit/commit/08364e2748198bfe65e266a5bc625398704d9f98))
* **requirements:** expand a requirement and count its subtree over HTTP ([48b959c](https://github.com/TestPlanIt/testplanit/commit/48b959c37b478487c1a13722b863e4eefa5bb424))
* **requirements:** export the traceability matrix as a pdf ([d817739](https://github.com/TestPlanIt/testplanit/commit/d81773953f6f942ce8bb1bca0157d00c528ca23b))
* **requirements:** expose the coverage rollup on a project-scoped route ([296a307](https://github.com/TestPlanIt/testplanit/commit/296a307b1fccb929d5a84ca30d647128cd0f24cc))
* **requirements:** expose the covering-case drill-down per requirement ([aaca768](https://github.com/TestPlanIt/testplanit/commit/aaca768ba57c1bf5bf492c06b8fdc2380b10030f))
* **requirements:** extend coverage rollup with per-status breakdown and direct counts ([2da37cc](https://github.com/TestPlanIt/testplanit/commit/2da37cca83b0f3b6e5d25d333bd2694a861e9f5e))
* **requirements:** extract the pure row model for the list rebuild ([9dda3d4](https://github.com/TestPlanIt/testplanit/commit/9dda3d4a83e2b6f347ea0c1c328147d0d8d92cf3))
* **requirements:** fetch a requirement's children when it is expanded ([d954096](https://github.com/TestPlanIt/testplanit/commit/d954096ae8b7f0d1820b2ecc94eb4fd9af3bb707))
* **requirements:** fetch a requirement's descendant count on demand ([a4423c0](https://github.com/TestPlanIt/testplanit/commit/a4423c0261c25914431c9a21bc5d2d59ff536858))
* **requirements:** fetch one requirement's children and count its subtree server-side ([1df7609](https://github.com/TestPlanIt/testplanit/commit/1df760977d9f574b95e34114e12ce354f5fbb802))
* **requirements:** filter the requirements list server-side ([7600183](https://github.com/TestPlanIt/testplanit/commit/7600183b948d86767810dadca592b0decf1c6270))
* **requirements:** filter the tree to requirements with no test coverage ([ade06dd](https://github.com/TestPlanIt/testplanit/commit/ade06dd707ab917bd1682659a7c19e3e7afd43ec))
* **requirements:** fork the issue picker for LINK-03 references ([a362654](https://github.com/TestPlanIt/testplanit/commit/a362654702fa427594f05830d634608955700eee))
* **requirements:** generalize visibility filter to coverage/status/source axes ([8b8331b](https://github.com/TestPlanIt/testplanit/commit/8b8331b05f0d2a8068e84e4a980dc1a55bc6c493))
* **requirements:** give every requirement its own addressable page ([4917876](https://github.com/TestPlanIt/testplanit/commit/49178767f400a43dc0edaddfd1639357e77fea95))
* **requirements:** integrate ColumnSelection for dynamic column visibility management ([be08112](https://github.com/TestPlanIt/testplanit/commit/be08112716b3aad247aad308c6565aa858d31ade))
* **requirements:** let a project admin request cancellation of a running import ([9ff9406](https://github.com/TestPlanIt/testplanit/commit/9ff940600b57cf27a800cd29c8ee5ec9f6a83980))
* **requirements:** link a coverage result back to the run it came from ([a0b44b3](https://github.com/TestPlanIt/testplanit/commit/a0b44b3802956a3a4679b953c03808793f696016))
* **requirements:** link a cross-project case's badge to the owning project ([5c3ada3](https://github.com/TestPlanIt/testplanit/commit/5c3ada35a1f0f2636807ef63bf71adebc8efe825))
* **requirements:** link requirements from the test case detail page ([0a6ee7f](https://github.com/TestPlanIt/testplanit/commit/0a6ee7f200933ab37df17f2051f05d127b69850b))
* **requirements:** link test cases from the requirement surface ([70c955d](https://github.com/TestPlanIt/testplanit/commit/70c955d54a5faa7ad7e95354b4c1df9067ee9423))
* **requirements:** load the requirements list lazily above the threshold ([41e3bbb](https://github.com/TestPlanIt/testplanit/commit/41e3bbbf9ed3e27f7b1a2d59ddb7fe95a547114b))
* **requirements:** load the requirements tree lazily above the threshold ([c93fc55](https://github.com/TestPlanIt/testplanit/commit/c93fc55b65a66dd1cf36319d9789fe7f6763f9d7))
* **requirements:** make the requirements area opt-in per project ([5682037](https://github.com/TestPlanIt/testplanit/commit/568203784e8d0dbd860de7f9f57c23c183c8d118))
* **requirements:** match the repository page's list/detail behaviour ([286135d](https://github.com/TestPlanIt/testplanit/commit/286135dd92dac412f262e9e0dccd6eea18e07a7a))
* **requirements:** mirror tracker priority and stop fabricating "medium" ([0808272](https://github.com/TestPlanIt/testplanit/commit/0808272d9cef11c0d98b00992c01beb36a276a30))
* **requirements:** mount the coverage drill-down on the requirement detail panel ([2ef3076](https://github.com/TestPlanIt/testplanit/commit/2ef3076b344298fa3a43818ceb88d14a6aaea34d))
* **requirements:** mount the detail panel in the requirements workspace ([c844c58](https://github.com/TestPlanIt/testplanit/commit/c844c589caec86b847574af35d1613ba91510b03))
* **requirements:** mount the requirement tree in the workspace ([ecf0eba](https://github.com/TestPlanIt/testplanit/commit/ecf0ebadb4c3cda5ca550fa5431c64346ce97392))
* **requirements:** mount the suspect badge and dismiss popover on the case-side linkage panel ([1829261](https://github.com/TestPlanIt/testplanit/commit/182926148c914065ac48cd92084ddb6426b2b768))
* **requirements:** mount the suspect badge and dismiss popover on the requirement-side linkage panel ([1ba3cd2](https://github.com/TestPlanIt/testplanit/commit/1ba3cd2fbbd3d48796bc516c1af627656d17bdf1))
* **requirements:** mount the tree-table list and retire the react-arborist tree ([55c32d7](https://github.com/TestPlanIt/testplanit/commit/55c32d7157d1aed475c1605e9b7902e332eda4b3))
* **requirements:** move Add Requirement into the page action bar ([1a33db8](https://github.com/TestPlanIt/testplanit/commit/1a33db89aebe63433bf9528446f01a5feb6760d3))
* **requirements:** multi-select filters and project-wide sorting ([9e0bfac](https://github.com/TestPlanIt/testplanit/commit/9e0bfacc15f59d2b1067aa84afcdf9f7dee6f62b))
* **requirements:** offer a typed import from the Requirement Types section ([2c1cb5e](https://github.com/TestPlanIt/testplanit/commit/2c1cb5e2d6929b8c96536755262c602a673e2b03))
* **requirements:** outline candidate drop zones and advertise the root strip during a drag ([5362916](https://github.com/TestPlanIt/testplanit/commit/5362916f4eacc9d4e9ed7aa19bac90d8d17f728c))
* **requirements:** page the requirements list as you scroll and say how many are shown ([7882bd1](https://github.com/TestPlanIt/testplanit/commit/7882bd136430eee4d5b18a71e9311928dc4692c2))
* **requirements:** per-issue requirement classification override ([2f4cb5d](https://github.com/TestPlanIt/testplanit/commit/2f4cb5de95f74680f010239da52f86a5abb8b142))
* **requirements:** promote, exclude, and reset issues from the app surfaces ([c7b6cff](https://github.com/TestPlanIt/testplanit/commit/c7b6cff6a0c3935df6d46b071f8d5681be9f47a6))
* **requirements:** read the requirement tree's roots a window at a time ([0191a35](https://github.com/TestPlanIt/testplanit/commit/0191a35511a38a58da5868574a6cf282bf02ec28))
* **requirements:** rebuild drag affordances as direct DOM attributes ([cad449f](https://github.com/TestPlanIt/testplanit/commit/cad449ff82eb9f4ab835a584b6e95e3df218394e))
* **requirements:** register the requirement drag-item type and list column strings ([491f066](https://github.com/TestPlanIt/testplanit/commit/491f0661b1b1d4548daffc007b34f5dc1a552bca))
* **requirements:** rename a requirement from the tree ([37e2f34](https://github.com/TestPlanIt/testplanit/commit/37e2f34f63a559e042ca5ee9ac4c383cf8cf3bd3))
* **requirements:** render the Coverage column through CoverageChip ([9e6d29e](https://github.com/TestPlanIt/testplanit/commit/9e6d29edd68498cb6ba7e1f7c941fac4cc0ab1b4))
* **requirements:** render the requirement hierarchy as a tree ([6a70d6b](https://github.com/TestPlanIt/testplanit/commit/6a70d6b6be6ba83e173bf273c1590dbf1dffcea5))
* **requirements:** reparent a requirement by dragging it ([f308e31](https://github.com/TestPlanIt/testplanit/commit/f308e318c0f1ba6d2c34135f890917e683e0a1ac))
* **requirements:** replace the uncovered toggle with Coverage/Status/Source filters ([a6385e6](https://github.com/TestPlanIt/testplanit/commit/a6385e6ea5b31c834379e768903b61e7ecf1a5c6))
* **requirements:** report how many tracker issues the configured types would import ([f5f78cf](https://github.com/TestPlanIt/testplanit/commit/f5f78cfee861366ee21a46745fd03a665eda70d4))
* **requirements:** resolve the requirements list's filters server-side ([7334930](https://github.com/TestPlanIt/testplanit/commit/73349309546befa13bfee497e38be3edf302379e))
* **requirements:** return each filtered match with its ancestor chain ([607be02](https://github.com/TestPlanIt/testplanit/commit/607be02c4820a9c988b776c892e8151b419f46f9))
* **requirements:** route the row menu's edit action to the details panel, replacing inline rename ([f856541](https://github.com/TestPlanIt/testplanit/commit/f85654187a98984954775bc1ad3c86709dcfa1f5))
* **requirements:** scope coverage to milestones and configurations ([af9eb2a](https://github.com/TestPlanIt/testplanit/commit/af9eb2a67f2eedd86fa62e1f145f4deb8fb1198c))
* **requirements:** serve the requirements list's filter options from the server ([0f277cb](https://github.com/TestPlanIt/testplanit/commit/0f277cba95aafe3a8113c5b78a96033153a6707b))
* **requirements:** serve the requirements tree a window at a time ([7006bdc](https://github.com/TestPlanIt/testplanit/commit/7006bdc177348361ebc920dd9585ff72c2fe90c5))
* **requirements:** show a case's linked requirements while executing it ([8b0b2a1](https://github.com/TestPlanIt/testplanit/commit/8b0b2a13bec1b4c9671a191e871f422a39c0c50c))
* **requirements:** show a grab handle on draggable requirement rows ([9849a5c](https://github.com/TestPlanIt/testplanit/commit/9849a5c7aacab6916b469f3b13e45c00f11b3a81))
* **requirements:** show a Return-submits hint on the Create button ([8b9e29c](https://github.com/TestPlanIt/testplanit/commit/8b9e29c527fb142b14561b4063d3b29a52db7b8d))
* **requirements:** show linked requirements on the case detail page ([ab24371](https://github.com/TestPlanIt/testplanit/commit/ab243718c2b22d563a3f0190b07cd366a2263adb))
* **requirements:** show rolled-up coverage on every requirement node ([4896154](https://github.com/TestPlanIt/testplanit/commit/48961548f9ca9502d6928bb57fec2a0e5737110f))
* **requirements:** show typed-import progress and let it be stopped ([6e99c9c](https://github.com/TestPlanIt/testplanit/commit/6e99c9ca08bce94b05baf01cf81437ef1cd8a5b3))
* **requirements:** start a paged-to-completion import of the configured types ([fae5639](https://github.com/TestPlanIt/testplanit/commit/fae563909a7ad0e0b07ca10494ac73068b1eb9ed))
* **requirements:** submit the requirements list's filters to the server ([b18c99e](https://github.com/TestPlanIt/testplanit/commit/b18c99e8fe1dc2841b97e2ab21a0e78d16e14c08))
* **requirements:** version requirement content with per-field diffs ([10cf28a](https://github.com/TestPlanIt/testplanit/commit/10cf28ae0ba1425bec1565fcce958ebb2bffb443))
* **requirements:** wire case-count columns into the list and pin actions ([9e4eb91](https://github.com/TestPlanIt/testplanit/commit/9e4eb91fdb2b05025bf125ed8463a497ef0febed))
* **requirements:** wire the drag-reparent gesture onto the list ([7fe8746](https://github.com/TestPlanIt/testplanit/commit/7fe87461632026690d53e3d14242816f38ac10ee))
* **reviews:** approving a request applies the workflow transition ([1fbb42e](https://github.com/TestPlanIt/testplanit/commit/1fbb42e8ed7b267fcc4b9cf3dc957ccf05ba3bdf))
* **reviews:** bulk request approvals from the case bulk edit ([62a0962](https://github.com/TestPlanIt/testplanit/commit/62a09622c101d7612fbba7c2b12bf7a857999991))
* **reviews:** cancel in-flight reviews when their subject is deleted ([bd96d2c](https://github.com/TestPlanIt/testplanit/commit/bd96d2c824ff2fdcb963f91887f54e086e7e3f1b))
* **reviews:** let system admins bypass workflow review gates ([c490166](https://github.com/TestPlanIt/testplanit/commit/c490166abeb58aee6cd1c0d273cd4d1c52047821))
* **reviews:** pending-review badges on run and session names beyond the list pages ([4c481e1](https://github.com/TestPlanIt/testplanit/commit/4c481e1db8b018f57d449c62c61ca43f00939647))
* **reviews:** surface pending reviews at the top of Your Assignments ([a17ec04](https://github.com/TestPlanIt/testplanit/commit/a17ec0447c236d9a39be269b216428e3cbebfadd))
* **runs,sessions:** show start and end dates derived from results ([fcefa42](https://github.com/TestPlanIt/testplanit/commit/fcefa42035893d0d3a2d20c4c6e491da679c3f5f))
* **runs:** add execution-start composition lock ([60a34cb](https://github.com/TestPlanIt/testplanit/commit/60a34cb4137c41f0cf12f63f4422334a230b46ef))
* **runs:** add localization for remove cases dialog ([59e2911](https://github.com/TestPlanIt/testplanit/commit/59e2911ca632f61f3ef737908cb9f6dfdf1d6cbf))
* **runs:** distribute test-case assignments across team members ([55a54ea](https://github.com/TestPlanIt/testplanit/commit/55a54eafc51c3204e643ef878878cb75c1704b08))
* **runs:** drop drag and drop from the runs list ([5cfdf63](https://github.com/TestPlanIt/testplanit/commit/5cfdf631d2f26b861c13c7bab01ee272e0d79fa3))
* **runs:** execution metrics, run duration, and flaky detection for automated runs ([5970e03](https://github.com/TestPlanIt/testplanit/commit/5970e03ad0ac1c140ae4b643ffd87163a4f77d4f))
* **runs:** execution timeline, real parallelization, and result filters for automated runs ([78b354c](https://github.com/TestPlanIt/testplanit/commit/78b354cb7ddf982c03b709ee84d10b76f83de34f))
* **schema:** add Attachments.issueId for requirement attachments ([d533a92](https://github.com/TestPlanIt/testplanit/commit/d533a925dbdcf3d1a6005300654c9bebd624fe7e))
* **schema:** add Issue hierarchy, provenance, and requirement-lock predicate ([3562eec](https://github.com/TestPlanIt/testplanit/commit/3562eec87959f231ee58adbe9bd308d7502805c2))
* **scim:** enforce cross-IdP ownership of provisioned rows (V2-MULTI-IDP-01) ([c5ec828](https://github.com/TestPlanIt/testplanit/commit/c5ec828e9d51f5f2a5b48d8dc1590be655a53256))
* **scim:** map groups to access tiers per project ([89b1c94](https://github.com/TestPlanIt/testplanit/commit/89b1c94a887f468023d47a2a3c6ab6c77bb69fe2))
* **scim:** map IdP roles to access tiers (HYBRID-01) ([01ed779](https://github.com/TestPlanIt/testplanit/commit/01ed779db77597dd687b02d1e69da882e4210115))
* **scim:** rotate tokens in place with an overlap window (D-08) ([ec8f126](https://github.com/TestPlanIt/testplanit/commit/ec8f1267b2d252aef85b2e18400c28515a28e207))
* **screenshots:** enhance URL-crawl screenshot capture and add integration tests for route guard ([0c9868d](https://github.com/TestPlanIt/testplanit/commit/0c9868d5a6ed12f624123e4446eba974fe808cc7))
* **search:** declare the requirement role in the ISSUE index mapping ([97cad84](https://github.com/TestPlanIt/testplanit/commit/97cad848a57e49890e032e4f7f985489d8826dcd))
* **search:** make Advanced Filters searchable comboboxes ([9f397c1](https://github.com/TestPlanIt/testplanit/commit/9f397c1a8dcfc95fafcd21e9c9a7d0c3c599ed06))
* **soft-delete:** add deletedAt timestamp with DB stamping trigger ([506ca3f](https://github.com/TestPlanIt/testplanit/commit/506ca3f18f15400f0a2c916fe0ab482ac83af558))
* **sync:** persist each tracker issue's own creation date ([1160ab0](https://github.com/TestPlanIt/testplanit/commit/1160ab04b0dc2937b9629f7eaff83fffc9a2eb82))
* **sync:** refuse cross-project issue reassignment when dependents exist ([9759b26](https://github.com/TestPlanIt/testplanit/commit/9759b2674df9b2cff02474fde6018630cd4301e4))
* **tables:** add getRowProps row extension point to the virtualized engine ([05d4f7a](https://github.com/TestPlanIt/testplanit/commit/05d4f7ac2338949c94daee6e12bad945a733460b))
* **tables:** let a self-flattening table opt into nested rows ([9a29bde](https://github.com/TestPlanIt/testplanit/commit/9a29bde8fe8764e6be4c2dcc339f1c9e67ab4f53))
* **tests:** add target-folder picker function to improve folder selection reliability in copy/move dialog tests ([0a2fdec](https://github.com/TestPlanIt/testplanit/commit/0a2fdec1f259ca2e33f1c46d5f19e4901527278c))
* **tests:** implement file-scoped resource tracking in ApiHelper and update cleanup logic ([b067532](https://github.com/TestPlanIt/testplanit/commit/b067532185ad9d99d062aa9b6d3cc0976fe6ccd8))
* **ui:** add icons to test run and session names for improved visibility ([179c859](https://github.com/TestPlanIt/testplanit/commit/179c8592414ae02a8fbad138b737eaa2a190d643))
* **uploads:** make the attachment and image ceiling configurable via UPLOAD_MAX_MB ([9582b56](https://github.com/TestPlanIt/testplanit/commit/9582b56975557cc4a2387f5f1bf2c9e1233667f0))
* **uploads:** make UPLOAD_MAX_MB take effect on prebuilt images ([#632](https://github.com/TestPlanIt/testplanit/issues/632)) ([cc576f0](https://github.com/TestPlanIt/testplanit/commit/cc576f069c1c666e1ceafd2dfb50c8aa602fc8a0))
* **wdio-reporter:** mark matched cases automated ([#527](https://github.com/TestPlanIt/testplanit/issues/527)) ([d660113](https://github.com/TestPlanIt/testplanit/commit/d660113ddeab372898799c6a36bb8efee04cd4b5))
* **wdio-reporter:** resolve cases by a custom field value ([#522](https://github.com/TestPlanIt/testplanit/issues/522)) ([0fdde8c](https://github.com/TestPlanIt/testplanit/commit/0fdde8cac0fcde10cec390a3d81fbbd8307cfc98))
* **webhooks:** emit test_run.duplicated / session.duplicated on duplicate ([b99aaa8](https://github.com/TestPlanIt/testplanit/commit/b99aaa859ff9fc5ed22a78d9bf8fcccfc0cf9274))
* **zenstack:** adopt migrate deploy with a data-preserving m2m migration ([898185c](https://github.com/TestPlanIt/testplanit/commit/898185cf477cefa76d499a6ec7e1ef1154a9d02e))
* **zenstack:** port $extends side-effects into v3 sideEffectsPlugin ([e48544b](https://github.com/TestPlanIt/testplanit/commit/e48544bb0d7e6ebe6d7d50768649a2e280976010))
* **zenstack:** v3 client layer (lib/zenstack.ts) + compatibility shims ([f93d760](https://github.com/TestPlanIt/testplanit/commit/f93d760eb6a35e87cada9f44ca7b30a87eea3bef))

### Bug Fixes

* **a11y:** give the profile filter selects an accessible name ([551387d](https://github.com/TestPlanIt/testplanit/commit/551387d458a20fc791757ddc693358177c0ef105))
* **a11y:** name the My Comments scope filter, and correct a stale shell assertion ([75b079d](https://github.com/TestPlanIt/testplanit/commit/75b079d8a2d45b53ab5954107ae5b092c32f3ccc))
* **a11y:** resolve the serious/critical findings blocking the accessible-theme gate ([#570](https://github.com/TestPlanIt/testplanit/issues/570)) ([d592077](https://github.com/TestPlanIt/testplanit/commit/d592077e1c1a9f0de91b2d0a2bb7563cc65e2b6b))
* **acl:** grant project default-access users write parity with reads ([6b1fbce](https://github.com/TestPlanIt/testplanit/commit/6b1fbce09a9392e06bd683d4940cd52c99c09e0a))
* **admin/llm:** surface real provider error on AI model Test Connection ([#506](https://github.com/TestPlanIt/testplanit/issues/506)) ([b7b177b](https://github.com/TestPlanIt/testplanit/commit/b7b177b1b0ed9ef6ee98f56b48ef9d0dd3f701da))
* **admin/llm:** surface real Test Connection errors for all providers ([#508](https://github.com/TestPlanIt/testplanit/issues/508)) ([496454d](https://github.com/TestPlanIt/testplanit/commit/496454d6779cda03c72ced4bec88b21eac0fe7dc)), closes [#506](https://github.com/TestPlanIt/testplanit/issues/506)
* **admin:** accept a blank API Base URL when adding a code repository ([08f6354](https://github.com/TestPlanIt/testplanit/commit/08f6354468b7b753e89f02e85c5f3ba3f293339c))
* **admin:** enforce single default per catalog atomically via DB triggers ([ec65f62](https://github.com/TestPlanIt/testplanit/commit/ec65f622e0cdbf23bf15e54b26f2f97d1fd7720c))
* **admin:** keep a configuration category expanded across refetches ([d817933](https://github.com/TestPlanIt/testplanit/commit/d817933f0628a09af860ad93ccce1eb0ac77a80b))
* **admin:** list every registered queue on the admin Queues page ([08f926d](https://github.com/TestPlanIt/testplanit/commit/08f926dc5b86da3a9f1cb7aed9656167e3936012))
* **admin:** remove w-fit wrappers that kept pinned table columns from sticking ([5a14ff7](https://github.com/TestPlanIt/testplanit/commit/5a14ff741cd0bf6fc79d629b7d41552594152f8c))
* **admin:** use a Switch instead of a two-option Select for boolean toggles ([3c39734](https://github.com/TestPlanIt/testplanit/commit/3c397349f4d46772ddd687e339108f59d1886623))
* **api-docs:** regenerate the OpenAPI spec from the v3 schema and stop docs drift ([cda6b8b](https://github.com/TestPlanIt/testplanit/commit/cda6b8baa30120cd0b66b5b3af8e2a6a57cb84e5))
* **api:** let API tokens record case versions, and have the MCP do it ([b27a6cc](https://github.com/TestPlanIt/testplanit/commit/b27a6ccbcaf2d595e17e692af65bfaef43293aa8))
* **api:** require authentication for the forecast update route ([02a5b55](https://github.com/TestPlanIt/testplanit/commit/02a5b551b438726329d200d8aa75114e8a4c6980))
* **api:** stop losing results when parallel workers race to create the same folder ([efed770](https://github.com/TestPlanIt/testplanit/commit/efed770f839d7aa0fc02660ffb5add0741272a83))
* **attachments:** full-height PDF previews and carousel keyboard nav ([e97f5bb](https://github.com/TestPlanIt/testplanit/commit/e97f5bb788c5780455447db5d216e68b2d7a38c0))
* **attachments:** keep the download action visible with long descriptions ([8050534](https://github.com/TestPlanIt/testplanit/commit/805053431d3a2c51ae7e53fccda60e551b4bdd59))
* **audit-logs:** flatten Json diff columns instead of showing [object Object] ([b1ca349](https://github.com/TestPlanIt/testplanit/commit/b1ca349ba75f11ec1d48b187654886a434ba9970))
* **audit-logs:** increase PAGE_SIZE to 1000 for improved scrolling performance across audit log components ([78e0d15](https://github.com/TestPlanIt/testplanit/commit/78e0d1539e3d87db878a38ab6f74e1e5309aca7b))
* **audit:** attribute admin-config edits to the acting user ([a4ead05](https://github.com/TestPlanIt/testplanit/commit/a4ead05a8f8ffc3477ca65271ac057310774a272))
* **audit:** attribute API-token audit rows with the actor's name and email ([5254154](https://github.com/TestPlanIt/testplanit/commit/525415413540121adde9da89c11ef15f660f6241))
* **audit:** attribute child-table and API-token writes to the acting user ([b65a2fc](https://github.com/TestPlanIt/testplanit/commit/b65a2fcbf1ce47a256d6f7915d6e48877be71b0c))
* **audit:** attribute milestone/project/comment edits to the acting user ([0374318](https://github.com/TestPlanIt/testplanit/commit/0374318584807be630174b88a86d72ac94f5dbd7))
* **audit:** isolate poison groups in the CDC writer and report real progress ([22876c0](https://github.com/TestPlanIt/testplanit/commit/22876c068317698d187e24f4baa949220b1c57be))
* **audit:** stop FK-poison re-poll loop in CDC audit-log writer ([#504](https://github.com/TestPlanIt/testplanit/issues/504)) ([481e1e4](https://github.com/TestPlanIt/testplanit/commit/481e1e40ebe11a726036f71ca052b29eece9d806)), closes [#503](https://github.com/TestPlanIt/testplanit/issues/503)
* **audit:** survive cross-version boots in the trigger applier ([32f6386](https://github.com/TestPlanIt/testplanit/commit/32f6386b59d2bac66284f05cb3c72141445f25fa))
* **auth:** match user email addresses case-insensitively ([1a35348](https://github.com/TestPlanIt/testplanit/commit/1a35348f2fe23fff1258251dd7cb742a555abb21))
* **auth:** share the auth rate limiters across instances via Valkey ([87e63f5](https://github.com/TestPlanIt/testplanit/commit/87e63f518b4d5ab5cd9fc26916a7b0c238a93d3b))
* **auth:** stop blocking Jira/OAuth callbacks and stale isApi grants ([#567](https://github.com/TestPlanIt/testplanit/issues/567)) ([521e2cd](https://github.com/TestPlanIt/testplanit/commit/521e2cd293c15f98b45aa8156a0cfe58c80552e1))
* **automation-trends:** count automation from version snapshots that actually exist ([7ab7a1d](https://github.com/TestPlanIt/testplanit/commit/7ab7a1d3bf7576f532c0a186b9901c2273b876ab))
* **card:** adjust shadow classes for improved styling consistency ([cddd9ae](https://github.com/TestPlanIt/testplanit/commit/cddd9aeb79fc2938b04e24bc2a6e4e0853f78a65))
* **case-versions:** snapshot the case's attachments instead of hardcoding [] ([98bbc6d](https://github.com/TestPlanIt/testplanit/commit/98bbc6db76a90028765b685ee55e0f7b3f3883d7))
* **cases:** create cases whose pasted steps carry non-finite numbers ([02e16c8](https://github.com/TestPlanIt/testplanit/commit/02e16c872d4dc21307692c51a89584359fb29540)), closes [#630](https://github.com/TestPlanIt/testplanit/issues/630)
* **cases:** integrate AssignTestCaseModal and enhance delete case handling ([236533a](https://github.com/TestPlanIt/testplanit/commit/236533a70b1d8c32913ec6459b5b5e97994d904b))
* **cases:** keep requirement links in case version history ([41357ab](https://github.com/TestPlanIt/testplanit/commit/41357abb64ca4a4e2ea9bf7209f38ec2be22d908))
* **cases:** one definition of a case's latest result, and one case-name component ([d5d5c2c](https://github.com/TestPlanIt/testplanit/commit/d5d5c2c53287686e8115bbe8cf9a6d2509e9ab70))
* **cases:** whitelist sortable columns so remembered sorts cannot empty the table ([37f188f](https://github.com/TestPlanIt/testplanit/commit/37f188f5901444e62174cb4bb04fe207978c9d46))
* **ci:** pre-translate with the AI method instead of the MT engine ([edd0c74](https://github.com/TestPlanIt/testplanit/commit/edd0c74ce6bd376367af6a3299f26d83f6556f72))
* **ci:** upload translations before sources so en-US edits reach every locale ([1210a41](https://github.com/TestPlanIt/testplanit/commit/1210a419a25c7f9d82e446b6950ba8777292aa9f))
* **columns:** adjust column sizes for better layout and responsiveness ([60e2241](https://github.com/TestPlanIt/testplanit/commit/60e22410ea3548c26ea4fb96056b86434627112c))
* **columns:** simplify header rendering for user name column ([05585f2](https://github.com/TestPlanIt/testplanit/commit/05585f23fa7681b1a49c12a9bdcf692ce81ab471))
* **combobox:** keep the loading spinner inside the async dropdowns ([9055ea2](https://github.com/TestPlanIt/testplanit/commit/9055ea2b82b28cdcb5f1d292f048f4cba37f0dc6))
* **combobox:** stop the option fetch looping and keep the panel on screen ([089ef7c](https://github.com/TestPlanIt/testplanit/commit/089ef7caf5f464a8fb84c7dfe4a587a9f2c12144))
* **comments:** add mention extension support to comment editor and corresponding tests ([bc55833](https://github.com/TestPlanIt/testplanit/commit/bc558336f4283610580259ca41ad483eced56691))
* **copy-move:** create distinct cases instead of resurrecting tombstones ([ace2476](https://github.com/TestPlanIt/testplanit/commit/ace24763f7200607544e02230414d3ea2c4a3b0c))
* **DataTable:** remove background tint and bold from sorted column headers ([6da1f40](https://github.com/TestPlanIt/testplanit/commit/6da1f40c5fd7e5b5a820aa68b9dbe13950f030e1))
* **DataTable:** remove background tint and bold from sorted column headers ([7283632](https://github.com/TestPlanIt/testplanit/commit/7283632d7f12bf101ed57ae86660f8ff7b8bdb7a))
* **db:** make the PendingAuth migration idempotent for databases upgraded from 0.x ([877e489](https://github.com/TestPlanIt/testplanit/commit/877e4892f873757db0bc39fa46d6a108cf166849)), closes [#497](https://github.com/TestPlanIt/testplanit/issues/497)
* **db:** sort user-facing names case-insensitively on musl-based Postgres ([d4c6529](https://github.com/TestPlanIt/testplanit/commit/d4c6529e2a3afc491dcf2d6b231dd344c8d3637b))
* **deploy:** stop worker bundles starting extra workers and unstick migrate deploy on fresh databases ([#627](https://github.com/TestPlanIt/testplanit/issues/627)) ([fb04289](https://github.com/TestPlanIt/testplanit/commit/fb0428944b5d4f103fe17fae9b239029bf768d01))
* **deps:** regenerate pnpm-lock.yaml with pinned pnpm@11.5.0 ([0d6ce42](https://github.com/TestPlanIt/testplanit/commit/0d6ce42687d37d5c9d6feb01c41d07a7d6d400e6))
* **deps:** update @radix-ui/react-direction to version 1.1.4 ([9d1e316](https://github.com/TestPlanIt/testplanit/commit/9d1e316a214a66192e187f8bfad1ab8a7856dcd4))
* **digests:** exclude notifications the user already read ([be325e9](https://github.com/TestPlanIt/testplanit/commit/be325e9c162c89da578de3bbf1e374464041783d))
* **docker:** cap the nginx container log ([488e285](https://github.com/TestPlanIt/testplanit/commit/488e28526e0983f11aed81fb9b39138a167d1259))
* **docker:** generate the v3 client to the zenstack output dir in the image ([21d3228](https://github.com/TestPlanIt/testplanit/commit/21d3228ca1452180e6416932b0c53ca928e7344a))
* **docker:** move Postgres to a named volume and bump to Postgres 18 ([#487](https://github.com/TestPlanIt/testplanit/issues/487)) ([2bcd256](https://github.com/TestPlanIt/testplanit/commit/2bcd2563f4ca7665eefa361f3083ff8fc0bf6608)), closes [#486](https://github.com/TestPlanIt/testplanit/issues/486) [docker-library/postgres#1259](https://github.com/docker-library/postgres/issues/1259) [docker-library/postgres#1400](https://github.com/docker-library/postgres/issues/1400)
* **docker:** nginx healthcheck uses 127.0.0.1 to avoid false IPv6 unhealthy ([31cf2c9](https://github.com/TestPlanIt/testplanit/commit/31cf2c9974253089bdb8cbd9a8d521b82855e250))
* **docker:** wire SELF_HOSTED into prod build args so self-host images load ([#517](https://github.com/TestPlanIt/testplanit/issues/517)) ([233ba7c](https://github.com/TestPlanIt/testplanit/commit/233ba7c31d849a64c67fd8ed21e1250bf1c60f09))
* **docs:** patch docusaurus-og for the Docusaurus 3.10 blog content shape ([1acad25](https://github.com/TestPlanIt/testplanit/commit/1acad25a0c5d0042b9448f4a56231e7190435a30))
* **dropdown-menu:** default menus to non-modal so they open on scrolling pages ([0034a3e](https://github.com/TestPlanIt/testplanit/commit/0034a3e46268c26f17598901dee2912840c9d4f0))
* **DropZoneOverlay:** adjust position of label for better visibility ([da9f1f0](https://github.com/TestPlanIt/testplanit/commit/da9f1f04453145d3766b1339215d49d1dc75e0b4))
* **e2e:** adapt specs to the collapsed action bars and stabilize flaky flows ([6d26b3e](https://github.com/TestPlanIt/testplanit/commit/6d26b3e293a546eaddb3ed0308e885adaeb0bb0c))
* **e2e:** import the markdown cases into the folder the tests assert on ([ea69f80](https://github.com/TestPlanIt/testplanit/commit/ea69f80c019deacfb1e98195b8b3d96e33850a8f))
* **e2e:** migrate the remaining toolbar call sites to the kebab-aware helper ([32e1c5e](https://github.com/TestPlanIt/testplanit/commit/32e1c5eea46eb5ec14507e0d0d65233b7d918bf1))
* **e2e:** repair the beta E2E baseline — 75 failures, incl. 2 app bugs ([#539](https://github.com/TestPlanIt/testplanit/issues/539)) ([fa67251](https://github.com/TestPlanIt/testplanit/commit/fa67251c88fd8b3cf18ae9c8bba44738c5f97e80))
* **e2e:** stop three specs asserting against stale UI assumptions ([b3d492b](https://github.com/TestPlanIt/testplanit/commit/b3d492b152d9cbab4ac67dca1f776f3699581879))
* **editor:** keep block drags from a page-level react-dnd backend ([375d51d](https://github.com/TestPlanIt/testplanit/commit/375d51df09e0d97332dc97ec859597cd9ea0e370))
* **editor:** size long-text fields to content and honor initialHeight ([ad15477](https://github.com/TestPlanIt/testplanit/commit/ad15477fa374af769d2d96efd6e7dfe004efb843))
* **email:** build the mail transport against the current nodemailer types ([a528e9f](https://github.com/TestPlanIt/testplanit/commit/a528e9f11993f5ff1276eed86e3548bf349473bb))
* **email:** build the mail transport against the current nodemailer types ([3c90180](https://github.com/TestPlanIt/testplanit/commit/3c901803278c39e90a1b74d23788b3b0d19d45c9))
* enhance OAuth integration flow and user experience ([55d79d0](https://github.com/TestPlanIt/testplanit/commit/55d79d02813c0d168f1ab4b26e13c7c12540b5b6))
* **fields:** exclude disabled rows from pickers that offer new values ([3bd074c](https://github.com/TestPlanIt/testplanit/commit/3bd074cf5114b6b6f498f59dfe1afa11717629c9))
* **fields:** guard server-side fallback picks against disabled rows ([9f97e14](https://github.com/TestPlanIt/testplanit/commit/9f97e1498754f06f19eb7c11bd34b5f5f24c850c))
* filter out disabled fields in bulk edit and test case details views ([2ce4bc2](https://github.com/TestPlanIt/testplanit/commit/2ce4bc2a83678c76820dfa058a0c218512f83d30))
* **folders:** keep the folder search dropdown inside the window and mark matches ([972db83](https://github.com/TestPlanIt/testplanit/commit/972db834c4a02db3b8ab6e582aa07889f83ac4a4))
* **forecast:** ignore soft-deleted test cases in forecast calculations ([550de0b](https://github.com/TestPlanIt/testplanit/commit/550de0bdc6a439fd8cae59bfa7ddc30bc7e1b72e))
* **generate:** keep edits made on the Review & Import step ([2749bb2](https://github.com/TestPlanIt/testplanit/commit/2749bb2f9c2fcec57ab256e25a7772e7e1472b23))
* **generate:** keep every step in the generated test case preview ([eea2835](https://github.com/TestPlanIt/testplanit/commit/eea2835679356a75ff5cd5aa45a141024322b019))
* **helm:** track the app release line in the chart version ([#615](https://github.com/TestPlanIt/testplanit/issues/615)) ([5c2689c](https://github.com/TestPlanIt/testplanit/commit/5c2689c0aef6edc9646d8d9a227199c52fd7f1d7))
* **hooks:** release load guard on fetch cancellation to prevent pagination deadlock ([6c6875c](https://github.com/TestPlanIt/testplanit/commit/6c6875c29b141661b6daa623c99ec28a4329a2a7))
* **i18n:** format numbers with the app locale instead of the browser's ([c08274c](https://github.com/TestPlanIt/testplanit/commit/c08274ccfb08e6accc9215f28d4d1fac48d5d312))
* **i18n:** restore ICU count placeholders dropped by machine translation ([7bdb2e6](https://github.com/TestPlanIt/testplanit/commit/7bdb2e6f9a378589e2b3eba1e4e02d1ede15f8e4))
* **i18n:** say "both" instead of "all 2" in count messages ([7227eab](https://github.com/TestPlanIt/testplanit/commit/7227eabe6b15072165f0fd2b39cde65a2dba66ba))
* **i18n:** stop tsc union blowup from the message-key type + add key backstop ([b3f4e8b](https://github.com/TestPlanIt/testplanit/commit/b3f4e8b8dc55e92d6fc8d29eb80a375c163c595f))
* **icons:** use the name lucide still recognises for the trash icon ([6e8ad70](https://github.com/TestPlanIt/testplanit/commit/6e8ad7013ed608cdb9bc22aa1632fe96a11e4ec9))
* **icons:** use the name lucide still recognises for the trash icon ([7990621](https://github.com/TestPlanIt/testplanit/commit/7990621f293a9c6b0f28b94ac5dd7ed9e9740986))
* **import:** allocate a free version when a CSV overwrites a case ([9ebeeee](https://github.com/TestPlanIt/testplanit/commit/9ebeeeec7d7e091c0c496bbc567d5f2cf9480695))
* **import:** enhance validation for required fields in CSV import ([81fd0c8](https://github.com/TestPlanIt/testplanit/commit/81fd0c8d92973c7d3baf708ea07f3a3f9af0a556))
* **import:** import a JSON steps cell as one step with its Expected Result ([e3474e7](https://github.com/TestPlanIt/testplanit/commit/e3474e74b32df7138d048e514d0f29179e5bdd25))
* **import:** import steps that have no expected result ([a6091db](https://github.com/TestPlanIt/testplanit/commit/a6091db41764ccd0d4807f9fc17ca5a9826e8890))
* **import:** show every step a CSV import will create in the preview ([6aaa45b](https://github.com/TestPlanIt/testplanit/commit/6aaa45b6e84aca71d6e0f8dabf45a3a4e24c57d5))
* **imports:** resolve created field types by name, not source typeId ([#476](https://github.com/TestPlanIt/testplanit/issues/476)) ([9c0bc90](https://github.com/TestPlanIt/testplanit/commit/9c0bc907c12294db92fb81880fc68b42f372c463))
* **imports:** stop Testmo import writing the Jira key into externalId ([e7644f9](https://github.com/TestPlanIt/testplanit/commit/e7644f9343a58c5eeba666b2f57269c8d61a672a))
* **imports:** strip ephemeral object-hash from automated test names ([a062e90](https://github.com/TestPlanIt/testplanit/commit/a062e90256ebb5c6180b85c812e21ed4c69b91d2))
* **import:** stop imports fabricating steps and erasing step history ([41f67f3](https://github.com/TestPlanIt/testplanit/commit/41f67f36fe6560dd212617c82bdbf2e62f6920c6))
* **imports:** use stream-json v3 lowercase assembler.js path ([5bd431b](https://github.com/TestPlanIt/testplanit/commit/5bd431be9e484918d5c3029ff9f0e9d8f4b00351))
* **integrations:** always show credential fields as editable in edit mode ([f15d682](https://github.com/TestPlanIt/testplanit/commit/f15d68203db2aa09f07d8ed3064bf664e0c77d29))
* **integrations:** carry the issue type through the Azure DevOps and GitLab mappers ([48aa5cc](https://github.com/TestPlanIt/testplanit/commit/48aa5ccb5c3ad515550380cd3b61c865d2c16573))
* **integrations:** carry the saved requirement types into the import dialog ([e5a03b6](https://github.com/TestPlanIt/testplanit/commit/e5a03b6e383202b92e3100ab95c69df853b3ab17))
* **integrations:** choose the import path from the recency window alone ([a44d3ba](https://github.com/TestPlanIt/testplanit/commit/a44d3baa9cb206205b9f3f9ef87b6f39cf7d9df6))
* **integrations:** encrypt credentials on every write path ([0450af4](https://github.com/TestPlanIt/testplanit/commit/0450af4470e76d18f1540983ffbd3ef914e397a0))
* **integrations:** escape literal braces that broke the MDX build ([58f6996](https://github.com/TestPlanIt/testplanit/commit/58f6996cc93fbd015f0d2dfee847629e0e3c0df5))
* **integrations:** index synced milestones to Elasticsearch on write ([2de7b15](https://github.com/TestPlanIt/testplanit/commit/2de7b1540952ee972c97433df7ff0607368a775c))
* **integrations:** invalidate cached adapter when credentials change ([4603151](https://github.com/TestPlanIt/testplanit/commit/4603151533bbbe5e8f36b0f1a0af74ca0fa82b8d))
* **integrations:** label the confirm step's dismissal Back, since it returns to the options ([e2975c4](https://github.com/TestPlanIt/testplanit/commit/e2975c47145d193cedc70ba675eee68935416f92))
* **integrations:** label the count step Next, since it does not import ([c005509](https://github.com/TestPlanIt/testplanit/commit/c0055095e7fe9131def5e3aa5934028a833b434b))
* **integrations:** make cancelling an import an atomic transition ([92a2b77](https://github.com/TestPlanIt/testplanit/commit/92a2b774aeae480c21173bfd896b2538624b3dbb))
* **integrations:** page Azure DevOps imports past the first window ([a0bcf61](https://github.com/TestPlanIt/testplanit/commit/a0bcf61aee4749a1654475d1c197f7df2cb58477))
* **integrations:** page each GitLab issue type independently during import ([542e96e](https://github.com/TestPlanIt/testplanit/commit/542e96ea5787e25ed625f840cc6828f97acc305b))
* **integrations:** report MantisBT pagination state from the tracker page ([cb0d8db](https://github.com/TestPlanIt/testplanit/commit/cb0d8dbd7297ce9716944015d7761be96c1cde17)), closes [#id](https://github.com/TestPlanIt/testplanit/issues/id)
* **integrations:** satisfy exhaustive-deps on the merged dialog's issue-type fetcher ([0c10993](https://github.com/TestPlanIt/testplanit/commit/0c10993cd9e29d794ef870f42d79f338653a4b04))
* **integrations:** state the import's issue types instead of offering a choice the server ignores ([e631a3f](https://github.com/TestPlanIt/testplanit/commit/e631a3ff66588e136feaf5385526be6151e7f7c1))
* **integrations:** stop a contended sync lock swallowing release events ([82bb035](https://github.com/TestPlanIt/testplanit/commit/82bb0354893342c33670874a83ae50b45f42ff7e))
* **integrations:** stop using unreadable credentials and return actionable errors ([#581](https://github.com/TestPlanIt/testplanit/issues/581)) ([30fd83c](https://github.com/TestPlanIt/testplanit/commit/30fd83ce8a556779f5c3ba535d6826e5ceb3de8a))
* **integrations:** tenant-scope adapter cache + cross-process invalidation ([27e45a0](https://github.com/TestPlanIt/testplanit/commit/27e45a07e7226f751e24904fac008f98f24f626e))
* **integrations:** test edited/new integration config instead of stale state ([#479](https://github.com/TestPlanIt/testplanit/issues/479)) ([d0d1e16](https://github.com/TestPlanIt/testplanit/commit/d0d1e164916552077c1bcb2405a37fd5347d8491))
* **integrations:** use cleartext stored secrets instead of refusing them ([97efc25](https://github.com/TestPlanIt/testplanit/commit/97efc25c5425107d117b29d1cbba2f436707184c))
* **integrations:** use useWatch + explicit setValue to fix edit modal ([f2b5827](https://github.com/TestPlanIt/testplanit/commit/f2b5827ac1b305982cf79cabe8dfb66a48b82298))
* **IssuesCard:** refactor issue fetching and update header logic for distinct issue count ([4bda64d](https://github.com/TestPlanIt/testplanit/commit/4bda64dd055af95a63d6345f06cf21bf090c0d97))
* **issues:** close the remaining raw-write bypasses on locked requirements ([ab24d12](https://github.com/TestPlanIt/testplanit/commit/ab24d121252981ad804c046e0ef121c50399f5c9))
* **issues:** hide the internal-picks toggle for dead-end SearchIssuesDialog consumers ([e358e51](https://github.com/TestPlanIt/testplanit/commit/e358e51c8391c44506ae1a7aeef924e6ff781b74))
* **issues:** multiplex issue-update SSE and speed up the cross-project list ([#489](https://github.com/TestPlanIt/testplanit/issues/489)) ([9bdb4ca](https://github.com/TestPlanIt/testplanit/commit/9bdb4ca2e6db6dcc4f363a6444859c63a557eeef))
* **issues:** only link http(s) tracker URLs ([0ba0367](https://github.com/TestPlanIt/testplanit/commit/0ba0367e7040f344c5f92d0321b312418daad847))
* **issues:** open tracker URLs with noopener,noreferrer in both search dialogs ([560f9b1](https://github.com/TestPlanIt/testplanit/commit/560f9b15d69057dda1b32f604da64abe07fe84cb))
* **issues:** route DeferredIssueManager link-success toasts through the translator ([8745423](https://github.com/TestPlanIt/testplanit/commit/8745423a252d56f3a42f959ecd17875396328911))
* **issues:** route jira-link-service upserts through the reviewed shell ([a6224ae](https://github.com/TestPlanIt/testplanit/commit/a6224ae73c0cc7db9f76625b7b636089095745f5))
* **issues:** use caseIssues join relation for v3 issue lists ([#483](https://github.com/TestPlanIt/testplanit/issues/483)) ([5f2730c](https://github.com/TestPlanIt/testplanit/commit/5f2730ce37805a61276d0bdd6d8d9f344b4148d2)), closes [#482](https://github.com/TestPlanIt/testplanit/issues/482)
* **jira:** Jira Server / Data Center support (REST v2, PAT/Basic auth, wiki markup) ([#510](https://github.com/TestPlanIt/testplanit/issues/510)) ([25f85da](https://github.com/TestPlanIt/testplanit/commit/25f85da46d8ff07d9b520ba145cf72a2346f3035))
* **jira:** request granular Jira Software scopes for agile milestone import ([0543830](https://github.com/TestPlanIt/testplanit/commit/05438305f8955ca8763ddd0bc53dd89b412d5c34))
* **jira:** resolve the version-event project from version.projectId ([f519840](https://github.com/TestPlanIt/testplanit/commit/f519840a6984d120c21654739fbebc111e1f2e89))
* **jira:** use canonical site host for OAuth issue browse links ([e87e94f](https://github.com/TestPlanIt/testplanit/commit/e87e94fb4edb38d0709413bc23f471e760e195be))
* **junit:** clarify deep-linking behavior and update selected row handling for automated runs ([4774c3c](https://github.com/TestPlanIt/testplanit/commit/4774c3c9678bf822b9f1d20d97127589694cd382))
* **layout:** add flow-root class to body for proper margin handling ([81a7752](https://github.com/TestPlanIt/testplanit/commit/81a77523392b8ba3edc1a21e0fd69caf004da04e))
* **lint:** clear tsc --noEmit type errors (v3 test-type migration debt) ([a48f43d](https://github.com/TestPlanIt/testplanit/commit/a48f43dc1523752cabe745899bf4d0df6bd47631))
* **lint:** remove unused imports/vars flagged by eslint ([8f5acce](https://github.com/TestPlanIt/testplanit/commit/8f5acceab8bc5f4e770d023d53b78cc1e4444383))
* **lint:** rename the useState-initializer scanner off the use* prefix ([b23a60e](https://github.com/TestPlanIt/testplanit/commit/b23a60ea44540ed14231ba86ac576acde91a72e6))
* **live:** ignore the SSE sync checkpoint so reconnects don't storm-refetch ([2d17757](https://github.com/TestPlanIt/testplanit/commit/2d17757d458f18720b2549a7a3f9d6fc0ef12ebe))
* **live:** stop SSE issue invalidation from livelocking slow queries ([#519](https://github.com/TestPlanIt/testplanit/issues/519)) ([c357164](https://github.com/TestPlanIt/testplanit/commit/c3571648b35099acbe077f0fe8fae63ceba52d8f))
* **llm:** read text blocks from thinking-first Anthropic responses ([45d7012](https://github.com/TestPlanIt/testplanit/commit/45d701219d256e2944caa15b07444839c865bb25))
* **llm:** record usage with v3 relation connects + numeric costs ([de8e07c](https://github.com/TestPlanIt/testplanit/commit/de8e07c7eb4ddaa898528326ee993c31a886a08d))
* **llm:** size QuickScript repo-context from the model context window ([b9f6f2c](https://github.com/TestPlanIt/testplanit/commit/b9f6f2c5ef5919de6207dc9501355f1b2635c25c))
* **markdown:** stop duplicating bold text in imported paragraphs ([50491bc](https://github.com/TestPlanIt/testplanit/commit/50491bc022c2c7737b068bf826e6d8468de57501)), closes [#595](https://github.com/TestPlanIt/testplanit/issues/595)
* **matrix:** exclude removed run-cases from aggregation and cell counts ([3f26214](https://github.com/TestPlanIt/testplanit/commit/3f26214a5db125ba06f99939bcd8cc31cf511b39))
* **mcp-server:** exclude requirement rows from testplanit_issues_list by default ([da37b1c](https://github.com/TestPlanIt/testplanit/commit/da37b1cb9ec8b62fa921d044a5a4d4498e58aeb1))
* **mcp-server:** fall back run-case status to the latest result's status ([8036bad](https://github.com/TestPlanIt/testplanit/commit/8036badaab9c73ecf40be9f7c658e165f3432681))
* **mcp-server:** roll up automated run status from JUnit results ([1a84ec3](https://github.com/TestPlanIt/testplanit/commit/1a84ec37ea39bf4bbef23fb1ae1e624e86923e2e))
* **mcp-server:** say why a version snapshot failed against an older host ([62f7a68](https://github.com/TestPlanIt/testplanit/commit/62f7a68c6bc7242149694a25c11ace8d66c4d327))
* **mcp:** return plain text for rich text whichever client saved it ([2d5c325](https://github.com/TestPlanIt/testplanit/commit/2d5c325465ee9411225085020e3c1ce03c0475d0)), closes [#594](https://github.com/TestPlanIt/testplanit/issues/594)
* **milestones:** auto-track baselines existing artifacts instead of backfilling them ([6df2bac](https://github.com/TestPlanIt/testplanit/commit/6df2bac2cf77c5e73aac3a6aa395495d9aca946b))
* **milestones:** count removed and automated run-cases correctly ([#589](https://github.com/TestPlanIt/testplanit/issues/589)) ([638635a](https://github.com/TestPlanIt/testplanit/commit/638635a51e93281721862dfc508e087e5e2e159e))
* **milestones:** keep sprint dates on the instant path, not the calendar one ([d0e724f](https://github.com/TestPlanIt/testplanit/commit/d0e724fa5bfc4534369d30dd455affabd99ea9be))
* **milestones:** never coalesce a version/sprint lifecycle transition ([a9548da](https://github.com/TestPlanIt/testplanit/commit/a9548daa30b0e1c08cdb54c1f0e3f267a5749ee0))
* **milestones:** only coalesce webhook refreshes on a real storm ([9d47327](https://github.com/TestPlanIt/testplanit/commit/9d47327fcd1e09cbf6cdb6c704ece29848367196))
* **milestones:** open the Issues accordion when a summary chip targets it ([3181dca](https://github.com/TestPlanIt/testplanit/commit/3181dcaf5d6545fab0d9ddc953529ec5ef7693c9))
* **milestones:** order child milestones like every other milestone list ([30e2740](https://github.com/TestPlanIt/testplanit/commit/30e2740bed2cd4c9071e46430c6b0e131f3e3bb3))
* **milestones:** render start/due dates as calendar dates, not instants ([fcaa737](https://github.com/TestPlanIt/testplanit/commit/fcaa737e4c745d1a1f3369583dd46656816e5998))
* **milestones:** scope scope-issue Test Cases count to the project ([7b168c9](https://github.com/TestPlanIt/testplanit/commit/7b168c98d284f54bbb7ea575ded0c6f382c20ad6))
* **milestones:** scope synced-milestone identity to the importing project ([0586c90](https://github.com/TestPlanIt/testplanit/commit/0586c907d62a48f8060c3150d33c26e86f9852a2))
* **NameCell:** improve folder chip layout and truncation handling ([3d8c199](https://github.com/TestPlanIt/testplanit/commit/3d8c199ecc3a6b713cbdd123dab36fd01d3b5315))
* **onboarding:** make the first-run preferences dialog closable ([83a9d7b](https://github.com/TestPlanIt/testplanit/commit/83a9d7bcb4b5cb60cb99337169cb331b0e2e6da4))
* **parameters:** truncate dataset cell text with an ellipsis ([b98af1f](https://github.com/TestPlanIt/testplanit/commit/b98af1fdf43774a57889fabf1f2f06aedb425dd9))
* **pdf:** normalize non-Latin-1 text so PDF exports don't garble ([6dc7093](https://github.com/TestPlanIt/testplanit/commit/6dc70936743f1213411fd96fef513e1b56f3b4d0))
* **pdf:** streamline completed date rendering in PDF export ([74b53ff](https://github.com/TestPlanIt/testplanit/commit/74b53ff1ab84064da4ede024fe9a7b3228864e22))
* **permissions:** resolve group GLOBAL_ROLE access type handling in permissions endpoint ([252a571](https://github.com/TestPlanIt/testplanit/commit/252a5710fe3a111b284640bb0d402bcf5bfda2a1))
* **permissions:** stop nav links resolving access differently than their pages ([1d5250a](https://github.com/TestPlanIt/testplanit/commit/1d5250abd925911d8a912d02b08983e56f0130f7))
* **pnpm-lock:** update package specifiers for consistency and compatibility ([083bdc5](https://github.com/TestPlanIt/testplanit/commit/083bdc5efff8d0bcfafe76f8f84607965ea9d77c))
* **ProjectDropdownMenu:** set selected project value in dropdown based on URL, not previously selected from menu ([ed188fb](https://github.com/TestPlanIt/testplanit/commit/ed188fb0be9955647fabdc10ef9038b292ac0ca2))
* **ProjectRepository:** enhance layout and styling for breadcrumb and toggle components ([2de6a7e](https://github.com/TestPlanIt/testplanit/commit/2de6a7e0575212f42c72a87a478376bff1bfcf80))
* **quickscript:** resolve the Jira panel's project from where linked cases live ([513e026](https://github.com/TestPlanIt/testplanit/commit/513e0269d304421b923c7efe908cc9304e96e8e2))
* **reindex:** count project issues via join table, not a ZenStack v3 `some` filter ([a542833](https://github.com/TestPlanIt/testplanit/commit/a542833c7bcb548daf92c937f1403f5d7c552e71))
* **release:** dispatch the self-host image build on every release ([#619](https://github.com/TestPlanIt/testplanit/issues/619)) ([dc25933](https://github.com/TestPlanIt/testplanit/commit/dc25933e4e9b864e8d1f615c3a4816b7428a643b))
* replace MoreHorizontal icon with MoreVertical in iteration components ([3cf3e38](https://github.com/TestPlanIt/testplanit/commit/3cf3e3884727c2d66a5e43413cfda3ef88a4dd0a))
* **reports:** base Automation Trends on version history, not current flag ([8dc2590](https://github.com/TestPlanIt/testplanit/commit/8dc25901ef221813f26757c8a772d90b30e7c78d))
* **reports:** exclude requirement rows from issue test-coverage report ([6396476](https://github.com/TestPlanIt/testplanit/commit/6396476c328aaa6ab51f18bf04c76612f2f6870d))
* **reports:** exclude requirement rows from issue-tracking reports ([7f9453b](https://github.com/TestPlanIt/testplanit/commit/7f9453bc2270d66050eee3a86603296ae0123271))
* **reports:** group Issue Test Coverage by issue on all run paths ([f404115](https://github.com/TestPlanIt/testplanit/commit/f404115e4b008d314710ec1b257e2cc4f04ae38d))
* **reports:** keep Cross-Project Automation Trends working at scale ([815fcf4](https://github.com/TestPlanIt/testplanit/commit/815fcf4457459bfb8e44d58418f1df098cb8f59f))
* **reports:** keep every project listed in the cross-project Projects filter ([4d753b8](https://github.com/TestPlanIt/testplanit/commit/4d753b8d416c6c572b8a1b0cf0ffedb8ae35b3f6))
* **reports:** key the milestone-readiness date filter to the plotted date ([7d7fd6c](https://github.com/TestPlanIt/testplanit/commit/7d7fd6c08ef549164c331f3942f0e078a1cb8691))
* **reports:** resolve automated run-case status in the remaining consumers ([#590](https://github.com/TestPlanIt/testplanit/issues/590)) ([cfb8b6a](https://github.com/TestPlanIt/testplanit/commit/cfb8b6a90cbefaf0845f853712e413f8921988b2)), closes [#589](https://github.com/TestPlanIt/testplanit/issues/589)
* **reports:** resolve chart metric values through the API data key ([db69d62](https://github.com/TestPlanIt/testplanit/commit/db69d62a3a903bffa5eb3ec298503660ae5f45ec))
* **reports:** scope issue drill-down and project-health widgets to defects ([93ed857](https://github.com/TestPlanIt/testplanit/commit/93ed8574d2a47a9c8f8a05b6d6e6a7ec23e092b1))
* **reports:** scope the shared-report bypass and fix the token-auth 500 in requirement coverage ([d6bae6a](https://github.com/TestPlanIt/testplanit/commit/d6bae6a9ba647628b5df237c00d89397cacf42ea))
* **reports:** sort pre-built report columns by what they display ([b347f9b](https://github.com/TestPlanIt/testplanit/commit/b347f9bb5863601e710b68c56cd28260075eabe8))
* **reports:** stop doubling native requirement names and localize Executed At ([5b77e3b](https://github.com/TestPlanIt/testplanit/commit/5b77e3bd1021d1b78b31cf1ed8b8d25ed19a40ad))
* **reports:** stop losing date filter for automated results whenever a report groups by date ([b02cdfe](https://github.com/TestPlanIt/testplanit/commit/b02cdfe330dc9b8a5342edc347bf91b95ebc129c))
* **reports:** stop snapshot auto-default from clobbering tab navigation ([34b1a99](https://github.com/TestPlanIt/testplanit/commit/34b1a998ac7362ac6676d4f2ca6f5490a5099d7d))
* **reports:** stop the Reports tab bouncing back to Report Builder ([ce3788e](https://github.com/TestPlanIt/testplanit/commit/ce3788e3feb081193c9c19842b709fef469cf88d))
* **repository:** align E2E harness + bulk-edit to the case tag/issue join shape ([89720f4](https://github.com/TestPlanIt/testplanit/commit/89720f4c200ef6cbe3ba4bda2946fc366f5a3a2e))
* **repository:** carry ZenStack null sentinels across the client boundary ([efbac21](https://github.com/TestPlanIt/testplanit/commit/efbac2183350e92c7bae61e54083b63b1796943c))
* **repository:** collapse the folder chip before the case name in narrow columns ([e1d7845](https://github.com/TestPlanIt/testplanit/commit/e1d78452ce57445e60439e3c25e37626f6fea72b))
* **repository:** count cases, not rows, in dynamic-field facets ([ee63cdd](https://github.com/TestPlanIt/testplanit/commit/ee63cdd32d6507f02ad4b27245c6ade2460ee08f))
* **repository:** details panel prev/next spans all cases under Show all descendants ([a9323d6](https://github.com/TestPlanIt/testplanit/commit/a9323d67b553601060f05e3f8c489d95ea7900f1))
* **repository:** explicit join models for case tags/issues so the list can sort by count ([403bd89](https://github.com/TestPlanIt/testplanit/commit/403bd8907f7be72061dd092e947a1fb807066733))
* **repository:** fill the folder tree to the bottom of its panel ([d840d7b](https://github.com/TestPlanIt/testplanit/commit/d840d7b31146d633472a053d90dc6db5f4306b23))
* **repository:** gate AI wizard case fields by enabled and restricted-field permission ([2c56b3a](https://github.com/TestPlanIt/testplanit/commit/2c56b3abdf7607aac993c59ed04a09bc7dbe7e12))
* **repository:** guard inline case-create until the folder query resolves ([916b149](https://github.com/TestPlanIt/testplanit/commit/916b149690cdb66f5518b801d4c3210ec8df9b79))
* **repository:** hide Generate Test Cases button when no AI model is configured ([38ee40e](https://github.com/TestPlanIt/testplanit/commit/38ee40e804215eb8963509cfccf68c0c2d8af1e7))
* **repository:** hide Generate Test Cases button when no AI model is configured ([58cddd0](https://github.com/TestPlanIt/testplanit/commit/58cddd03570876048b7412771a4b6886a9f09227))
* **repository:** hide the folder-context tip on seeded generation launches ([bd1c3bd](https://github.com/TestPlanIt/testplanit/commit/bd1c3bd9251c260775039b3650655a964caddf57))
* **repository:** keep folder drags alive when the tree re-renders ([e4770dd](https://github.com/TestPlanIt/testplanit/commit/e4770dd54ab2d2120fb0fe0cbfa05250b97f7776))
* **repository:** keep latest-results page ids coherent with their filter ([fe4061f](https://github.com/TestPlanIt/testplanit/commit/fe4061fe08a5551b3f102cffe1f62b33e555358c))
* **repository:** keep the inline add-case row focused after adding the first case ([c5fba6b](https://github.com/TestPlanIt/testplanit/commit/c5fba6be197d7d530ddfa9efd4fdc1ee9cfccecb))
* **repository:** keep the selected folder when applying a saved view ([c02219c](https://github.com/TestPlanIt/testplanit/commit/c02219c3f640e405034b937f3723b9a230a93d8a))
* **repository:** record complete version snapshots for every writer ([274ffcf](https://github.com/TestPlanIt/testplanit/commit/274ffcf13f203bff46a6b7346426c25749702d5e))
* **repository:** restore step visibility for read-only and group-role users ([20295eb](https://github.com/TestPlanIt/testplanit/commit/20295ebd231896859b0bff5b74d13d6f7b7c67e5))
* **repository:** same-project case moves are pure relocations ([6d1ca45](https://github.com/TestPlanIt/testplanit/commit/6d1ca45339f7cd764b7d2808f020a15b50f7b370))
* **repository:** scale folder delete and copy/move to deep trees ([0404d74](https://github.com/TestPlanIt/testplanit/commit/0404d746186e9c06b9b48f4ac90bd5b72fcd6562))
* **repository:** scope Shift+click select-all to the current view ([8b08644](https://github.com/TestPlanIt/testplanit/commit/8b0864449d8a7635595269d2aed8c128be22b1b7))
* **repository:** sort by latest result under "show all descendants" ([7c29263](https://github.com/TestPlanIt/testplanit/commit/7c292634586101a48c3cdcf84e0962e800ceffba))
* **repository:** sort the Steps column on live steps only ([6d67bce](https://github.com/TestPlanIt/testplanit/commit/6d67bceda08a91e12e0929eb32a575d8a9f3704f))
* **repository:** stop same-project case moves self-colliding on unique index ([26d6a18](https://github.com/TestPlanIt/testplanit/commit/26d6a1825be94addc926fa00948c727b7b873b9a))
* **repository:** stop the template picker clearing itself in edit mode ([3bc9f92](https://github.com/TestPlanIt/testplanit/commit/3bc9f928c7dbd0a423426a598307784e26d8bcb2))
* **repository:** tell the reader when a case version was not recorded ([78e1017](https://github.com/TestPlanIt/testplanit/commit/78e10173b8062dabcf4da456f8527bfe59cb303a))
* **repository:** truncate long attachment names in the details view ([45352fa](https://github.com/TestPlanIt/testplanit/commit/45352fafd5048f8f0cfd6534f83be2e1a764c362))
* **repository:** truncate long folder names in the tree panel ([#502](https://github.com/TestPlanIt/testplanit/issues/502)) ([6596563](https://github.com/TestPlanIt/testplanit/commit/6596563846f8cc21a51dcff69c74bcfc8063973c))
* **requirements:** 403 a policy-filtered reference delete instead of a false-success toast ([2f2b0bd](https://github.com/TestPlanIt/testplanit/commit/2f2b0bd3ff47e18fce2f4c6387ef79248d535617))
* **requirements:** add hysteresis to badge collapse decisions to stop update-depth loop ([ce437a8](https://github.com/TestPlanIt/testplanit/commit/ce437a88ebe9da80842e00a63fd51d5922b1e22e))
* **requirements:** align the references POST pre-gate with the join-create policy it fronts ([d8fb2fb](https://github.com/TestPlanIt/testplanit/commit/d8fb2fb1c7f24f95c57944cf90b1964eebb82e49))
* **requirements:** ask the tracker for a real import count instead of a page size ([be52f41](https://github.com/TestPlanIt/testplanit/commit/be52f41440aeb337aeb4a3f46ab9b33cd7519170))
* **requirements:** authorize the references write before any side effect ([df6cb0e](https://github.com/TestPlanIt/testplanit/commit/df6cb0e7ab26c52d1931e235e4b96f896109eaee))
* **requirements:** cap the panel height, dot the drop zones, and settle the legend ([c7bbb2e](https://github.com/TestPlanIt/testplanit/commit/c7bbb2efd59e95f563d67ca07f069f4f3aa5f31f))
* **requirements:** clarify how covering cases differ from linked cases ([aadbae4](https://github.com/TestPlanIt/testplanit/commit/aadbae4b1c07689bca3365ca248b639e8ea93642))
* **requirements:** close the twelve Info-level review findings ([4cd68ba](https://github.com/TestPlanIt/testplanit/commit/4cd68bae34f5ec525dbe37b20550ee83e74e5888))
* **requirements:** collapse the provenance badge before the name truncates ([49fabd1](https://github.com/TestPlanIt/testplanit/commit/49fabd1d9cf901e24faba51ad55e9e0676c9a11a))
* **requirements:** count a requirement's whole subtree before confirming a delete ([515db2a](https://github.com/TestPlanIt/testplanit/commit/515db2a5927796a626ba6ff5aadc0e7eb78f94c0))
* **requirements:** count the showing total against rows the list can load ([d0a471d](https://github.com/TestPlanIt/testplanit/commit/d0a471df9348b6a89409d96f2f870783afad8b4d))
* **requirements:** declare rootTotal on the tree hook's result type ([c5a90dc](https://github.com/TestPlanIt/testplanit/commit/c5a90dcd74cd406020167a0b4460e05eba4c6d32))
* **requirements:** defer drag-candidate rings a frame so dragstart survives ([cf2091f](https://github.com/TestPlanIt/testplanit/commit/cf2091f1b05ff28396a17b71d3915898e83a530e))
* **requirements:** draw the dashed drop-zone lines in a readable neutral tone ([b3afe4e](https://github.com/TestPlanIt/testplanit/commit/b3afe4e1c23af40ea8edd3d4dbb303d08eed07d4))
* **requirements:** drop the return glyph from create and outline cancel ([34b00e8](https://github.com/TestPlanIt/testplanit/commit/34b00e86dda0448fb66f51baa6cca4b05d923434))
* **requirements:** gate the case Linked Requirements panel on the project flag ([333f3b6](https://github.com/TestPlanIt/testplanit/commit/333f3b626b0973bcd34f3e2b4cba0dfb7d05b04e))
* **requirements:** gate the drag gesture on provenance lock ([50fa062](https://github.com/TestPlanIt/testplanit/commit/50fa062d0eb90f99d423b614ccf7ba62a54ea827))
* **requirements:** give the Create-requirement References trigger a neutral label ([ffaacbf](https://github.com/TestPlanIt/testplanit/commit/ffaacbf501dec2b960d93be03bf5147ccdf4c7c6))
* **requirements:** give the requirements page header its help popover and project name ([8c6b862](https://github.com/TestPlanIt/testplanit/commit/8c6b862b4919e93ef82a255ecf2f0eb0eb1bc550))
* **requirements:** give the tree one drag-drop context instead of none or two ([7a3b577](https://github.com/TestPlanIt/testplanit/commit/7a3b577a7927ddfef58c72ff0abc33d3b97d7a40))
* **requirements:** invalidate coverage caches on case-side link/unlink ([02231c2](https://github.com/TestPlanIt/testplanit/commit/02231c2a6ccaa7c4a64bf34a18745231104d5d41))
* **requirements:** invalidate coverage rollup and drill-down on mutation ([1645a90](https://github.com/TestPlanIt/testplanit/commit/1645a90f8bf3c781ff309dd9c904bba16f4a5939))
* **requirements:** keep a case's requirement links through saves and imports ([1e1ed0d](https://github.com/TestPlanIt/testplanit/commit/1e1ed0db6a7b05486464702d554ba73bbd2c3c5e))
* **requirements:** keep a detached requirement's local edits across sync polls ([8722b26](https://github.com/TestPlanIt/testplanit/commit/8722b260648efc9c5a69faf2126dd1387ca40322))
* **requirements:** keep a timestamp keyset cursor at microsecond precision ([007b45e](https://github.com/TestPlanIt/testplanit/commit/007b45e725226fea093593f9ba5a4b06068e5529))
* **requirements:** keep requirement links on projects without a tracker picker ([60697f6](https://github.com/TestPlanIt/testplanit/commit/60697f6e1d67d554912221f3457fba50a99a6591))
* **requirements:** keep RequirementDetailPanel tests green after the suspect-flag reads ([0aca7df](https://github.com/TestPlanIt/testplanit/commit/0aca7df4501430ae1f7ca9b267af3889a93b47db))
* **requirements:** keep the coverage badge readable as the tree pane narrows ([8e8dfcd](https://github.com/TestPlanIt/testplanit/commit/8e8dfcdf5fd48508421274468d244cacdc1bd695))
* **requirements:** keep the database layer out of the requirements page bundle ([97824fd](https://github.com/TestPlanIt/testplanit/commit/97824fde43087909df0f72db97e0518e08a8798d))
* **requirements:** keep the detail panel's form in step with the requirement it is showing ([8a74964](https://github.com/TestPlanIt/testplanit/commit/8a749640bcf014a3366b6a9be67cb24374c0a04b))
* **requirements:** keep the provenance badge legible on hover in dark themes ([72ca2f8](https://github.com/TestPlanIt/testplanit/commit/72ca2f8556db6171956d8606bff9fee4637a02a8))
* **requirements:** label rows with the issue title, not just the tracker key ([9ac6e22](https://github.com/TestPlanIt/testplanit/commit/9ac6e22f2353219e00b59d8a1e0a2403c5993973))
* **requirements:** let a requirement be dragged to a new parent on a lazily loaded list ([509ffac](https://github.com/TestPlanIt/testplanit/commit/509ffac71335b4bb525d05e81fd0bbc333050d5d))
* **requirements:** let the details panel rename a requirement in edit mode ([abe798c](https://github.com/TestPlanIt/testplanit/commit/abe798cf43cf73221750d06d8deb533061a76362))
* **requirements:** make requirement attachments view-only outside edit mode ([9c6f2ad](https://github.com/TestPlanIt/testplanit/commit/9c6f2adf1b5623cafb95ac35b68d5ecca7f98c11))
* **requirements:** map a policy denial on the reference POST to 403 ([72aef93](https://github.com/TestPlanIt/testplanit/commit/72aef93b296b20bb78934d7e25929d21eaba28e3))
* **requirements:** match the list filter against title as well as name ([7cd6a04](https://github.com/TestPlanIt/testplanit/commit/7cd6a04ffb234d85862f27eca4adcac0bcf8335d))
* **requirements:** match the shared page header and add-button shapes ([2c52425](https://github.com/TestPlanIt/testplanit/commit/2c5242531c67fe448cbd36d2f7ae6bf033000c7d))
* **requirements:** offer real filter options on a lazily loaded list ([4a57c77](https://github.com/TestPlanIt/testplanit/commit/4a57c775eb7f629bdb0250da56144745c0d6efca))
* **requirements:** omit an unchanged note from the detail panel save payload ([9685800](https://github.com/TestPlanIt/testplanit/commit/96858003d7ef70266582bc529e695500fa87a6e5))
* **requirements:** pin the root drop strip inside the list viewport ([de484b2](https://github.com/TestPlanIt/testplanit/commit/de484b29c93ae3fda91819b2368116dc9a50b6de))
* **requirements:** pin traceability PDF dates to a Latin-digit locale ([d8bb894](https://github.com/TestPlanIt/testplanit/commit/d8bb894ab47a846e010556df542ccf9dcedf88c8))
* **requirements:** re-collate the requirement sort columns to und-x-icu ([098637f](https://github.com/TestPlanIt/testplanit/commit/098637f398684c6a08316021459cc83eed638429))
* **requirements:** register internal issue picks in DeferredIssueManager ([817fe50](https://github.com/TestPlanIt/testplanit/commit/817fe5002c1e864c05e97292adf87ce4c069797f))
* **requirements:** register the DELETE references route in the read-scope containment gate ([c010482](https://github.com/TestPlanIt/testplanit/commit/c010482e07701f593698edadcd5f11512cd9e96c))
* **requirements:** register the four new routes in Issue's containment gates ([6e246fe](https://github.com/TestPlanIt/testplanit/commit/6e246fe3b42c74e521e803786565179f1902c64c))
* **requirements:** reject non-http(s) externalUrl and cap free-text fields ([d2e8bd0](https://github.com/TestPlanIt/testplanit/commit/d2e8bd08cc261cfc3ec703e67722339b06168f99))
* **requirements:** rename the Native provenance label to Manual ([551e277](https://github.com/TestPlanIt/testplanit/commit/551e2777278b711fa9271bfc5e86aa05a336300d))
* **requirements:** render created at in the viewer's preferred date and time formats ([2089a03](https://github.com/TestPlanIt/testplanit/commit/2089a035c90eca5ffb2addfbf51290c1d8b71c08))
* **requirements:** render linked requirements with the requirements display convention ([5464898](https://github.com/TestPlanIt/testplanit/commit/5464898f028ee4d9bde94b7ae8132fe670c221d6))
* **requirements:** render provenance the way a synced milestone does ([41fbbc1](https://github.com/TestPlanIt/testplanit/commit/41fbbc11d282626a1cba5c69d261a1ee2afbcddf))
* **requirements:** reserve the grip slot so locked rows keep name alignment ([0d9639f](https://github.com/TestPlanIt/testplanit/commit/0d9639f579405de0bc76bc01abe771476752141c))
* **requirements:** say whether the import count is exact or a floor ([1c6e43a](https://github.com/TestPlanIt/testplanit/commit/1c6e43aff39a6daaa1f4f62d79ad26370339f618))
* **requirements:** scope staged attachment changes to the requirement they were staged on ([09d5b40](https://github.com/TestPlanIt/testplanit/commit/09d5b407517a4070330bab73f8f0e964bfe9f6b9))
* **requirements:** show a detached requirement's own status instead of its stale tracker status ([197bb3a](https://github.com/TestPlanIt/testplanit/commit/197bb3a72ddde07a10fd8dc999cb5ca3e4f57bbb))
* **requirements:** show a distinct error state for a failed covering-cases fetch ([43a2d4e](https://github.com/TestPlanIt/testplanit/commit/43a2d4e66e2b215cdf09564b19612dd54a04f3bd))
* **requirements:** show the project name on same-project linked and covering case rows ([b7ad6da](https://github.com/TestPlanIt/testplanit/commit/b7ad6da374820d6bf9384469b3424c19ee2ba36f))
* **requirements:** silence a possibly-undefined tsc error in the list view test ([5fe885b](https://github.com/TestPlanIt/testplanit/commit/5fe885bc82c34d95e36936c375ad0e2f08690fd9))
* **requirements:** sort, filter and facet the requirements list on the status it displays ([4f7b4b4](https://github.com/TestPlanIt/testplanit/commit/4f7b4b47202e45263d721e69102b57da6bfc9806))
* **requirements:** source covering-cases expansions from the drill-down endpoint ([96e6be4](https://github.com/TestPlanIt/testplanit/commit/96e6be4514bf55b50fcaeaf82aca230a5b2f6b3a))
* **requirements:** stamp suspect dismissal from the server's clock ([86b6722](https://github.com/TestPlanIt/testplanit/commit/86b6722aeb3650a43aa157a52bcdc3a36ad363ea))
* **requirements:** stop a filter keystroke unmounting the box being typed into ([0c91f74](https://github.com/TestPlanIt/testplanit/commit/0c91f74c5d86291dc52c4389e55fa73208ef9f80))
* **requirements:** stop a requirement subtree being destroyed by unrelated actions ([0ee328a](https://github.com/TestPlanIt/testplanit/commit/0ee328a61e35a41b3c55eb8a41597bb639270c0c))
* **requirements:** stop repeating the requirement name in the detail panel's Title field ([311f8bd](https://github.com/TestPlanIt/testplanit/commit/311f8bd012db74b4837bad909d37f959e1e1052a))
* **requirements:** stop stamping suspect dismissal from the browser clock ([d606f70](https://github.com/TestPlanIt/testplanit/commit/d606f702f8d77de9c736e0d0d19cc32496815a51))
* **requirements:** stop the enabled gate from flashing the disabled notice ([424ab71](https://github.com/TestPlanIt/testplanit/commit/424ab715fd2a9cb76084cdf0c052c77e82c0bfd5))
* **requirements:** stop the lazy list acting on state it never resolved ([fa08b4a](https://github.com/TestPlanIt/testplanit/commit/fa08b4aa253d717d0f94c9d397d1a3e9ca2cddbb))
* **requirements:** tolerate a non-document note value instead of crashing the requirement panel ([856fd67](https://github.com/TestPlanIt/testplanit/commit/856fd675edb9cba0d2ee1b7830c6e1ba355932b1))
* **requirements:** trim the requirement title on save and never write a blank one ([64b7cbc](https://github.com/TestPlanIt/testplanit/commit/64b7cbc77fc299314dc099b635cd1ac67cd68225))
* **requirements:** upload each staged attachment once and never without a signed-in user ([2aa4271](https://github.com/TestPlanIt/testplanit/commit/2aa4271921a9d78725c3f6a91030d5ac46e02e50))
* **requirements:** use the clipboard-plus icon for add affordances ([02fdc25](https://github.com/TestPlanIt/testplanit/commit/02fdc259f67aa3c7e65e5de6d5fffb54c3ec5bef))
* **requirements:** wrap the coverage badge separator in a JSX expression ([7a1fb9f](https://github.com/TestPlanIt/testplanit/commit/7a1fb9f5bce3accdf77d3aa3aed56a43d0bd4f0c))
* **resizable:** ensure onCollapse is called when restoring a collapsed panel ([5cccc90](https://github.com/TestPlanIt/testplanit/commit/5cccc90648115a4460d6060ca366aa99c228f780))
* **results:** decide a result's meaning from the status flags, not its name ([5ee4988](https://github.com/TestPlanIt/testplanit/commit/5ee49881f3707360ce8e9bbbb52f2f233bb51f50))
* **results:** give result history a usable height and lazy-load expanded details ([cc8e378](https://github.com/TestPlanIt/testplanit/commit/cc8e3780fa2e64ff699b18bc50d346297c870116))
* **results:** one status pill component, one text-colour rule ([911a88a](https://github.com/TestPlanIt/testplanit/commit/911a88ad4850633b1323197199dad3b936802ae5))
* **reviews:** cancel in-flight reviews on a hard delete too ([f40c3ed](https://github.com/TestPlanIt/testplanit/commit/f40c3ed05a6d1db09885412750285ded822f2c34))
* **reviews:** cancel reviews stranded by a case move ([7e4c4b3](https://github.com/TestPlanIt/testplanit/commit/7e4c4b350dffd2d277bc948e8b023c61d6064430))
* **reviews:** clarify pending-review banner wording ([7a118e0](https://github.com/TestPlanIt/testplanit/commit/7a118e0a0767d4c529781bb4becbbe8b6e43a387))
* **reviews:** correct inbox table sizing, truncation, links, and chip scale ([dfb0289](https://github.com/TestPlanIt/testplanit/commit/dfb02892515d05912f4b03c95363dd9864d553c9))
* **reviews:** include group GLOBAL_ROLE holders in the review assignee picker ([8d57031](https://github.com/TestPlanIt/testplanit/commit/8d57031815e4c61b86fd2edf56cbc13c7788f6ce))
* **reviews:** let the assigned reviewer read their own review request ([f42f511](https://github.com/TestPlanIt/testplanit/commit/f42f51102abd73389f62257cfa9e18b0b744761c))
* **reviews:** pending badge on unscheduled runs, aligned with the name row ([5d4813a](https://github.com/TestPlanIt/testplanit/commit/5d4813a10e7ad5367745298d11eeff2e9da6b17b))
* **reviews:** refresh the inbox badge count from the notification stream ([9854eac](https://github.com/TestPlanIt/testplanit/commit/9854eac5a71b08b3c17930884f74cb2425542073))
* **reviews:** thread the requester's locale into getTranslations ([4ff22f6](https://github.com/TestPlanIt/testplanit/commit/4ff22f607a7f4fa21520139dc736fd24f25627a9))
* **reviews:** widen requestReview's try over the pre-transaction prep ([28059d0](https://github.com/TestPlanIt/testplanit/commit/28059d0ab1f64c4efea95671216b5efd58f25cf8))
* **richtext:** store Tiptap documents in one shape ([d589470](https://github.com/TestPlanIt/testplanit/commit/d58947028e549a52e98dd762f287435923cc1eee))
* **RoleNameDisplay:** add shrink-0 class to Drama icon for better layout ([36f010d](https://github.com/TestPlanIt/testplanit/commit/36f010d707fa93a3cf55f55510c1f5e91b5ac3f6))
* **runs:** add missing JUnitTestResult.worker migration ([0454d16](https://github.com/TestPlanIt/testplanit/commit/0454d1641e4f382969fdd4dc020424841fe42d15))
* **runs:** allow duplicating a completed test run from the runs list ([470295b](https://github.com/TestPlanIt/testplanit/commit/470295bc3c03b1b4aedcfc1b689f15056f15dcd3))
* **runs:** carry milestone tracker linkage into the Add Test Run picker options ([8fb64a6](https://github.com/TestPlanIt/testplanit/commit/8fb64a6f8d67300d2b3cb0da7d0f96b9184a81eb))
* **runs:** exclude soft-deleted cases from run summary counts ([#566](https://github.com/TestPlanIt/testplanit/issues/566)) ([0adf7dc](https://github.com/TestPlanIt/testplanit/commit/0adf7dc719ea6070a91c16b14ffee309dc353b1f))
* **runs:** highlight a deep-linked case on automated runs instead of opening the sheet ([829bce5](https://github.com/TestPlanIt/testplanit/commit/829bce51117bd9a9542dd27eaf9dd3539b93ea7a))
* **runs:** hold in-place case editing in state, not the URL ([a87a8ab](https://github.com/TestPlanIt/testplanit/commit/a87a8ab7b6e4514715e8e0a5b72bd06cab43a3fb))
* **runs:** invalidate only the run that woke up, and coalesce the burst ([d872629](https://github.com/TestPlanIt/testplanit/commit/d872629b97dd595d2df77e5c5f87d6d61afa247f))
* **runs:** label the execution timeline axis in readable time units ([1fc2899](https://github.com/TestPlanIt/testplanit/commit/1fc2899db1572ee920d2781ba5553b33829e8c44))
* **runs:** rank child milestones like every other milestone list ([f2595b5](https://github.com/TestPlanIt/testplanit/commit/f2595b54416ab2750f16d13f29b5ae05a2c28aff))
* **runs:** re-derive run-case status when a result is edited or deleted ([#543](https://github.com/TestPlanIt/testplanit/issues/543)) ([4b4eb91](https://github.com/TestPlanIt/testplanit/commit/4b4eb91c3d0e81d73bbb253d4929f3cf7d5e2cd0))
* **runs:** scroll the whole run list with the page ([1ddc37a](https://github.com/TestPlanIt/testplanit/commit/1ddc37afe2fe0f6b61ede4fbf4b8000d45ed313d))
* **runs:** select the new attachment issue key in the run case detail query ([7216761](https://github.com/TestPlanIt/testplanit/commit/721676184cf8db689cd2b613aad2017d21826056))
* **runs:** stop hydrating every repositoryCase when loading a test run ([28b9e6f](https://github.com/TestPlanIt/testplanit/commit/28b9e6f37a31b8cd64a33dcc80fe749aab5540e2))
* **runs:** stop iteration result recording from stalling on a page-wide refetch ([27659bc](https://github.com/TestPlanIt/testplanit/commit/27659bcc6c7f22a278f5aedffcb5d99cc4e514c9))
* **runs:** stop per-run summary and case fan-out while batch summaries load ([a61bfc6](https://github.com/TestPlanIt/testplanit/commit/a61bfc6b3bebae9a7068def418c7f38bd39bf493))
* **runs:** stop prefetching a detail page for every run tile ([996c550](https://github.com/TestPlanIt/testplanit/commit/996c55079bb253e6702569750c76e7c1a7a1a288))
* **runs:** use the case's automated flag for the type icon in automated run results ([abb809c](https://github.com/TestPlanIt/testplanit/commit/abb809cbab4583f26fef0063b7ec023d0e0247dd))
* **runs:** window the flat list the all-completed view falls back to ([e977fc7](https://github.com/TestPlanIt/testplanit/commit/e977fc761b8c193e69c8588b337443db9a91d092))
* **runs:** window the run tiles inside each milestone group ([1eecddf](https://github.com/TestPlanIt/testplanit/commit/1eecddf5ddcb678926efdbf5bfad9c48d4414615))
* **schema:** cascade hard-purge to owned child records ([8323346](https://github.com/TestPlanIt/testplanit/commit/8323346c168bb5f3da5c2c43f581207ac3c8fb2f))
* **schemas:** accept unset field values dropped by wire serialization ([24796bd](https://github.com/TestPlanIt/testplanit/commit/24796bd87f693776ecd7ded9d2b4511557510f82))
* **scim:** bound the access-recompute fallback sweep to batched transactions ([5046b8f](https://github.com/TestPlanIt/testplanit/commit/5046b8f89dacdb285cd4e1e49cd6538989fc24be))
* **scim:** correct the scimRoles migration and repair the live-DB suite ([a74bb0b](https://github.com/TestPlanIt/testplanit/commit/a74bb0bcfafb9e6a6d173f141d16d8b3de7eae98))
* **scim:** stop per-project mapping bridging to a "Project Admin" role ([0074095](https://github.com/TestPlanIt/testplanit/commit/0074095e04ac518fde81d2f0bc4c245aebeb7167))
* **scroll:** implement hash-based smooth scrolling with ref tracking to prevent sticking to the scrolled area. ([a1512e2](https://github.com/TestPlanIt/testplanit/commit/a1512e2c8a3011bef97e90d665f28fde30e6b763))
* **search:** index the requirement role on both issue writers ([c4bd09b](https://github.com/TestPlanIt/testplanit/commit/c4bd09be9c861dd145bb859aeac92a1596ee7460))
* **search:** index to Elasticsearch after commit, not inside the transaction ([8e3a2ba](https://github.com/TestPlanIt/testplanit/commit/8e3a2ba6a1688678878c529457c5d8a6a6f23a3e))
* **search:** reindex cases and runs after forecast writes ([d38f4d7](https://github.com/TestPlanIt/testplanit/commit/d38f4d78eafa1246b801d5853f50ec80e567c5ea))
* **security:** gate read-only API tokens on write routes and scope repository lookups to the project ([c00794f](https://github.com/TestPlanIt/testplanit/commit/c00794ffec3b64ccf24d3bcf0dbc3cc709442a97))
* **seed:** give the seeded case fields stable ids ([1e51f5c](https://github.com/TestPlanIt/testplanit/commit/1e51f5c015ea4ad8d0042bbe607f8cb0b225135e))
* **seed:** stop the seed overwriting settings an admin has changed ([6260b35](https://github.com/TestPlanIt/testplanit/commit/6260b357f6662f529e082b0d4778a2158140d95b))
* **sessions:** display message when no attachments are present in session form ([63386f0](https://github.com/TestPlanIt/testplanit/commit/63386f0543ac02eea5505708f77b032e630cdc51))
* **sessions:** keep user-typed values when the add-session form finishes late init ([e96a45f](https://github.com/TestPlanIt/testplanit/commit/e96a45f8156f0a0053f8d5cfe9f52c46f5593f1a))
* **sessions:** stop prefetching every tile and scroll the list with the page ([38292a3](https://github.com/TestPlanIt/testplanit/commit/38292a382dead7fa8ba37d77e17aaa83b07e7348))
* **spinner:** replace minimal spinner with Loader2 component for consistent styling ([9670a2c](https://github.com/TestPlanIt/testplanit/commit/9670a2ca5e3569f6f2a0056054eb5c8384e131d2))
* **ssrf:** close the IPv4-mapped IPv6 bypass in the private-range guard ([a4ff0de](https://github.com/TestPlanIt/testplanit/commit/a4ff0de59ea40741733173406c943ddc42d264c8))
* **statuses:** guard the seeded "untested" row in the database ([14cd918](https://github.com/TestPlanIt/testplanit/commit/14cd91898388fc2114f20c1bba02d266f5d03d52))
* **step-duplicates:** show matched steps every time the conversion dialog opens ([f20c398](https://github.com/TestPlanIt/testplanit/commit/f20c39894e1d17025de15c6b2422762194679b80))
* **step-duplicates:** stop loading every case's full step text in the results list ([0c8d1c9](https://github.com/TestPlanIt/testplanit/commit/0c8d1c9ea9adcb049e2207adec584c46670e9ade))
* **step-duplicates:** virtualize the results table and restore step-text previews ([998b85f](https://github.com/TestPlanIt/testplanit/commit/998b85f40e9c13fde646298765bd8c189ee17af3))
* **steps:** stop bulk step replace from destroying run step results ([063f39b](https://github.com/TestPlanIt/testplanit/commit/063f39b4696addf9b575ae13845f02bf5eac7277))
* **streams:** defer live-stream connections until the page is idle ([2cb540d](https://github.com/TestPlanIt/testplanit/commit/2cb540dedbbb89e55be1b36414ca13eebc629c96))
* **stripHtmlTags:** implement utility to strip HTML tags and decode entities for plain-text previews ([7c7c5db](https://github.com/TestPlanIt/testplanit/commit/7c7c5db865d5bde9a70fe154e747941d92f88048))
* **tables:** add loadedCount prop to VirtualizedDataTable for improved pagination handling when a table contains parent/child rows ([c11115a](https://github.com/TestPlanIt/testplanit/commit/c11115a3e2a5d2d0a2c540d635c33a16fc4baf23))
* **tables:** inset the selected-row highlight ring so no edge is clipped ([1e22dfb](https://github.com/TestPlanIt/testplanit/commit/1e22dfb95c043489feeb4287b21db63668664895))
* **tables:** put each theme's data table rows on its own neutral hue ([1ef62c2](https://github.com/TestPlanIt/testplanit/commit/1ef62c2ed6a4a9975d7330ca64b772063fb97718))
* **tables:** render the selected-row ring above pinned cells ([105b7b2](https://github.com/TestPlanIt/testplanit/commit/105b7b2fbb33fe35a2cae923bdbdba24da57852f))
* **tables:** size scroll-padding to the pinned columns so scrolled-to cells stay reachable ([d174ffb](https://github.com/TestPlanIt/testplanit/commit/d174ffb59e341604d968e35a65d2502c2b89bd0e))
* **tables:** stop the deep-link scroll retry from requiring an optional virtualizer method ([4c9f61b](https://github.com/TestPlanIt/testplanit/commit/4c9f61bed4f85af8135577bcaae7b9594040321a))
* **tables:** use table-layout:fixed so resizable columns honor their width ([6daf752](https://github.com/TestPlanIt/testplanit/commit/6daf75299a39b75b6cc025591b2e9bd4cd947ded))
* **tags:** update filters and relations to align with v3 schema changes ([aec646a](https://github.com/TestPlanIt/testplanit/commit/aec646a2aa2ce9e449f09039aa0a9ffde80cefa3))
* **testmo-import:** keep environment out of automation case identity ([a4cddf8](https://github.com/TestPlanIt/testplanit/commit/a4cddf8e080493b2c255b03dc8700c8f949d9a76))
* **testmo-import:** register Table extensions in step HTML converter ([#573](https://github.com/TestPlanIt/testplanit/issues/573)) ([961f133](https://github.com/TestPlanIt/testplanit/commit/961f1331a78986cf808ff4aa39f7fdff7dffd718))
* **testmo-import:** strip browser-version prefixes from automation className ([7af8a90](https://github.com/TestPlanIt/testplanit/commit/7af8a90e21e07e34a70791f19414393196c75c88))
* **tests:** enhance dialog submission handling in default workflow edit test ([8802cd8](https://github.com/TestPlanIt/testplanit/commit/8802cd80aa10e3e8ed01cb4921e7105b9514c46d))
* **tests:** enhance resilience of tag deletion and improve dimension selection handling in tests ([7a200ec](https://github.com/TestPlanIt/testplanit/commit/7a200ec949950ed71ff43ccbe1d40b3391a6975b))
* **test:** serialize live-DB integration files in CI too ([7c8dd12](https://github.com/TestPlanIt/testplanit/commit/7c8dd126e60bb81b1a90785a73388c292dca3ac9))
* **tests:** format code according to prettier ([ab07737](https://github.com/TestPlanIt/testplanit/commit/ab077372b55fb0dfd6fad976e16d9caaf4d4b371))
* **tests:** improve sorting test reliability and enhance project cleanup in webhook tests ([0849c64](https://github.com/TestPlanIt/testplanit/commit/0849c64702016ce6213bba4780c52f72aa9a20c2))
* **tests:** pin the clock in the MantisBT adapter date test ([2ce47b8](https://github.com/TestPlanIt/testplanit/commit/2ce47b89682a9eb3a928f3c8a908488ec0dae08b))
* **tests:** update targetBox type definition for drag-and-drop tests ([43b8679](https://github.com/TestPlanIt/testplanit/commit/43b86796e7ad06c0d15597c17d0659ad6859122f))
* **theme:** prevent theme-change flash and script-tag render error ([1f5887b](https://github.com/TestPlanIt/testplanit/commit/1f5887bd19bf15077fb5698132790b11730c12c7))
* **tiptap:** render block-level images (inline:false), fixing DragHandle crash ([e76c42d](https://github.com/TestPlanIt/testplanit/commit/e76c42da0af0c86aa064e08ce8b647757de9baac))
* **tiptap:** sync content prop into read-only editor after mount ([40bf3c1](https://github.com/TestPlanIt/testplanit/commit/40bf3c1d204c472d85ce56703f47f39160ac6567))
* **translations:** add import issues functionality and related messages in multiple languages ([e211004](https://github.com/TestPlanIt/testplanit/commit/e211004e736bb377e5ab91cd7416dc0c5939c587))
* **translations:** add timeout and error messages for import process in multiple languages ([e714210](https://github.com/TestPlanIt/testplanit/commit/e714210952a27bff4f0d5d426acf0a5e91a8d814))
* **translations:** update Korean translations for tag and active test run messages ([6beee84](https://github.com/TestPlanIt/testplanit/commit/6beee84e658175cc673d52309db16cf80d949a57))
* **TreeView:** prevent folder actions button click from propagating ([d4be652](https://github.com/TestPlanIt/testplanit/commit/d4be652224cc015130108cad4032e9eb23805c75))
* **ui:** case-name columns ellipsize instead of clipping ([671db9c](https://github.com/TestPlanIt/testplanit/commit/671db9c36b41377aa9d953a59663f95e6ca8c9ef))
* **ui:** clip collapsed resizable panels under v4 (overview collapse) ([59a67d9](https://github.com/TestPlanIt/testplanit/commit/59a67d9506f4217b3022740cdbf5a2e3366bd563))
* **ui:** debounce async combobox search and drop the duplicate open fetch ([09769d7](https://github.com/TestPlanIt/testplanit/commit/09769d7a5fdb829bdb85cc5d403ed835f1976baf))
* **ui:** keep dialogs and sheets open when pressing a resize handle ([c677a8c](https://github.com/TestPlanIt/testplanit/commit/c677a8c6f23b1c81a67493267cbbd3c284f9b1ba))
* **ui:** keep typed input through late form seeds and menu focus restores ([7f130b7](https://github.com/TestPlanIt/testplanit/commit/7f130b7d89068903186d429b051b0a85e755c244))
* **ui:** make integration sync tooltip hint legible ([1312d04](https://github.com/TestPlanIt/testplanit/commit/1312d04afef1a0aa8e7192da0efc3d6b38f5b6ec))
* **ui:** map data-testid to id for react-resizable-panels v4 group ([31af532](https://github.com/TestPlanIt/testplanit/commit/31af532a6a749b73e0b88c7f25cd9ca2feeda734))
* **ui:** map data-testid to id for v4 resizable panels too (not just group) ([39f3dba](https://github.com/TestPlanIt/testplanit/commit/39f3dba6e5e120924fa2017c2b1bb73594291dd9))
* **ui:** refresh requirement version history after a save; keep unsaved JUnit property names ([2503072](https://github.com/TestPlanIt/testplanit/commit/250307275d42cb2efdd5810bb815ba4bb1b5ab14))
* **ui:** stop reading storage in useState initializers ([bf27baf](https://github.com/TestPlanIt/testplanit/commit/bf27bafb85e76734db4ee8efafa4106b2410db52))
* **ui:** stop server-rendering resizable panel groups ([d101dad](https://github.com/TestPlanIt/testplanit/commit/d101dad39a0b09932ebdcd5893d1815579419f22))
* **ui:** stop server-rendering resizable panel groups ([a812292](https://github.com/TestPlanIt/testplanit/commit/a8122926ac575f41f101a852b75cac3f3d2263f9))
* **ui:** theme-safe badge contrast for status, count, and star badges ([86c1aca](https://github.com/TestPlanIt/testplanit/commit/86c1acae94bafd8717973e8aaf0c0d1f938f14bd))
* **ui:** use destructive-foreground text on destructive action buttons ([65811fc](https://github.com/TestPlanIt/testplanit/commit/65811fca63ef3bd5fe06b87dba64833999eb35ed))
* **UnifiedSearch:** add automated icon for automated test case results ([e525282](https://github.com/TestPlanIt/testplanit/commit/e525282506d68787d2b73ca9bd45ca3563349018))
* **upgrade-notifications:** compare versions by SemVer precedence incl. pre-release ([62e9606](https://github.com/TestPlanIt/testplanit/commit/62e9606ce651f457b938eb4077bb3787b062435d))
* **users:** scope User reads to project collaborators ([d7081c4](https://github.com/TestPlanIt/testplanit/commit/d7081c4910c362d9d2e0d27d4ca57de8a4d140b2)), closes [#540](https://github.com/TestPlanIt/testplanit/issues/540)
* **version:** show the beta prerelease tag as the app version ([8528a0f](https://github.com/TestPlanIt/testplanit/commit/8528a0f6058ba0536f6c3ed6b9384615c7444df4))
* **wdio-reporter:** export the service-created run id to forked workers ([8d1de1c](https://github.com/TestPlanIt/testplanit/commit/8d1de1ccf2363f726008426e3f7f5402c9d49d4d))
* **wdio-reporter:** report failing attempts of per-test retries ([ad2c77e](https://github.com/TestPlanIt/testplanit/commit/ad2c77ed7d263e25d906c20393531d4f6bc62ada))
* **webhooks:** add missing truncate helper and stabilize type-check ([cdfdbe8](https://github.com/TestPlanIt/testplanit/commit/cdfdbe849b04fa5c2f92ff87d06ee33fbe0c0977))
* **webhooks:** apply the burst allowance to inbound issue syncs too ([89cb29d](https://github.com/TestPlanIt/testplanit/commit/89cb29db1df253cb71aa28d8ebbc317c57e56272))
* **webhooks:** fan out Issue events to every linked project ([8548f6b](https://github.com/TestPlanIt/testplanit/commit/8548f6ba06bc3309d95a74cfdcf3c80e0e2c2976))
* **workers:** carry typed-import options from the job into the import ([3e2b2ab](https://github.com/TestPlanIt/testplanit/commit/3e2b2ab4455dfda7f41f19c576dcfaf2163707c7))
* **workers:** raise elasticsearch-reindex-worker memory ceiling to 2G ([0bb4da1](https://github.com/TestPlanIt/testplanit/commit/0bb4da1863a804a7fc0b3cdefcdd6f3f2f2acc7a))
* **workers:** skip email jobs and digest fan-out when no email server is configured ([44df43d](https://github.com/TestPlanIt/testplanit/commit/44df43d07a1822f6697182e574a521fca5c837df))
* **zenstack:** clear final type errors — wrapper generic, nested upsert, TS2589, find callbacks ([7638429](https://github.com/TestPlanIt/testplanit/commit/7638429045e7432b5bd95138b90388cc08544b7f))
* **zenstack:** correct explicit-tag-join reads in reports, tag-detail page, and gate-status queries ([fe11385](https://github.com/TestPlanIt/testplanit/commit/fe113858a25a7880f34f07e0d7f0f988533914df))
* **zenstack:** Decimal inputs, JSON-field casts, ORMError code->dbErrorCode ([23170ff](https://github.com/TestPlanIt/testplanit/commit/23170ff850c79450226d7c3b1edd7adacbad38d3))
* **zenstack:** drop maxWait/timeout from $transaction options (v3 only allows isolationLevel) ([5eeef05](https://github.com/TestPlanIt/testplanit/commit/5eeef05db418f533b8ddf4c21835429afbcc23c1))
* **zenstack:** drop over-specific hook-result annotations + cast DataTable/TestRunDisplay props ([06fb1e4](https://github.com/TestPlanIt/testplanit/commit/06fb1e4cb91b94447222e4135eb18ad5063301fa))
* **zenstack:** make ReviewRequest assignee @[@validate](https://github.com/validate) update-safe under v3 ([453ea2a](https://github.com/TestPlanIt/testplanit/commit/453ea2a4290ae4e21731a6c2b4aff0e4e94c0646))
* **zenstack:** make Workflows requires-review validate update-safe ([eb41b3d](https://github.com/TestPlanIt/testplanit/commit/eb41b3d70373f0c457027b7bfedfe2cdcd99d4b2))
* **zenstack:** more JSON casts, Date input, dead enhance, [@omit](https://github.com/omit) secret, share audit ([d639c8c](https://github.com/TestPlanIt/testplanit/commit/d639c8cdfcd7ce1051a06a09825f04c9e431859c))
* **zenstack:** phase 6 syntax + systemic type fixes ([42ebb76](https://github.com/TestPlanIt/testplanit/commit/42ebb769445e608dd0fc683b469129afd6d2b153))
* **zenstack:** phase 6 type fixes — TxClient inference, RPC route, Decimal, [@omit](https://github.com/omit) ([904701a](https://github.com/TestPlanIt/testplanit/commit/904701a768b69e72e7ef0c2c8a45a88bd1dff416))
* **zenstack:** resend type when switching a SELECT parameter's source ([e21ef24](https://github.com/TestPlanIt/testplanit/commit/e21ef245aa270a9cccae7f33cdb93044a7e5a5d9))
* **zenstack:** resolve v3 runtime regressions surfaced by prod-build E2E ([c849310](https://github.com/TestPlanIt/testplanit/commit/c8493105098b26f96713f608b55f9199b0ed9b31))
* **zenstack:** seed ReviewRequest test rows with the required assignee ([a8e4b06](https://github.com/TestPlanIt/testplanit/commit/a8e4b06846414594bb2f675931bb4c18fcb1ccdb))
* **zenstack:** share/[shareKey] reads passwordHash via omit:{passwordHash:false} on both fetches ([33a8e74](https://github.com/TestPlanIt/testplanit/commit/33a8e7481a0767a95087bc3cd95e09747587801f))
* **zenstack:** three more v3 regressions found by E2E failure triage ([3930ed3](https://github.com/TestPlanIt/testplanit/commit/3930ed3b01f8b7a45ca21767d163b5c7cbc393a8))
* **zenstack:** v3 regressions surfaced by E2E console/network diagnostics ([77da6fb](https://github.com/TestPlanIt/testplanit/commit/77da6fb14d5abe19fa9ec420613faa5af15744ac))
* **zenstack:** write webhook outbox row via raw SQL so policy-client writes work ([26ca856](https://github.com/TestPlanIt/testplanit/commit/26ca856a872f3a828cbde529c01e5659663b0a01))

### Enhancements

* **adapter:** enhance retry logic for HTTP 429 and 5xx responses with Retry-After support ([8e79bec](https://github.com/TestPlanIt/testplanit/commit/8e79bec83ea52c786bf95f83171e42300ac2a28d))
* **admin:** group AI admin pages under an "AI Tools" section ([f5c987d](https://github.com/TestPlanIt/testplanit/commit/f5c987d55cbaab8d17ce15986d50cfdac28ac47c))
* **admin:** pin the first column on the sso providers and scim tables ([8c9e111](https://github.com/TestPlanIt/testplanit/commit/8c9e1112cc288f7b29bd9bd7fa050c7d640a201d))
* **admin:** redesign Trash page as sidebar master-detail with virtualized infinite scroll ([74ca3d9](https://github.com/TestPlanIt/testplanit/commit/74ca3d9d2a2e924ce5708a53d4e6903cfa123b3a))
* **attachments:** expand mode shows only the attachment scaled to the modal viewport ([95ab01c](https://github.com/TestPlanIt/testplanit/commit/95ab01c2ffd024405c28a1d6282319fe866e1c8e))
* **audit-logs:** skip-scan distinct actor queries and DB-backed action filter ([15d259f](https://github.com/TestPlanIt/testplanit/commit/15d259f12b53939dc96eb1e94b81623c235560fc))
* **audit-logs:** skip-scan entity-type and project filter options ([83ea8dc](https://github.com/TestPlanIt/testplanit/commit/83ea8dc5c6bdabe43a32aa246c8f0dbf88080590))
* **audit:** enhance date range picker to default to current week and add preset option ([fdfd37a](https://github.com/TestPlanIt/testplanit/commit/fdfd37a4cacca93bbf25ea6fc27645e479007715))
* **audit:** record rich-text description edits in the audit log ([dc777f9](https://github.com/TestPlanIt/testplanit/commit/dc777f9604ca7bf6d97150b68c95ff51f0b9ba2f))
* **auth:** device-bound magic-link sign-in with OTP fallback (beta port) ([#499](https://github.com/TestPlanIt/testplanit/issues/499)) ([0ceee14](https://github.com/TestPlanIt/testplanit/commit/0ceee1457289a094938019a72248809388e66c36)), closes [#497](https://github.com/TestPlanIt/testplanit/issues/497)
* **auto-tag:** infinite scroll for the review tag suggestions list ([2613ec2](https://github.com/TestPlanIt/testplanit/commit/2613ec24d2e097cd5126289ee93231c599ab67fd))
* **automation:** add hook for fetching automation run counts and integrate into project cards ([d2870c3](https://github.com/TestPlanIt/testplanit/commit/d2870c3f883e03a6ba3592f1143e044a891bd57b))
* **combobox:** infinite scroll replaces paging in async comboboxes ([46a555b](https://github.com/TestPlanIt/testplanit/commit/46a555b65ba518c6af07af6fbbaf08c5bff1c303))
* **generate:** retry a single failed test case from the review step ([381a26f](https://github.com/TestPlanIt/testplanit/commit/381a26f64d0df32585897bacadaec722f7959896))
* **i18n:** add markdown headers to page-level help popovers ([95c9f5b](https://github.com/TestPlanIt/testplanit/commit/95c9f5b1d653dc36246fd852f8d420950c03347d))
* **import:** materialize Surefire flaky and rerun records as retry attempts ([b2062bf](https://github.com/TestPlanIt/testplanit/commit/b2062bfd71b8e054bedeef1cb1900170cfbe68cf))
* **integrations:** sync Jira milestone membership on Server/Data Center ([90975ba](https://github.com/TestPlanIt/testplanit/commit/90975baf8b89634eaaa34fed2ccb2929d5017cff))
* **issues:** add a Milestones linkage column to the issues tables ([8194ee0](https://github.com/TestPlanIt/testplanit/commit/8194ee086124e9a9efd620e735447580eff6061b))
* **issues:** multi-select status, priority, and issue type filters ([b3f00f5](https://github.com/TestPlanIt/testplanit/commit/b3f00f57c069f03bc1b6321d9e087b44ffceea33))
* **MemberIssuesTable:** visual enhancements ([5f2c02a](https://github.com/TestPlanIt/testplanit/commit/5f2c02a052e42ec20e528c35cce082b84d5f5555))
* **milestones:** add an activity-log section to the milestone detail page ([8407f8e](https://github.com/TestPlanIt/testplanit/commit/8407f8e315d7f74d9fb8805420786cdd1e4efa25))
* **milestones:** add milestone kind filter and improve milestone display logic ([dbd091d](https://github.com/TestPlanIt/testplanit/commit/dbd091d5a560e2f798cb902bc8b882ed8f0f52fe))
* **milestones:** burndown chart on the milestone detail page ([2c19cec](https://github.com/TestPlanIt/testplanit/commit/2c19cec7119cfacaa45ed8d8816d25f8a265513c))
* **milestones:** collapse detail-page cards into persisted accordions ([ea74b38](https://github.com/TestPlanIt/testplanit/commit/ea74b38997f43e4dad56761ef2634f6c5a0a752f))
* **milestones:** color the burndown heat strip when ahead of ideal ([d4eac2b](https://github.com/TestPlanIt/testplanit/commit/d4eac2ba65c4c7bbacf4f975896f9950e697d3dd))
* **milestones:** compact the managed-by-Jira notice with a Jira link and help popover ([a317000](https://github.com/TestPlanIt/testplanit/commit/a317000902a989316fe3c3defa8a900241cdac1e))
* **milestones:** date-range tooltip on the milestone name ([1538c21](https://github.com/TestPlanIt/testplanit/commit/1538c2183efce5dd32edd23964514c881d6ff3e6))
* **milestones:** description column and issue-type icon in Found in testing ([d463b45](https://github.com/TestPlanIt/testplanit/commit/d463b451390fc05aa94b91c26e091f4e8a1e59f4))
* **milestones:** drop the redundant Refresh label from the Issues toolbar ([87eced6](https://github.com/TestPlanIt/testplanit/commit/87eced6f0ec452dd90000574c8e443395243feb3))
* **milestones:** let the milestone name win row space over the source badge ([5764f49](https://github.com/TestPlanIt/testplanit/commit/5764f4912780e7f7c38b3f1030a9b0a1d53ce1e4))
* **milestones:** per-case traceability matrix in the milestone PDF export ([ce645f9](https://github.com/TestPlanIt/testplanit/commit/ce645f9bfc5fa984c953e1411b43b64c84489630))
* **milestones:** per-project opt-out for auto-track milestone scanning ([81864f9](https://github.com/TestPlanIt/testplanit/commit/81864f9e15c55b10912671a01c8f3ba7e5fb1c42))
* **milestones:** pin scope-issue table columns and consolidate row actions ([48f9e79](https://github.com/TestPlanIt/testplanit/commit/48f9e79d5dd4e1047770bd3318af79203582ef19))
* **milestones:** release-readiness "% ready" rollup on the Issues section ([045be18](https://github.com/TestPlanIt/testplanit/commit/045be188b9cc8081a70a24b37f87917ee2e4365d))
* **milestones:** render Found in Testing issues as a table matching In Scope ([ef19ed6](https://github.com/TestPlanIt/testplanit/commit/ef19ed6051b6573386d44978ce85ed189361549c))
* **milestones:** searchable milestone picker built on the shared AsyncCombobox ([9ff7b2b](https://github.com/TestPlanIt/testplanit/commit/9ff7b2b61b077e9ef9fcb8dfdebae479c1dd1400))
* **milestones:** show a compact Jira source icon wherever milestones appear ([771ad2b](https://github.com/TestPlanIt/testplanit/commit/771ad2b7b2ffbcb4d4839111bacd88622d9eb354))
* **milestones:** variance heat strip beneath the burndown ([f1eefe7](https://github.com/TestPlanIt/testplanit/commit/f1eefe767bf609ad471ba60a4c72b956395c2058))
* **milestones:** virtualize run/session lists and restructure the milestone detail layout ([a49dd6f](https://github.com/TestPlanIt/testplanit/commit/a49dd6fc4dae2596d4274da05649c6da8cdf80d0))
* **milestones:** warn about recursive child deletion in the delete confirmation ([0dc625c](https://github.com/TestPlanIt/testplanit/commit/0dc625cd270b7dd4292dbc56a92426c84f8f73ac))
* **notifications:** announce the 1.0 release in-app ([7bab0c2](https://github.com/TestPlanIt/testplanit/commit/7bab0c23d9d7c9b7ed3778d63c8bd6e486b8bc7c))
* per-template default field selection for Generate Test Cases wizard ([#544](https://github.com/TestPlanIt/testplanit/issues/544)) ([ee70413](https://github.com/TestPlanIt/testplanit/commit/ee70413f7d62aac4d12f4aa13f6ac7841083d714))
* **polling:** implement adaptive backoff for idle multi-tenant clients and add tests ([1562641](https://github.com/TestPlanIt/testplanit/commit/1562641e09beb910dc44802ca639839dca87b3ad))
* **profile:** rework Mentioned in Comments into My Comments with scope filter, text search, and infinite scroll ([dc64b29](https://github.com/TestPlanIt/testplanit/commit/dc64b29fafeae127b2bd9c7e29060e7b872ad0f9))
* **ProjectQuickSelector:** enhance link handling for project selection and navigation ([6a204ab](https://github.com/TestPlanIt/testplanit/commit/6a204ab8f4906311e03ace9de135f9164470a767))
* **quickscript:** bracket test case IDs in generated test names ([14f2e4d](https://github.com/TestPlanIt/testplanit/commit/14f2e4dc4c1766814f89995f5ad6f8943f3e5937))
* **reports:** consolidate effective case status into a single accessor ([a015099](https://github.com/TestPlanIt/testplanit/commit/a0150991c4149606000475bb3b18d8cbccfea7c5)), closes [#589](https://github.com/TestPlanIt/testplanit/issues/589) [#590](https://github.com/TestPlanIt/testplanit/issues/590) [pre-#589](https://github.com/TestPlanIt/pre-/issues/589) [#591](https://github.com/TestPlanIt/testplanit/issues/591)
* **reports:** milestone readiness report ([ada36a2](https://github.com/TestPlanIt/testplanit/commit/ada36a2108fb6cdaf574eaf3ed1a1de5a85b612f))
* **reports:** plot the milestone dimension on a time axis ([d5939ec](https://github.com/TestPlanIt/testplanit/commit/d5939ec6228898fcf1d31050a15f4ea4f7c3eb90))
* **reports:** unpin the last column on report tables ([891338c](https://github.com/TestPlanIt/testplanit/commit/891338cc72f40e5f2b46812340ead8bd19b46fed))
* **repository:** add an In Review view axis and filter ([4d32bd7](https://github.com/TestPlanIt/testplanit/commit/4d32bd776d38162645028af2250cc9556ccb5220))
* **repository:** collapse case action bars into a kebab menu when narrow ([dad703a](https://github.com/TestPlanIt/testplanit/commit/dad703a8e165c85a9b0e34e0a6b2c8dc21d78669))
* **repository:** offer saved views in the case-selection dialog ([5daee46](https://github.com/TestPlanIt/testplanit/commit/5daee46bc2df5d20efce3a8d51f0757aa7ec56c3)), closes [#568](https://github.com/TestPlanIt/testplanit/issues/568)
* **repository:** sort cases by dropdown casefield option order ([bc26d31](https://github.com/TestPlanIt/testplanit/commit/bc26d3115479aa888671f000c85b8e43a9c55548))
* **repository:** update docs for folder filter/picker ([151217f](https://github.com/TestPlanIt/testplanit/commit/151217f8bf26a8528dc8a82a55ef92d0d7cc44f8))
* **RequestReviewSheet:** improve handling of initialValues and comment retention during refetch ([5abd6da](https://github.com/TestPlanIt/testplanit/commit/5abd6da3579a23d6dae1fd6a6a2dfad319ba51a0))
* **requirements:** add a collapse toggle for the requirements tree pane ([2325f2e](https://github.com/TestPlanIt/testplanit/commit/2325f2e40a2cfab58900ab1de49046b55eb23135))
* **requirements:** drop the traceability PDF export ([7162256](https://github.com/TestPlanIt/testplanit/commit/716225664bb49300338506f97dd26555205d3262))
* **requirements:** explain what the coverage panel's Latest Result means ([9a51347](https://github.com/TestPlanIt/testplanit/commit/9a51347e2c61d4d100ac7aa10452128c00c68291))
* **requirements:** fade the dragged row further while a drag is in flight ([2b78e32](https://github.com/TestPlanIt/testplanit/commit/2b78e32d89a905db51f5d606547759a130c4938a))
* **requirements:** let the list and detail panes collapse and expand fully ([fa006ea](https://github.com/TestPlanIt/testplanit/commit/fa006ea16e9c0207f9ff09688deb9f1623ffac73))
* **requirements:** show projects in the case popovers and move Priority beside Status ([ed4a8fe](https://github.com/TestPlanIt/testplanit/commit/ed4a8fe02aab9f80130064cd4ce77c7b7627379c))
* **requirements:** solid primary outline when hovering the root drop pill ([d04e417](https://github.com/TestPlanIt/testplanit/commit/d04e417458826b5dca7697844910ca09b4d55d0f))
* **requirements:** use the accent color for the dashed drop-zone lines ([a3336f2](https://github.com/TestPlanIt/testplanit/commit/a3336f25eeb2d059bcbfb8a34d9fe1630773c525))
* **requirements:** virtualize the requirement detail panels ([579df14](https://github.com/TestPlanIt/testplanit/commit/579df14be06b524a336caa79df2bebc1797cb2e7))
* **reviews:** bound the dashboard's pending-review query ([618a9f2](https://github.com/TestPlanIt/testplanit/commit/618a9f2b0bbd51f39518384f027ce2fd263d0e17))
* **reviews:** decision badges in comment history and a richer inbox ([#576](https://github.com/TestPlanIt/testplanit/issues/576)) ([004ed24](https://github.com/TestPlanIt/testplanit/commit/004ed24a72372ed47a87b2e02478c8d05c29dfa5))
* **reviews:** implement docked case details panel for improved review workflow ([db60095](https://github.com/TestPlanIt/testplanit/commit/db60095f2b7908697c747027e83d4553981d79c7))
* **reviews:** show requested reviews in the pending queue ([63992e0](https://github.com/TestPlanIt/testplanit/commit/63992e0f1906dd0fafc6ab2f35db08ea48d57986))
* **runs,sessions,milestones:** quality-of-life pass across the list pages ([#577](https://github.com/TestPlanIt/testplanit/issues/577)) ([6f984a8](https://github.com/TestPlanIt/testplanit/commit/6f984a88bed31f953ac4a403e4755ea949cceaa1))
* **runs,sessions:** size summary cards to fill the full width ([4af093f](https://github.com/TestPlanIt/testplanit/commit/4af093f3146fc756ea6966b39ee279db9f874c84))
* **runs:** edit configuration group membership after creation ([#572](https://github.com/TestPlanIt/testplanit/issues/572)) ([69e8da6](https://github.com/TestPlanIt/testplanit/commit/69e8da6e0359059e643ccf804a2c1f81aebe0c1d))
* **runs:** edit test cases in place from the execution panel ([#575](https://github.com/TestPlanIt/testplanit/issues/575)) ([e87b82b](https://github.com/TestPlanIt/testplanit/commit/e87b82b7e91bbfeebcfffd012a2786a31e6040bb))
* **runs:** filter chips, collapsible milestones, and Jira links ([#574](https://github.com/TestPlanIt/testplanit/issues/574)) ([620ce92](https://github.com/TestPlanIt/testplanit/commit/620ce92ca54c9d7612cc42ea001b6f7d8a977f46))
* **runs:** render and edit Description and Documentation on automated test runs ([987a54b](https://github.com/TestPlanIt/testplanit/commit/987a54b81a32d0f7261e2aa8c8542e61d3be6271))
* **search:** match entities by exact ID for numeric queries ([a8f17c0](https://github.com/TestPlanIt/testplanit/commit/a8f17c0be315805ac6bd31d578d39c51addb37a4))
* **search:** render search result cards as links ([e4a7a61](https://github.com/TestPlanIt/testplanit/commit/e4a7a61eb4cb103c103d9832f9016aaa8ec5b062))
* **step-duplicates:** filter shared step candidates by minimum cases and steps ([a36b718](https://github.com/TestPlanIt/testplanit/commit/a36b7184dfce3562fb763d49d4dca38f2bcd229a))
* **stepDuplicates:** enhance step duplicates page with improved layout and translations ([15ffbd8](https://github.com/TestPlanIt/testplanit/commit/15ffbd8f83dcd30ab1c25a2eda3d05f6a9e4c5a2))
* **tables:** add data-column-id attribute to table cells for improved accessibility ([a6e07ae](https://github.com/TestPlanIt/testplanit/commit/a6e07ae365d3c76eb6ac6aa9998a903a8a355865))
* **tables:** draggable, per-user-persisted column resizing ([a095bed](https://github.com/TestPlanIt/testplanit/commit/a095bedc2fcb6ab2e7a92e2f7003a78d7de2f845))
* **tables:** give data table rows a surface and a matching grid ([6360bcc](https://github.com/TestPlanIt/testplanit/commit/6360bcc69e5570216f2d50684188dfbfc7a3e282))
* **tables:** grow the column-selection popover wider instead of scrolling ([a7079d5](https://github.com/TestPlanIt/testplanit/commit/a7079d55d7b02d9ea737a6929ce9d7096bd93047))
* **tables:** one DataTable for paged and virtualized views with a shared feature set ([#579](https://github.com/TestPlanIt/testplanit/issues/579)) ([035cd61](https://github.com/TestPlanIt/testplanit/commit/035cd611ff3fa213a18638e01dc010e16e1cc020))
* **tables:** raise data table contrast in the accessible themes ([a346667](https://github.com/TestPlanIt/testplanit/commit/a3466673379914521fabc3cc5eaa9b74c46368dd))
* **tables:** seat the status legend beside the sort menu via a headerExtra slot ([4610ea0](https://github.com/TestPlanIt/testplanit/commit/4610ea0998245cc218a03ba3ee40eccfd192814f))
* **tables:** virtualized infinite-scroll tables across the app ([#490](https://github.com/TestPlanIt/testplanit/issues/490)) ([1f5dd45](https://github.com/TestPlanIt/testplanit/commit/1f5dd453f533acdfdf091061e1228eb4fe6ede58))
* **tag-analysis:** improve entity batching and token management in TagAnalysisService ([677d1f6](https://github.com/TestPlanIt/testplanit/commit/677d1f6d54d5037459d64af9f583602b2df77751))
* **tag-analysis:** increase max entities per request and adjust related token calculations ([6fd39c1](https://github.com/TestPlanIt/testplanit/commit/6fd39c1cc8bf1b4defb13d30f92c3cf8ee2f15e5))
* **test-case-versions:** update CaseDisplay size prop from 'large' to 'xl' ([d806c51](https://github.com/TestPlanIt/testplanit/commit/d806c519d1dc06d94029ad9ff6e0c2b5e7189238))
* **translations:** add children warning messages for milestone deletion in multiple languages ([a49ab6e](https://github.com/TestPlanIt/testplanit/commit/a49ab6eaff2013d7fb81fde460420c647954622c))
* **trigger-registry:** expand denylist for WebhookConfig to include additional telemetry fields ([0b941ce](https://github.com/TestPlanIt/testplanit/commit/0b941ce4db97115b5783eb96270dd804f88d0bc3))
* **ui:** translucent virtualized-table header and sort-icon cursor ([a769218](https://github.com/TestPlanIt/testplanit/commit/a769218ea29290e47c0936913407ca55b6f23306))
* **webhooks:** add event filter to deliveries tab ([7f717bd](https://github.com/TestPlanIt/testplanit/commit/7f717bd1716cee22c4473c9e4b7e8d86e708c3c4))

### Performance Improvements

* **acl:** cache the accessible-project resolution for 60s ([0bc0233](https://github.com/TestPlanIt/testplanit/commit/0bc0233748aa327ab4e47ca3acb57dd9f9e2a611))
* **acl:** resolve project access once per request via AuthCtx ([#540](https://github.com/TestPlanIt/testplanit/issues/540)) ([2938af4](https://github.com/TestPlanIt/testplanit/commit/2938af44cc3453fa2ebd3c642ca3a994c694d2be))
* **auth:** read both mid-session guards in one query, in both callbacks ([a9daac0](https://github.com/TestPlanIt/testplanit/commit/a9daac0671accbef4fa9a4ff555a3321ba88f2f6))
* **build:** right-size Node heap caps for install and build ([#507](https://github.com/TestPlanIt/testplanit/issues/507)) ([fcb6416](https://github.com/TestPlanIt/testplanit/commit/fcb6416df7e10e136c672c4402b520c84e8c875b))
* **db:** compute project-relevant issue ids from the small side ([#482](https://github.com/TestPlanIt/testplanit/issues/482)) ([7352e0b](https://github.com/TestPlanIt/testplanit/commit/7352e0b849f2d3f67b0eeb2113e9c13dce02592e))
* **db:** drive issue/tag count queries from the small side (v3 EXISTS scans) ([#480](https://github.com/TestPlanIt/testplanit/issues/480)) ([d97ceb8](https://github.com/TestPlanIt/testplanit/commit/d97ceb8175b4099388294887580037a0584eeb87))
* **db:** index foreign-key columns missing an index ([#477](https://github.com/TestPlanIt/testplanit/issues/477)) ([21b65c3](https://github.com/TestPlanIt/testplanit/commit/21b65c34ff08a7669d2d1d42d575e4819fd18b0d))
* **db:** index Issue tracker-key lookups ([611c240](https://github.com/TestPlanIt/testplanit/commit/611c240f930dedce3f9e4672268927b281ec5fbf))
* **db:** make DataChangeLog poll index partial (WHERE processed = false) ([#481](https://github.com/TestPlanIt/testplanit/issues/481)) ([14c932e](https://github.com/TestPlanIt/testplanit/commit/14c932e3bc4ae6aa42fed3ef5c1d2f6455ed14c6))
* **db:** two-phase paginated reads to bound v3 relation hydration to the page ([43bff9f](https://github.com/TestPlanIt/testplanit/commit/43bff9fdafd1de72ca4a07416ca56f8583c7c550))
* fix prod query bottlenecks in Jira panel and project tag counts ([1826d25](https://github.com/TestPlanIt/testplanit/commit/1826d2576580d3c0b786d6ba5769378d78f32a97))
* **jira:** filter milestone preview upstream; report gateway errors properly ([ac6eaa2](https://github.com/TestPlanIt/testplanit/commit/ac6eaa23e3336644dd74fb8facd2f02f6eb0a155))
* **requirements:** scope the detail route's breadcrumb and count to one requirement ([34d2152](https://github.com/TestPlanIt/testplanit/commit/34d2152ee68a692dfc3c5376138da5c3a50c70a8))
* **runs:** move case-detail fetch off ACL-policy path for Pass & Next ([120fc67](https://github.com/TestPlanIt/testplanit/commit/120fc6759c0baf8912a92057fc9dacbc80568b49))
* **users:** load the user lists on scroll and resolve accessible projects in batches ([2e93685](https://github.com/TestPlanIt/testplanit/commit/2e936857eaf8533bf3d16da5c682d18e6d542718))
* **workflows:** stop eager-fetching every project assignment in admin table ([6262e30](https://github.com/TestPlanIt/testplanit/commit/6262e30bb42c96a3e953736aa70360a8c5d92764))
## [1.0.9](https://github.com/TestPlanIt/testplanit/compare/v1.0.8...v1.0.9) (2026-09-12)

### Bug Fixes

* **mcp:** store result notes as rich text and document elapsed in seconds ([#642](https://github.com/TestPlanIt/testplanit/issues/642)) ([1b4bf39](https://github.com/TestPlanIt/testplanit/commit/1b4bf39af86bce705de7cec6623745a8e9e6bbc2)), closes [#639](https://github.com/TestPlanIt/testplanit/issues/639) [#640](https://github.com/TestPlanIt/testplanit/issues/640)

## [1.0.8](https://github.com/TestPlanIt/testplanit/compare/v1.0.7...v1.0.8) (2026-09-12)

### Bug Fixes

* **milestones:** save without a default type and keep every catalog's default ([#641](https://github.com/TestPlanIt/testplanit/issues/641)) ([8b44ecc](https://github.com/TestPlanIt/testplanit/commit/8b44ecc92436ee5e8ec05a3c4a1611b00e07156d)), closes [#638](https://github.com/TestPlanIt/testplanit/issues/638)

## [1.0.7](https://github.com/TestPlanIt/testplanit/compare/v1.0.6...v1.0.7) (2026-09-10)

### Bug Fixes

* **editor:** skip the read-only content sync on a destroyed editor ([#637](https://github.com/TestPlanIt/testplanit/issues/637)) ([41ebc02](https://github.com/TestPlanIt/testplanit/commit/41ebc028827a028bed23da9d8cfadcbcb46fdb1e))

## [1.0.6](https://github.com/TestPlanIt/testplanit/compare/v1.0.5...v1.0.6) (2026-09-09)

### Bug Fixes

* **search:** aggregate repository case facets on their keyword fields ([#633](https://github.com/TestPlanIt/testplanit/issues/633)) ([450be83](https://github.com/TestPlanIt/testplanit/commit/450be83c1ee7632401ccabfd21cbee834f2a6372))

## [1.0.5](https://github.com/TestPlanIt/testplanit/compare/v1.0.4...v1.0.5) (2026-09-09)

### Bug Fixes

* **jira:** hide deleted test cases with no results from the issue panel ([#629](https://github.com/TestPlanIt/testplanit/issues/629)) ([1bc41ee](https://github.com/TestPlanIt/testplanit/commit/1bc41ee2aca485ed1a5ac5ef06be7203940f4daa))

## [1.0.4](https://github.com/TestPlanIt/testplanit/compare/v1.0.3...v1.0.4) (2026-09-09)

### Bug Fixes

* **import:** keep JSON test steps intact on manual create and CSV import ([#630](https://github.com/TestPlanIt/testplanit/issues/630)) ([748114f](https://github.com/TestPlanIt/testplanit/commit/748114f49044b89152a283a967a10adff09b2166))

## [1.0.3](https://github.com/TestPlanIt/testplanit/compare/v1.0.2...v1.0.3) (2026-09-08)

### Bug Fixes

* **deploy:** stop worker bundles starting extra workers and unstick migrate deploy on fresh databases ([#627](https://github.com/TestPlanIt/testplanit/issues/627)) ([49afe64](https://github.com/TestPlanIt/testplanit/commit/49afe641c66645a988cc03cd665ed3943d75f500))

## [1.0.2](https://github.com/TestPlanIt/testplanit/compare/v1.0.1...v1.0.2) (2026-09-08)

### Features

* **release:** publish the Helm chart alongside the self-host images ([#621](https://github.com/TestPlanIt/testplanit/issues/621)) ([6186511](https://github.com/TestPlanIt/testplanit/commit/618651123dabd67c10fc879182a98b36434da610))

### Bug Fixes

* **import:** import steps that have no expected result ([#626](https://github.com/TestPlanIt/testplanit/issues/626)) ([5bb98b8](https://github.com/TestPlanIt/testplanit/commit/5bb98b8d7453b1e34461b8ddf8b50f8732f52ec7))
* **release:** dispatch the self-host image build on every release ([#619](https://github.com/TestPlanIt/testplanit/issues/619)) ([661ce5b](https://github.com/TestPlanIt/testplanit/commit/661ce5b8a53ee3e6d6424841e3edbdf6b2648bf5))

## [1.0.1](https://github.com/TestPlanIt/testplanit/compare/v1.0.0...v1.0.1) (2026-09-08)

### Bug Fixes

* **deps:** pin the conventionalcommits preset to the line semantic-release supports ([#616](https://github.com/TestPlanIt/testplanit/issues/616)) ([ab158e3](https://github.com/TestPlanIt/testplanit/commit/ab158e3c736e88790ef57afb612a1f4ce05c32b8))
* **helm:** track the app release line in the chart version ([#615](https://github.com/TestPlanIt/testplanit/issues/615)) ([5d34f08](https://github.com/TestPlanIt/testplanit/commit/5d34f08f33d922b11708ceaa45e94e456f9a3ee9))

## [1.0.0](https://github.com/TestPlanIt/testplanit/compare/v0.44.3...v1.0.0) (2026-09-08)

TestPlanIt 1.0 graduates the `beta` line — 21 pre-releases and 725 commits since
v0.44.3 — and completes the feature set the platform set out to build. See the
[1.0 release announcement](https://docs.testplanit.com/blog/v1.0-release) for the
full write-up.

From here on the project follows semantic versioning: breaking changes mean a
major version, and upgrades within 1.x are routine.

### Upgrading

**Back up your database first.** 1.0 moves schema changes to versioned
migrations, and a database created by a 0.x release needs a one-time baseline
step before its first v1.0 start — see the
[upgrade notes](https://docs.testplanit.com/docs/installation#upgrading).

### Features

* **jira:** milestone sync, a release-readiness cockpit with burndown and per-case traceability, AI generation from the issue panel, and self-refreshing OAuth
* **ai:** image context for generation — screenshots from linked issues, embedded rich-text images, and crawled pages — across every connected provider
* **automation:** per-run execution metrics, an execution timeline, retry-aware flaky detection, and automated status resolved through a single effective-status source
* **repository:** a dockable case-details panel, a sortable latest-result column, reorderable and resizable columns, multi-dimension filters with shareable URLs, and saved views
* **reviews:** bulk approval requests, a dedicated review inbox with decision badges, and a pending queue with reminders
* **runs:** composition lock at execution start, even assignment distribution, in-place case editing mid-run, and ready-to-complete notifications
* **platform:** official Docker images and a single-tenant Helm chart, opt-in read-replica routing, and configurable API rate limits and upload ceilings
* **i18n:** 17 languages, including full right-to-left support for Arabic

### Performance Improvements

* **data-layer:** access control enforced at the query layer with two-phase pagination — the heaviest lists drop from ~22s to ~270ms
* **acl:** project access resolved once per request instead of re-asked per query
* **lists:** runs, users, and audit logs window, prefetch, and stream on scroll

### Bug Fixes

* **search:** indexing moved to post-commit sync so results always match the database, and deletes remove their documents
* **audit:** correct actor attribution including API tokens, rich-text edits captured, and integration credentials encrypted on every write path
* **live-updates:** no reconnect refetch storms; connections defer until the browser is idle
* **webhooks:** Issue events reach every linked project, and deliveries show which record each one was about
* **a11y:** an Accessible Dark theme meeting WCAG AA, enforced by a CI contrast gate

## [0.44.3](https://github.com/TestPlanIt/testplanit/compare/v0.44.2...v0.44.3) (2026-08-12)

### Bug Fixes

* **integrations:** accept cleartext credentials, refuse only undecryptable ones ([#583](https://github.com/TestPlanIt/testplanit/issues/583)) ([8c38285](https://github.com/TestPlanIt/testplanit/commit/8c38285a6968987755a852d931c7ac8981f4539a))

## [0.44.2](https://github.com/TestPlanIt/testplanit/compare/v0.44.1...v0.44.2) (2026-08-12)

### Bug Fixes

* **integrations:** stop using unreadable credentials and return actionable errors ([#580](https://github.com/TestPlanIt/testplanit/issues/580)) ([6d1080f](https://github.com/TestPlanIt/testplanit/commit/6d1080f77bc49b449ef7298c34ff97f4b8612977))

## [0.44.1](https://github.com/TestPlanIt/testplanit/compare/v0.44.0...v0.44.1) (2026-08-10)

### Bug Fixes

* **api:** stop losing results when parallel workers race to create the same folder ([#564](https://github.com/TestPlanIt/testplanit/issues/564)) ([ba7e7a5](https://github.com/TestPlanIt/testplanit/commit/ba7e7a504e31ed723bf7fc72850173a6111f2cfa))
* **deps:** resolve 13 of 15 open Dependabot alerts ([#578](https://github.com/TestPlanIt/testplanit/issues/578)) ([8a4e5cd](https://github.com/TestPlanIt/testplanit/commit/8a4e5cd556b10387055e080eebdc154347bc6742))

## [0.44.0](https://github.com/TestPlanIt/testplanit/compare/v0.43.0...v0.44.0) (2026-08-01)

### Features

* **cli:** add run create and complete, resolving the duplicate testplanit bin ([#559](https://github.com/TestPlanIt/testplanit/issues/559)) ([44a46c5](https://github.com/TestPlanIt/testplanit/commit/44a46c5d0b404420ceb05c044aed37c50694dad1))
* **reporters:** attach every Playwright execution to one externally managed run ([#557](https://github.com/TestPlanIt/testplanit/issues/557)) ([7fd2bcb](https://github.com/TestPlanIt/testplanit/commit/7fd2bcbafb2603e0b4f7fb3ce5931195827a70b8))
* **reporters:** attach every wdio invocation to one externally managed run ([#555](https://github.com/TestPlanIt/testplanit/issues/555)) ([9f838ab](https://github.com/TestPlanIt/testplanit/commit/9f838ab3ff546166b25d96db6d944da2c9d3465d))

### Bug Fixes

* **deps:** resolve all 40 open Dependabot alerts ([#563](https://github.com/TestPlanIt/testplanit/issues/563)) ([194e35d](https://github.com/TestPlanIt/testplanit/commit/194e35d2c1c8c9d1e60eaaafbf10482f6f52867c))
* **wdio-reporter:** export the service-created run id to forked workers ([#560](https://github.com/TestPlanIt/testplanit/issues/560)) ([34c8079](https://github.com/TestPlanIt/testplanit/commit/34c8079e00c325df6af7955babfbade8a5a064fb))

## [0.43.0](https://github.com/TestPlanIt/testplanit/compare/v0.42.0...v0.43.0) (2026-07-28)

### Features

* **reporters:** add excludeSkipped option to omit skipped results from runs ([#550](https://github.com/TestPlanIt/testplanit/issues/550)) ([5145332](https://github.com/TestPlanIt/testplanit/commit/51453327f9750da7bee8eea4c7a663936f2e8474))
* **reporters:** attach links, files, and metadata to the test run itself ([#548](https://github.com/TestPlanIt/testplanit/issues/548)) ([65a5452](https://github.com/TestPlanIt/testplanit/commit/65a545262b02a39bf31b73cfcd9439b4d5c258f7))

### Bug Fixes

* **integrations:** transfer description images to created issues as attachments ([#554](https://github.com/TestPlanIt/testplanit/issues/554)) ([1e0f60f](https://github.com/TestPlanIt/testplanit/commit/1e0f60f7e3ada757b9cc81448c9b6d29201df269)), closes [#553](https://github.com/TestPlanIt/testplanit/issues/553)

## [0.42.0](https://github.com/TestPlanIt/testplanit/compare/v0.41.6...v0.42.0) (2026-07-25)

### Features

* **wdio-reporter:** mark matched cases automated ([#526](https://github.com/TestPlanIt/testplanit/issues/526)) ([9c2fc5c](https://github.com/TestPlanIt/testplanit/commit/9c2fc5c5df41393cb29996d4233b5a86d14f3128))
* **wdio-reporter:** resolve cases by a custom field value ([#521](https://github.com/TestPlanIt/testplanit/issues/521)) ([53f406b](https://github.com/TestPlanIt/testplanit/commit/53f406b78f60766e07b6f2c4783b33aa020d32b2))

### Enhancements

* **workers:** cache tenant configs and back off idle multi-tenant polling ([#542](https://github.com/TestPlanIt/testplanit/issues/542)) ([843c86b](https://github.com/TestPlanIt/testplanit/commit/843c86bbab6dc85dce146c6c114d9752e6cb456d))

## [0.41.6](https://github.com/TestPlanIt/testplanit/compare/v0.41.5...v0.41.6) (2026-07-10)

### Bug Fixes

* **jira:** Jira Server / Data Center support (REST v2, PAT/Basic auth, wiki markup) ([#510](https://github.com/TestPlanIt/testplanit/issues/510)) ([c18d812](https://github.com/TestPlanIt/testplanit/commit/c18d812cbc488a83a71b43ceb00b742a41d0edf2))

## [0.41.5](https://github.com/TestPlanIt/testplanit/compare/v0.41.4...v0.41.5) (2026-07-10)

### Performance Improvements

* **build:** right-size Node heap caps and update memory docs ([#513](https://github.com/TestPlanIt/testplanit/issues/513)) ([05de4b6](https://github.com/TestPlanIt/testplanit/commit/05de4b6942c82a68133cae69dddca114d6652585)), closes [#511](https://github.com/TestPlanIt/testplanit/issues/511)

## [0.41.4](https://github.com/TestPlanIt/testplanit/compare/v0.41.3...v0.41.4) (2026-07-10)

### Performance Improvements

* **zenstack:** stop generating unused CRUD input schemas — 12.6 GB -> 2.5 GB, 4.5 min -> 40 s ([#511](https://github.com/TestPlanIt/testplanit/issues/511)) ([02d48a2](https://github.com/TestPlanIt/testplanit/commit/02d48a2db030e48b19499f29e7712318cb005c60))

## [0.41.3](https://github.com/TestPlanIt/testplanit/compare/v0.41.2...v0.41.3) (2026-07-08)

### Bug Fixes

* **audit:** stop FK-poison re-poll loop in CDC audit-log writer ([#503](https://github.com/TestPlanIt/testplanit/issues/503)) ([b87f29f](https://github.com/TestPlanIt/testplanit/commit/b87f29ff8cc502220ef32eed7191665d49119c92))

## [0.41.2](https://github.com/TestPlanIt/testplanit/compare/v0.41.1...v0.41.2) (2026-07-07)

### Enhancements

* **auth:** enter an existing sign-in code from the Magic Link dialog ([#498](https://github.com/TestPlanIt/testplanit/issues/498)) ([ff7bce4](https://github.com/TestPlanIt/testplanit/commit/ff7bce44e0748e0cc0ce35a6bd3d7db1977786dd))

## [0.41.1](https://github.com/TestPlanIt/testplanit/compare/v0.41.0...v0.41.1) (2026-07-07)

### Enhancements

* **auth:** device-bound magic-link sign-in with OTP fallback ([#497](https://github.com/TestPlanIt/testplanit/issues/497)) ([a8a1def](https://github.com/TestPlanIt/testplanit/commit/a8a1deffd3f532dfdf51b6beaa0e10cd2f947bef))

## [0.41.0](https://github.com/TestPlanIt/testplanit/compare/v0.40.14...v0.41.0) (2026-07-05)

### Features

* **integrations:** bulk-import external issues into a project with a scoped filter ([#493](https://github.com/TestPlanIt/testplanit/issues/493)) ([06ecab7](https://github.com/TestPlanIt/testplanit/commit/06ecab7d21af1a727a38dda5f800a70deeb4cc40)), closes [#452](https://github.com/TestPlanIt/testplanit/issues/452)

## [0.40.14](https://github.com/TestPlanIt/testplanit/compare/v0.40.13...v0.40.14) (2026-07-03)

### Bug Fixes

* **ssrf:** block IPv4-mapped IPv6 bypass and pin git-repo connections ([#491](https://github.com/TestPlanIt/testplanit/issues/491)) ([6c77a7d](https://github.com/TestPlanIt/testplanit/commit/6c77a7d362ca0d70c284fa2304c782ce6bb5157c))

## [0.40.13](https://github.com/TestPlanIt/testplanit/compare/v0.40.12...v0.40.13) (2026-07-02)

### Bug Fixes

* **docker:** move Postgres to a named volume and bump to Postgres 18 ([#486](https://github.com/TestPlanIt/testplanit/issues/486)) ([a8da511](https://github.com/TestPlanIt/testplanit/commit/a8da511f68eac52eaf8beff8eb806a53b1c9056e)), closes [#485](https://github.com/TestPlanIt/testplanit/issues/485) [docker-library/postgres#1259](https://github.com/docker-library/postgres/issues/1259) [docker-library/postgres#1400](https://github.com/docker-library/postgres/issues/1400)

## [0.40.12](https://github.com/TestPlanIt/testplanit/compare/v0.40.11...v0.40.12) (2026-06-30)

### Bug Fixes

* **copy-move:** create distinct cases instead of resurrecting tombstones on copy ([#484](https://github.com/TestPlanIt/testplanit/issues/484)) ([4e92f45](https://github.com/TestPlanIt/testplanit/commit/4e92f45968d56de307d6135eaf7a86e064b9dbd4)), closes [LinkifyIt#match](https://github.com/TestPlanIt/LinkifyIt/issues/match)

## [0.40.11](https://github.com/TestPlanIt/testplanit/compare/v0.40.10...v0.40.11) (2026-06-29)

### Bug Fixes

* **forecast:** ignore soft-deleted test cases in forecast calculations ([#478](https://github.com/TestPlanIt/testplanit/issues/478)) ([4b6a92a](https://github.com/TestPlanIt/testplanit/commit/4b6a92a342afa2f22031d62f1440e1c615dd7da8))

## [0.40.10](https://github.com/TestPlanIt/testplanit/compare/v0.40.9...v0.40.10) (2026-06-26)

### Bug Fixes

* **imports:** use stream-json v3 lowercase assembler.js path ([#473](https://github.com/TestPlanIt/testplanit/issues/473)) ([0cfe557](https://github.com/TestPlanIt/testplanit/commit/0cfe557f35761f9cef45ea82be23e30348a0f733))

## [0.40.9](https://github.com/TestPlanIt/testplanit/compare/v0.40.8...v0.40.9) (2026-06-24)

### Bug Fixes

* **audit:** bundling-safe CLI guard in apply-triggers (stop worker crash-loop) ([#469](https://github.com/TestPlanIt/testplanit/issues/469)) ([474f188](https://github.com/TestPlanIt/testplanit/commit/474f1883029db5e812af84ddc886d9632342ca2a))

## [0.40.8](https://github.com/TestPlanIt/testplanit/compare/v0.40.7...v0.40.8) (2026-06-24)

### Bug Fixes

* **seed:** preserve admin-selected defaults across re-seeds ([#468](https://github.com/TestPlanIt/testplanit/issues/468)) ([ead6c69](https://github.com/TestPlanIt/testplanit/commit/ead6c6960ac5af3afc69c4eef866bb09b3d219ad))

## [0.40.7](https://github.com/TestPlanIt/testplanit/compare/v0.40.6...v0.40.7) (2026-06-23)

### Bug Fixes

* **audit:** stop silent audit-capture loss — self-heal triggers on every boot ([#467](https://github.com/TestPlanIt/testplanit/issues/467)) ([d024ffc](https://github.com/TestPlanIt/testplanit/commit/d024ffcbf6a693e6ae5a2bebe756c247ca37b6eb))

## [0.40.6](https://github.com/TestPlanIt/testplanit/compare/v0.40.5...v0.40.6) (2026-06-23)

### Enhancements

* **audit:** comprehensive audit logging with inline activity views ([#466](https://github.com/TestPlanIt/testplanit/issues/466)) ([4933e51](https://github.com/TestPlanIt/testplanit/commit/4933e515f0f4bf7380e6d0af7eeab3208f579403)), closes [#441](https://github.com/TestPlanIt/testplanit/issues/441)

## [0.40.5](https://github.com/TestPlanIt/testplanit/compare/v0.40.4...v0.40.5) (2026-06-23)

### Bug Fixes

* **integrations:** keep Jira reads working past token expiry and persist created issues ([#465](https://github.com/TestPlanIt/testplanit/issues/465)) ([0c774a2](https://github.com/TestPlanIt/testplanit/commit/0c774a28d7e808d197b8f244694a0b89e0c7d268))

## [0.40.4](https://github.com/TestPlanIt/testplanit/compare/v0.40.3...v0.40.4) (2026-06-22)

### Bug Fixes

* **i18n:** translate single-use magic-link strings across locales ([18eada4](https://github.com/TestPlanIt/testplanit/commit/18eada4b432902c096caf4eedd0ab46aeb1873d9))

## [0.40.3](https://github.com/TestPlanIt/testplanit/compare/v0.40.2...v0.40.3) (2026-06-22)

### Bug Fixes

* Jira OAuth callback/adapter fixes + single-use magic-link notice ([#464](https://github.com/TestPlanIt/testplanit/issues/464)) ([2dbfdfb](https://github.com/TestPlanIt/testplanit/commit/2dbfdfb750e1d35b4bf945e4302336dd499a6059))

## [0.40.2](https://github.com/TestPlanIt/testplanit/compare/v0.40.1...v0.40.2) (2026-06-22)

### Bug Fixes

* **integrations:** unblock Jira OAuth authorize + align admin action icons ([#463](https://github.com/TestPlanIt/testplanit/issues/463)) ([d7dae8c](https://github.com/TestPlanIt/testplanit/commit/d7dae8c4be81cf9a43c83d88aaf0b86452bca400))

## [0.40.1](https://github.com/TestPlanIt/testplanit/compare/v0.40.0...v0.40.1) (2026-06-21)

### Bug Fixes

* **integrations:** configure Jira OAuth per-integration via admin UI ([#462](https://github.com/TestPlanIt/testplanit/issues/462)) ([7a0d08e](https://github.com/TestPlanIt/testplanit/commit/7a0d08eba7fbd90a8e8905ec46de9e897dd8b5dc))

## [0.40.0](https://github.com/TestPlanIt/testplanit/compare/v0.39.2...v0.40.0) (2026-06-20)

### Features

* **api:** add createTestCases for bulk case creation ([#459](https://github.com/TestPlanIt/testplanit/issues/459)) ([79c4db0](https://github.com/TestPlanIt/testplanit/commit/79c4db008dc0d021844a1aaf60c6e790f750582f))

### Bug Fixes

* **deps:** patch Dependabot security advisories ([#461](https://github.com/TestPlanIt/testplanit/issues/461)) ([e40c94e](https://github.com/TestPlanIt/testplanit/commit/e40c94e6f487769694249a7b0ff57d0ebd954fd2)), closes [package.json#pnpm](https://github.com/TestPlanIt/package.json/issues/pnpm)

## [0.39.2](https://github.com/TestPlanIt/testplanit/compare/v0.39.1...v0.39.2) (2026-06-20)

### Bug Fixes

* **tags:** persist tag selections in the case and session editors ([#456](https://github.com/TestPlanIt/testplanit/issues/456)) ([4fc7f90](https://github.com/TestPlanIt/testplanit/commit/4fc7f9009abaf552cce613f38af86cc33a1e1b20))

## [0.39.1](https://github.com/TestPlanIt/testplanit/compare/v0.39.0...v0.39.1) (2026-06-20)

### Bug Fixes

* **repository:** prevent test case edit crash from null dropdown option colors ([#455](https://github.com/TestPlanIt/testplanit/issues/455)) ([61a4dfe](https://github.com/TestPlanIt/testplanit/commit/61a4dfea6f2a0ebf1ebb6d4f9d7416ad617717ca))

## [0.39.0](https://github.com/TestPlanIt/testplanit/compare/v0.38.10...v0.39.0) (2026-06-20)

### Features

* **mcp:** bulk case creation and template selection/listing ([#454](https://github.com/TestPlanIt/testplanit/issues/454)) ([a696255](https://github.com/TestPlanIt/testplanit/commit/a6962558066d01eb0f2bcbae857f276e819fd0e3))

## [0.38.10](https://github.com/TestPlanIt/testplanit/compare/v0.38.9...v0.38.10) (2026-06-20)

### Bug Fixes

* folder-scoped case selection, bulk-edit issue unlink + version snapshots, and sync-button clarity ([#453](https://github.com/TestPlanIt/testplanit/issues/453)) ([37eda9b](https://github.com/TestPlanIt/testplanit/commit/37eda9bb8d674e58e996e3be7ce298e5c3e4ae23))

## [0.38.9](https://github.com/TestPlanIt/testplanit/compare/v0.38.8...v0.38.9) (2026-06-19)

### Bug Fixes

* **docker:** include @testplanit/api dist in image build context ([#451](https://github.com/TestPlanIt/testplanit/issues/451)) ([578587c](https://github.com/TestPlanIt/testplanit/commit/578587cb10e179508d9504ebfa4904ff4669a763))

## [0.38.8](https://github.com/TestPlanIt/testplanit/compare/v0.38.7...v0.38.8) (2026-06-19)

### Bug Fixes

* **docker:** copy pnpm patches into image build context ([#450](https://github.com/TestPlanIt/testplanit/issues/450)) ([ee26f4d](https://github.com/TestPlanIt/testplanit/commit/ee26f4d084c0163d85bc33f22846325a0f8b1a88))

## [0.38.7](https://github.com/TestPlanIt/testplanit/compare/v0.38.6...v0.38.7) (2026-06-19)

### Bug Fixes

* **access:** honor project default access on project-scoped child models ([#449](https://github.com/TestPlanIt/testplanit/issues/449)) ([2182e79](https://github.com/TestPlanIt/testplanit/commit/2182e795e75686fd8983a4cbf299b7e2f8c26f9c))
* **deps:** bump multer to 2.2.0 and webpack-dev-server to 5.2.5 ([#446](https://github.com/TestPlanIt/testplanit/issues/446)) ([a107ba8](https://github.com/TestPlanIt/testplanit/commit/a107ba85232d659df5b2452e80ce5e30df7d1336)), closes [#428](https://github.com/TestPlanIt/testplanit/issues/428) [#427](https://github.com/TestPlanIt/testplanit/issues/427) [#429](https://github.com/TestPlanIt/testplanit/issues/429) [#421](https://github.com/TestPlanIt/testplanit/issues/421)

## [0.38.6](https://github.com/TestPlanIt/testplanit/compare/v0.38.5...v0.38.6) (2026-06-18)

### Bug Fixes

* **deps:** patch Dependabot security advisories ([#443](https://github.com/TestPlanIt/testplanit/issues/443)) ([f13a7b5](https://github.com/TestPlanIt/testplanit/commit/f13a7b5a371393ced51b2d52ef0811d1e1ec3ae6)), closes [package.json#pnpm](https://github.com/TestPlanIt/package.json/issues/pnpm)

### Enhancements

* **playwright-reporter:** capture test.step() as case steps (+ E2E conversion, test-run live-update fix) ([#444](https://github.com/TestPlanIt/testplanit/issues/444)) ([ea8f7cd](https://github.com/TestPlanIt/testplanit/commit/ea8f7cd199dc239bb105cb876bc4120dff43827e))

## [0.38.5](https://github.com/TestPlanIt/testplanit/compare/v0.38.4...v0.38.5) (2026-06-16)

### Bug Fixes

* add table role to virtualized tables (a11y) + avoid spurious redirect on cold-session loads ([#442](https://github.com/TestPlanIt/testplanit/issues/442)) ([d31b9a7](https://github.com/TestPlanIt/testplanit/commit/d31b9a739786d07d6faac3e4b0b3f4043d0a0443)), closes [#441](https://github.com/TestPlanIt/testplanit/issues/441)

## [0.38.4](https://github.com/TestPlanIt/testplanit/compare/v0.38.3...v0.38.4) (2026-06-16)

### Enhancements

* **audit:** per-user activity view, shared virtualized table, and searchable filters ([#441](https://github.com/TestPlanIt/testplanit/issues/441)) ([360eeea](https://github.com/TestPlanIt/testplanit/commit/360eeea593313b42dfb2212dac760c27c140a307))

## [0.38.3](https://github.com/TestPlanIt/testplanit/compare/v0.38.2...v0.38.3) (2026-06-15)

### Bug Fixes

* **llm:** generate test case names in the configured prompt language ([#440](https://github.com/TestPlanIt/testplanit/issues/440)) ([8c236fb](https://github.com/TestPlanIt/testplanit/commit/8c236fb5a4297ceddf98e3e4eb63257b1cf1b128))

## [0.38.2](https://github.com/TestPlanIt/testplanit/compare/v0.38.1...v0.38.2) (2026-06-14)

### Enhancements

* **integrations:** add MantisBT issue tracker integration ([#438](https://github.com/TestPlanIt/testplanit/issues/438)) ([3f36178](https://github.com/TestPlanIt/testplanit/commit/3f36178af7ce5260044dd13d64169ed35434d02f))

## [0.38.1](https://github.com/TestPlanIt/testplanit/compare/v0.38.0...v0.38.1) (2026-06-14)

### Bug Fixes

* **runs:** stop test run list rows from overflowing and overlapping ([#437](https://github.com/TestPlanIt/testplanit/issues/437)) ([4e705be](https://github.com/TestPlanIt/testplanit/commit/4e705be2c8383ec01f0462642c4930b6630abb8e))

## [0.38.0](https://github.com/TestPlanIt/testplanit/compare/v0.37.15...v0.38.0) (2026-06-13)

### Features

* **jira:** generate test cases from the Jira issue panel ([#436](https://github.com/TestPlanIt/testplanit/issues/436)) ([fabdaca](https://github.com/TestPlanIt/testplanit/commit/fabdacaf74d1cd9b4fe706fb720d038d097aac39))

## [0.37.15](https://github.com/TestPlanIt/testplanit/compare/v0.37.14...v0.37.15) (2026-06-13)

### Bug Fixes

* **workers:** raise scim-access-recompute-worker memory ceiling ([#435](https://github.com/TestPlanIt/testplanit/issues/435)) ([81206de](https://github.com/TestPlanIt/testplanit/commit/81206de6ac798dfde0679eca9cc4c43b5834f0e9))

## [0.37.14](https://github.com/TestPlanIt/testplanit/compare/v0.37.13...v0.37.14) (2026-06-13)

### Bug Fixes

* **ci:** re-trigger Semantic Release after Crowdin sync so raced releases still publish ([#433](https://github.com/TestPlanIt/testplanit/issues/433)) ([c010479](https://github.com/TestPlanIt/testplanit/commit/c01047975ec58703c92844a2792aae163fa712b1))

### Enhancements

* **search:** add named saved searches to unified search ([#434](https://github.com/TestPlanIt/testplanit/issues/434)) ([f7f381c](https://github.com/TestPlanIt/testplanit/commit/f7f381cce9cbfdbb68d16dcf95c6fc7cb158af45))

## [0.37.12](https://github.com/TestPlanIt/testplanit/compare/v0.37.11...v0.37.12) (2026-06-12)

### Enhancements

* **tables:** remember column selection per view ([#431](https://github.com/TestPlanIt/testplanit/issues/431)) ([bc8be42](https://github.com/TestPlanIt/testplanit/commit/bc8be4288863d5b38b4e283cc2f2c6d57f8539d6))

## [0.37.11](https://github.com/TestPlanIt/testplanit/compare/v0.37.10...v0.37.11) (2026-06-12)

### Enhancements

* **scim:** SCIM group→access mapping + canonical /api/scim/v2 URLs ([#427](https://github.com/TestPlanIt/testplanit/issues/427)) ([0fcd1e6](https://github.com/TestPlanIt/testplanit/commit/0fcd1e63529c25833ad4d91d02584038db1c304a))

## [0.37.10](https://github.com/TestPlanIt/testplanit/compare/v0.37.9...v0.37.10) (2026-06-12)

### Bug Fixes

* **issues:** persist external ID for in-app Simple URL issues ([#428](https://github.com/TestPlanIt/testplanit/issues/428)) ([9e23943](https://github.com/TestPlanIt/testplanit/commit/9e239432d817417f7e5ff3bbdefca1dc7de918c7))

## [0.37.9](https://github.com/TestPlanIt/testplanit/compare/v0.37.8...v0.37.9) (2026-06-11)

### Enhancements

* **reports:** CSV export of report results ([#426](https://github.com/TestPlanIt/testplanit/issues/426)) ([3e168ff](https://github.com/TestPlanIt/testplanit/commit/3e168ffa96ca69ae1938268ea584c67be30eab3b))

## [0.37.8](https://github.com/TestPlanIt/testplanit/compare/v0.37.7...v0.37.8) (2026-06-11)

### Enhancements

* **reports:** virtual scrolling + infinite list for report tables ([#425](https://github.com/TestPlanIt/testplanit/issues/425)) ([1c74431](https://github.com/TestPlanIt/testplanit/commit/1c74431928e3e4bae073f8b417b7fcc7d0999d0d))

## [0.37.7](https://github.com/TestPlanIt/testplanit/compare/v0.37.6...v0.37.7) (2026-06-11)

### Enhancements

* **db:** route startup schema sync to a direct connection for pgbouncer ([#422](https://github.com/TestPlanIt/testplanit/issues/422)) ([a672e8f](https://github.com/TestPlanIt/testplanit/commit/a672e8f43424236db2841e76569b64c51355b269))

## [0.37.6](https://github.com/TestPlanIt/testplanit/compare/v0.37.5...v0.37.6) (2026-06-11)

### Enhancements

* **search:** virtual scrolling + infinite list for unified search ([#424](https://github.com/TestPlanIt/testplanit/issues/424)) ([5454379](https://github.com/TestPlanIt/testplanit/commit/5454379c11c6f11506b2fc8451ab192e34b2133f))

## [0.37.5](https://github.com/TestPlanIt/testplanit/compare/v0.37.4...v0.37.5) (2026-06-10)

### Bug Fixes

* **quickscript:** depth-bound repo scans and run cache refresh in a worker ([#423](https://github.com/TestPlanIt/testplanit/issues/423)) ([4a299c1](https://github.com/TestPlanIt/testplanit/commit/4a299c1da2971549e57e100d675d19ccc054ae55))

## [0.37.4](https://github.com/TestPlanIt/testplanit/compare/v0.37.3...v0.37.4) (2026-06-10)

### Enhancements

* **webhooks:** rich Slack formatting for all webhook events ([#421](https://github.com/TestPlanIt/testplanit/issues/421)) ([b060bae](https://github.com/TestPlanIt/testplanit/commit/b060bae413601091ca7f10541071c4625b1127e3))

## [0.37.3](https://github.com/TestPlanIt/testplanit/compare/v0.37.2...v0.37.3) (2026-06-10)

### Enhancements

* **quickscript:** resilient repo scans with rate-limit backoff ([#420](https://github.com/TestPlanIt/testplanit/issues/420)) ([20f1335](https://github.com/TestPlanIt/testplanit/commit/20f1335d71928a554628c5cd154570d09bddb84e))

## [0.37.2](https://github.com/TestPlanIt/testplanit/compare/v0.37.1...v0.37.2) (2026-06-10)

### Bug Fixes

* combobox option-link hover styling and shell-quote security bump ([#419](https://github.com/TestPlanIt/testplanit/issues/419)) ([12c65e7](https://github.com/TestPlanIt/testplanit/commit/12c65e7cd5eb4bf4a2c096b273c041c6e39be333))

## [0.37.1](https://github.com/TestPlanIt/testplanit/compare/v0.37.0...v0.37.1) (2026-06-10)

### Enhancements

* **llm:** show feature-override projects in AI Models connections ([#418](https://github.com/TestPlanIt/testplanit/issues/418)) ([2029f75](https://github.com/TestPlanIt/testplanit/commit/2029f759dc5010ea31116a42b1a959733e51737f))

## [0.37.0](https://github.com/TestPlanIt/testplanit/compare/v0.36.5...v0.37.0) (2026-06-09)

### Features

* **scim:** SCIM 2.0 provisioning (Users + Groups + webhooks) ([#416](https://github.com/TestPlanIt/testplanit/issues/416)) ([edfcef3](https://github.com/TestPlanIt/testplanit/commit/edfcef355db1e8c82ffdf6d120993f0b540238b7))

## [0.36.5](https://github.com/TestPlanIt/testplanit/compare/v0.36.4...v0.36.5) (2026-06-08)

### Enhancements

* **ui:** share Created By/At display and polish completion flows ([#415](https://github.com/TestPlanIt/testplanit/issues/415)) ([4f1d932](https://github.com/TestPlanIt/testplanit/commit/4f1d932df7c4ec238ae5a2e4c70aeab8e250e16e))

## [0.36.4](https://github.com/TestPlanIt/testplanit/compare/v0.36.3...v0.36.4) (2026-06-08)

### Bug Fixes

* **saml:** support standard IdP configurations and harden the SSO completion flow ([#413](https://github.com/TestPlanIt/testplanit/issues/413)) ([50e0cd6](https://github.com/TestPlanIt/testplanit/commit/50e0cd68c0b8977d3b27cd24816d14a07a6c2a74))

## [0.36.3](https://github.com/TestPlanIt/testplanit/compare/v0.36.2...v0.36.3) (2026-06-08)

### Bug Fixes

* attachment preview sizing, SAML response handling, and share-link URLs ([#412](https://github.com/TestPlanIt/testplanit/issues/412)) ([f9466e3](https://github.com/TestPlanIt/testplanit/commit/f9466e3a75b28cf8f2403a5ef919bc8b5f56852d))

## [0.36.2](https://github.com/TestPlanIt/testplanit/compare/v0.36.1...v0.36.2) (2026-06-08)

### Bug Fixes

* **saml:** normalize IdP certificates whose PEM newlines were collapsed to spaces ([#411](https://github.com/TestPlanIt/testplanit/issues/411)) ([f3bf92f](https://github.com/TestPlanIt/testplanit/commit/f3bf92f078282dc3d03b46050db27e723f645668))

## [0.36.1](https://github.com/TestPlanIt/testplanit/compare/v0.36.0...v0.36.1) (2026-06-07)

### Bug Fixes

* **attachments:** syntax-highlight markdown code blocks (QuickScript-style) ([#410](https://github.com/TestPlanIt/testplanit/issues/410)) ([02bef91](https://github.com/TestPlanIt/testplanit/commit/02bef9144721d8f499c7bec2b462dd69fef6c62d))

## [0.36.0](https://github.com/TestPlanIt/testplanit/compare/v0.35.3...v0.36.0) (2026-06-06)

### Features

* add Playwright reporter (@testplanit/playwright-reporter) ([#408](https://github.com/TestPlanIt/testplanit/issues/408)) ([a5af9c3](https://github.com/TestPlanIt/testplanit/commit/a5af9c3be63dd5e3e2fec6d51f04860cc697a7c0))

## [0.35.3](https://github.com/TestPlanIt/testplanit/compare/v0.35.2...v0.35.3) (2026-06-05)

### Bug Fixes

* **auth:** reject replayed SAML assertions ([#407](https://github.com/TestPlanIt/testplanit/issues/407)) ([ab75960](https://github.com/TestPlanIt/testplanit/commit/ab75960f654755b57e68f1110ed4d719e3c0c404)), closes [#406](https://github.com/TestPlanIt/testplanit/issues/406)

## [0.35.2](https://github.com/TestPlanIt/testplanit/compare/v0.35.1...v0.35.2) (2026-06-05)

### Enhancements

* **auth:** support IdP-initiated SAML and harden the SSO completion flow ([#406](https://github.com/TestPlanIt/testplanit/issues/406)) ([7f3a653](https://github.com/TestPlanIt/testplanit/commit/7f3a653cca24427ad2dbfc58e896f8ecc6386eb7)), closes [#405](https://github.com/TestPlanIt/testplanit/issues/405)

## [0.35.1](https://github.com/TestPlanIt/testplanit/compare/v0.35.0...v0.35.1) (2026-06-05)

### Bug Fixes

* **auth:** make SAML SP-initiated login work end-to-end ([#405](https://github.com/TestPlanIt/testplanit/issues/405)) ([e65517c](https://github.com/TestPlanIt/testplanit/commit/e65517c04b71637a1d6b4da82fe860bd79c53df9))

## [0.35.0](https://github.com/TestPlanIt/testplanit/compare/v0.34.12...v0.35.0) (2026-06-05)

### Features

* **a11y:** WCAG 2.2 AA scan harness, Accessible theme, and name/role fixes ([#404](https://github.com/TestPlanIt/testplanit/issues/404)) ([ae18e3e](https://github.com/TestPlanIt/testplanit/commit/ae18e3e47700955d121254c26abe73086aaacfd2))

## [0.34.12](https://github.com/TestPlanIt/testplanit/compare/v0.34.11...v0.34.12) (2026-06-05)

### Bug Fixes

* **scheduler:** skip legacy keyless entries in reconciliation ([#403](https://github.com/TestPlanIt/testplanit/issues/403)) ([0aef3aa](https://github.com/TestPlanIt/testplanit/commit/0aef3aa2c77df27ed88769e4f659e702ea60165b))

## [0.34.11](https://github.com/TestPlanIt/testplanit/compare/v0.34.10...v0.34.11) (2026-06-05)

### Enhancements

* **workers:** BullMQ worker groups via configurable key prefix ([#402](https://github.com/TestPlanIt/testplanit/issues/402)) ([6e677c0](https://github.com/TestPlanIt/testplanit/commit/6e677c0c076a9d498f189960755c6c6b0b1be011))

## [0.34.10](https://github.com/TestPlanIt/testplanit/compare/v0.34.9...v0.34.10) (2026-06-04)

### Enhancements

* **sessions:** server-side enforcement of required Result Fields ([#401](https://github.com/TestPlanIt/testplanit/issues/401)) ([e7ab3da](https://github.com/TestPlanIt/testplanit/commit/e7ab3daf5d5d64672f727e115ef3277a42572297))

## [0.34.9](https://github.com/TestPlanIt/testplanit/compare/v0.34.8...v0.34.9) (2026-06-04)

### Enhancements

* **mcp:** accept Result Field values on test_run_results_create ([#398](https://github.com/TestPlanIt/testplanit/issues/398)) ([b19d07b](https://github.com/TestPlanIt/testplanit/commit/b19d07bb3d7245534c8100b58554bdd573dfdbfb))
* **search:** bulk actions on RepositoryCase search results ([#400](https://github.com/TestPlanIt/testplanit/issues/400)) ([df08b55](https://github.com/TestPlanIt/testplanit/commit/df08b55501dd1ab65d6ef94cfe03a53851bf0994))

## [0.34.8](https://github.com/TestPlanIt/testplanit/compare/v0.34.7...v0.34.8) (2026-06-03)

### Enhancements

* **import:** add case-ID matching controls to the web import dialog ([#395](https://github.com/TestPlanIt/testplanit/issues/395)) ([bb3f37b](https://github.com/TestPlanIt/testplanit/commit/bb3f37bdba44870d814155ab59d905a08facf794)), closes [#394](https://github.com/TestPlanIt/testplanit/issues/394)

## [0.34.7](https://github.com/TestPlanIt/testplanit/compare/v0.34.6...v0.34.7) (2026-06-03)

### Bug Fixes

* **packages:** lower minimum Node.js engine to >=20 ([#389](https://github.com/TestPlanIt/testplanit/issues/389)) ([28121cd](https://github.com/TestPlanIt/testplanit/commit/28121cd565165135f38c032c073fe5964efbdab7))

### Enhancements

* **import:** link JUnit/CLI results to existing cases by ID ([#394](https://github.com/TestPlanIt/testplanit/issues/394)) ([2f91d0e](https://github.com/TestPlanIt/testplanit/commit/2f91d0e4e385d65f8d93e0fbef93c1313e2c179e))

## [0.34.6](https://github.com/TestPlanIt/testplanit/compare/v0.34.5...v0.34.6) (2026-06-03)

### Bug Fixes

* **quality:** address 10 CodeQL Code-Scanning findings ([#388](https://github.com/TestPlanIt/testplanit/issues/388)) ([2566b24](https://github.com/TestPlanIt/testplanit/commit/2566b2424b2eb9c11b59a8f19244b310fcf2f750))

## [0.34.5](https://github.com/TestPlanIt/testplanit/compare/v0.34.4...v0.34.5) (2026-06-03)

### Enhancements

* **cases:** inline parameters & dataset on Add Case ([#387](https://github.com/TestPlanIt/testplanit/issues/387)) ([08ddb89](https://github.com/TestPlanIt/testplanit/commit/08ddb89a9be1e7c000cae7464b79cb49c90fc05e))

## [0.34.4](https://github.com/TestPlanIt/testplanit/compare/v0.34.3...v0.34.4) (2026-06-03)

### Bug Fixes

* **deps:** bump axios to 1.16.1 to resolve eight Dependabot alerts ([#385](https://github.com/TestPlanIt/testplanit/issues/385)) ([7955693](https://github.com/TestPlanIt/testplanit/commit/79556935208bec17e7ad2e6189f2b8a2e55140a8)), closes [#414](https://github.com/TestPlanIt/testplanit/issues/414) [#411](https://github.com/TestPlanIt/testplanit/issues/411) [#413](https://github.com/TestPlanIt/testplanit/issues/413) [#410](https://github.com/TestPlanIt/testplanit/issues/410) [#412](https://github.com/TestPlanIt/testplanit/issues/412) [#409](https://github.com/TestPlanIt/testplanit/issues/409) [#408](https://github.com/TestPlanIt/testplanit/issues/408) [#406](https://github.com/TestPlanIt/testplanit/issues/406)

### Enhancements

* **reviews:** exclude draft cases from test runs ([#386](https://github.com/TestPlanIt/testplanit/issues/386)) ([9f87807](https://github.com/TestPlanIt/testplanit/commit/9f8780719f235094e9f6112e1f0957f12b73af1a))

## [0.34.3](https://github.com/TestPlanIt/testplanit/compare/v0.34.2...v0.34.3) (2026-06-02)

### Bug Fixes

* **tiptap:** always register parameterMention node; gate suggestion popup separately ([#384](https://github.com/TestPlanIt/testplanit/issues/384)) ([529c268](https://github.com/TestPlanIt/testplanit/commit/529c2687c7ac465b25fd60cf2a1a6886aae3cb3f))

## [0.34.2](https://github.com/TestPlanIt/testplanit/compare/v0.34.1...v0.34.2) (2026-06-01)

### Enhancements

* **quickscript:** Mobilewright templates + default-ON AI toggle + AI prompt syntax-example injection ([#383](https://github.com/TestPlanIt/testplanit/issues/383)) ([ebdf761](https://github.com/TestPlanIt/testplanit/commit/ebdf7619462fe4959c4a85ff792bb65c76921c1e))

## [0.34.1](https://github.com/TestPlanIt/testplanit/compare/v0.34.0...v0.34.1) (2026-06-01)

### Bug Fixes

* patch bundle (React Compiler opt-out + soft-delete resurrection + default-template seed) ([#382](https://github.com/TestPlanIt/testplanit/issues/382)) ([711db9a](https://github.com/TestPlanIt/testplanit/commit/711db9af72d3c3a41c470627e23aa6e1d6155677)), closes [react.dev/learn/react-compiler#opting-out-from-the-compiler](https://github.com/react.dev/learn/react-compiler/issues/opting-out-from-the-compiler)

## [0.34.0](https://github.com/TestPlanIt/testplanit/compare/v0.33.4...v0.34.0) (2026-06-01)

### Features

* **reports:** add Automation Candidates report ([#381](https://github.com/TestPlanIt/testplanit/issues/381)) ([8123bb4](https://github.com/TestPlanIt/testplanit/commit/8123bb40f6c8873efec2dc6fe492d80fee048b47))

## [0.33.4](https://github.com/TestPlanIt/testplanit/compare/v0.33.3...v0.33.4) (2026-05-31)

### Enhancements

* **deps:** switch react-hook-form resolver from zodResolver to standardSchemaResolver ([#379](https://github.com/TestPlanIt/testplanit/issues/379)) ([93ec765](https://github.com/TestPlanIt/testplanit/commit/93ec7657b998f7b953c0879f1bc0394cf0824dbd))
* **live:** multiplex test-run SSE wake-ups via a project-level stream ([#380](https://github.com/TestPlanIt/testplanit/issues/380)) ([c57b9a9](https://github.com/TestPlanIt/testplanit/commit/c57b9a9fffd0dd7ac68c900be1de1884d48fcb44))

## [0.33.3](https://github.com/TestPlanIt/testplanit/compare/v0.33.2...v0.33.3) (2026-05-31)

### Enhancements

* **live:** SSE-driven live updates for test runs ([#378](https://github.com/TestPlanIt/testplanit/issues/378)) ([e59838f](https://github.com/TestPlanIt/testplanit/commit/e59838fed5b1e829ecd7fc23c403701029a8e968))

## [0.33.2](https://github.com/TestPlanIt/testplanit/compare/v0.33.1...v0.33.2) (2026-05-31)

### Enhancements

* **ui:** full preferences in profile view mode + date/time hover tooltips ([#375](https://github.com/TestPlanIt/testplanit/issues/375)) ([1c7cb9d](https://github.com/TestPlanIt/testplanit/commit/1c7cb9d71a36657cd280baa01f2cca8b6ba3839a))

## [0.33.1](https://github.com/TestPlanIt/testplanit/compare/v0.33.0...v0.33.1) (2026-05-31)

### Enhancements

* **integrations:** OAuth 2.0 for GitHub, GitLab, and Gitea/Forgejo ([#374](https://github.com/TestPlanIt/testplanit/issues/374)) ([c8497d0](https://github.com/TestPlanIt/testplanit/commit/c8497d08f802bbac319e5b873be8d78bf0fa55e7))

## [0.33.0](https://github.com/TestPlanIt/testplanit/compare/v0.32.7...v0.33.0) (2026-05-30)

### Features

* **export:** Data Lake Export endpoints + Webhook Event Catalog ([#373](https://github.com/TestPlanIt/testplanit/issues/373)) ([b7fb88e](https://github.com/TestPlanIt/testplanit/commit/b7fb88ead4c76e041c1385009037616b71709c86))

## [0.32.7](https://github.com/TestPlanIt/testplanit/compare/v0.32.6...v0.32.7) (2026-05-30)

### Enhancements

* **cases:** parameterized indicator + Parameterization view ([#372](https://github.com/TestPlanIt/testplanit/issues/372)) ([3be8fdf](https://github.com/TestPlanIt/testplanit/commit/3be8fdf09f09026ce6f0a0abb7fd50d40948ddba))

## [0.32.6](https://github.com/TestPlanIt/testplanit/compare/v0.32.5...v0.32.6) (2026-05-29)

### Enhancements

* **milestones:** PDF export from milestone details page ([#366](https://github.com/TestPlanIt/testplanit/issues/366)) ([85afd23](https://github.com/TestPlanIt/testplanit/commit/85afd2396f1a61e587ae2bc23549b5235d74aa03))

## [0.32.5](https://github.com/TestPlanIt/testplanit/compare/v0.32.4...v0.32.5) (2026-05-29)

### Bug Fixes

* default template/workflow lookup tolerates flipped isDefault flag + stable E2E specs ([#364](https://github.com/TestPlanIt/testplanit/issues/364)) ([9f05b86](https://github.com/TestPlanIt/testplanit/commit/9f05b86697d62f93c6a7e0cd6cac36b1a5f46b29))

## [0.32.4](https://github.com/TestPlanIt/testplanit/compare/v0.32.3...v0.32.4) (2026-05-29)

### Enhancements

* **attachments:** first-class external-link attachments across all surfaces ([#361](https://github.com/TestPlanIt/testplanit/issues/361)) ([641bf58](https://github.com/TestPlanIt/testplanit/commit/641bf5872b4e8f661822d1da64dba706279d4ed5))

## [0.32.3](https://github.com/TestPlanIt/testplanit/compare/v0.32.2...v0.32.3) (2026-05-28)

### Enhancements

* **auto-tag:** include linked-issue context (Jira labels + components) ([#360](https://github.com/TestPlanIt/testplanit/issues/360)) ([c4f2695](https://github.com/TestPlanIt/testplanit/commit/c4f2695409e1a3787b2c3df123d8090973d84f56))

## [0.32.2](https://github.com/TestPlanIt/testplanit/compare/v0.32.1...v0.32.2) (2026-05-28)

### Enhancements

* **reports:** expand step results in execution log ([#359](https://github.com/TestPlanIt/testplanit/issues/359)) ([4fa486f](https://github.com/TestPlanIt/testplanit/commit/4fa486f31468e5fcd2bf9a842178c54e01470735))

## [0.32.1](https://github.com/TestPlanIt/testplanit/compare/v0.32.0...v0.32.1) (2026-05-28)

### Bug Fixes

* **audit:** wire ProjectConfigurationAssignment into the admin-config audit sweep ([#358](https://github.com/TestPlanIt/testplanit/issues/358)) ([6727155](https://github.com/TestPlanIt/testplanit/commit/67271552052c07e63bc476d59df84958cc699b1e)), closes [#354](https://github.com/TestPlanIt/testplanit/issues/354)

## [0.32.0](https://github.com/TestPlanIt/testplanit/compare/v0.31.8...v0.32.0) (2026-05-28)

### Features

* **integrations:** support GitHub Enterprise Server via configurable API base URL ([#357](https://github.com/TestPlanIt/testplanit/issues/357)) ([a8dfb24](https://github.com/TestPlanIt/testplanit/commit/a8dfb24330b1270deeaf8457bb3c1f45a72a2af0))

## [0.31.8](https://github.com/TestPlanIt/testplanit/compare/v0.31.7...v0.31.8) (2026-05-28)

### Bug Fixes

* **copy-move:** prevent self-collision during same-project moves and enhance template preservation ([#356](https://github.com/TestPlanIt/testplanit/issues/356)) ([103c0a0](https://github.com/TestPlanIt/testplanit/commit/103c0a0dd14a8c1e6f10c5115e8173d4703488ca))

## [0.31.7](https://github.com/TestPlanIt/testplanit/compare/v0.31.6...v0.31.7) (2026-05-28)

### Bug Fixes

* **repository-import:** align multi-row preview/counts with what is imported ([#355](https://github.com/TestPlanIt/testplanit/issues/355)) ([953030d](https://github.com/TestPlanIt/testplanit/commit/953030d3093227e3ead64085c97b2a8044f88ef6))

## [0.31.6](https://github.com/TestPlanIt/testplanit/compare/v0.31.5...v0.31.6) (2026-05-28)

### Enhancements

* **configurations:** scope to projects + admin UX overhaul ([#354](https://github.com/TestPlanIt/testplanit/issues/354)) ([fa1049c](https://github.com/TestPlanIt/testplanit/commit/fa1049cb71722f96250ce888a4f3f84b266287a9))

## [0.31.5](https://github.com/TestPlanIt/testplanit/compare/v0.31.4...v0.31.5) (2026-05-27)

### Enhancements

* **test-runs:** make completed runs structurally immutable ([#353](https://github.com/TestPlanIt/testplanit/issues/353)) ([4beeca2](https://github.com/TestPlanIt/testplanit/commit/4beeca2653b7812af625efb741e41a6af6cfd4ea))

## [0.31.4](https://github.com/TestPlanIt/testplanit/compare/v0.31.3...v0.31.4) (2026-05-27)

### Enhancements

* **audit:** audit all admin configuration changes ([#352](https://github.com/TestPlanIt/testplanit/issues/352)) ([b7f3570](https://github.com/TestPlanIt/testplanit/commit/b7f357080f62791bb1a02f3a0b7397a99104c8a9))

## [0.31.3](https://github.com/TestPlanIt/testplanit/compare/v0.31.2...v0.31.3) (2026-05-27)

### Enhancements

* **test-runs:** expand step details in Test Run PDF export ([#351](https://github.com/TestPlanIt/testplanit/issues/351)) ([3a51981](https://github.com/TestPlanIt/testplanit/commit/3a519815c9c86c55b6d12486ef632ed1c7f57d86))

## [0.31.2](https://github.com/TestPlanIt/testplanit/compare/v0.31.1...v0.31.2) (2026-05-27)

### Enhancements

* **reports:** add folder and tag report dimensions ([#350](https://github.com/TestPlanIt/testplanit/issues/350)) ([d8cb96e](https://github.com/TestPlanIt/testplanit/commit/d8cb96e565a9809a3bbd2f368bb889c15d72bc08))

## [0.31.1](https://github.com/TestPlanIt/testplanit/compare/v0.31.0...v0.31.1) (2026-05-27)

### Enhancements

* Require a linked issue on failure (per-project, opt-in) ([#349](https://github.com/TestPlanIt/testplanit/issues/349)) ([0fea500](https://github.com/TestPlanIt/testplanit/commit/0fea5007a7ca3ca9fa37520fe7e39f4660fbc68c))

## [0.31.0](https://github.com/TestPlanIt/testplanit/compare/v0.30.0...v0.31.0) (2026-05-26)

### Features

* **test-runs:** server-enforced result governance — required fields, edit window & flip justification ([#348](https://github.com/TestPlanIt/testplanit/issues/348)) ([715a831](https://github.com/TestPlanIt/testplanit/commit/715a831170379ec8d40089a3d0511abf649c340a))

## [0.30.0](https://github.com/TestPlanIt/testplanit/compare/v0.29.10...v0.30.0) (2026-05-25)

### Features

* **reviews:** review and approval workflows ([#347](https://github.com/TestPlanIt/testplanit/issues/347)) ([a774d43](https://github.com/TestPlanIt/testplanit/commit/a774d431c43956b932b135671bc1fd7044ecef9a)), closes [#1](https://github.com/TestPlanIt/testplanit/issues/1) [#2](https://github.com/TestPlanIt/testplanit/issues/2) [#3](https://github.com/TestPlanIt/testplanit/issues/3) [#317](https://github.com/TestPlanIt/testplanit/issues/317)

### Bug Fixes

* **deps:** bump ws to >=8.20.1 to resolve uninitialized memory disclosure ([#340](https://github.com/TestPlanIt/testplanit/issues/340)) ([f1bceba](https://github.com/TestPlanIt/testplanit/commit/f1bceba27e14d3b877ffd17a904720323fab8779)), closes [#403](https://github.com/TestPlanIt/testplanit/issues/403) [#397](https://github.com/TestPlanIt/testplanit/issues/397)
* **deps:** resolve qs, brace-expansion, and pm2 security advisories ([#339](https://github.com/TestPlanIt/testplanit/issues/339)) ([75712b3](https://github.com/TestPlanIt/testplanit/commit/75712b397f61c5e8b152cdd046612577628f39e7))
* **mcp:** honor customField value filter in cases_list instead of dropping it ([#341](https://github.com/TestPlanIt/testplanit/issues/341)) ([de9bd78](https://github.com/TestPlanIt/testplanit/commit/de9bd78f870439ca371bf554aacaa49eac607634))

## [0.29.10](https://github.com/TestPlanIt/testplanit/compare/v0.29.9...v0.29.10) (2026-05-24)

### Bug Fixes

* **llm:** adaptive context budget for outline phase to avoid timeouts ([#336](https://github.com/TestPlanIt/testplanit/issues/336)) ([138e035](https://github.com/TestPlanIt/testplanit/commit/138e035aa7603deeecc41bfa8189b0622f87ba90)), closes [#335](https://github.com/TestPlanIt/testplanit/issues/335) [pre-PR-#335](https://github.com/TestPlanIt/pre-PR-/issues/335)
* **webhooks:** skip tenant key fetch for retire-expired-secrets cron ([#337](https://github.com/TestPlanIt/testplanit/issues/337)) ([653cacf](https://github.com/TestPlanIt/testplanit/commit/653cacf8f6eb5c7588e206f88fb1b363832f39d5))

## [0.29.9](https://github.com/TestPlanIt/testplanit/compare/v0.29.8...v0.29.9) (2026-05-22)

### Bug Fixes

* **llm:** pass existing folder cases into outline prompt to avoid duplicates ([#335](https://github.com/TestPlanIt/testplanit/issues/335)) ([4b0c3a3](https://github.com/TestPlanIt/testplanit/commit/4b0c3a37094f85e2e64a869b8a3448a8dbf85243))

## [0.29.8](https://github.com/TestPlanIt/testplanit/compare/v0.29.7...v0.29.8) (2026-05-22)

### Bug Fixes

* **llm:** honor configured max-output-tokens in outline endpoint ([#334](https://github.com/TestPlanIt/testplanit/issues/334)) ([a27e63e](https://github.com/TestPlanIt/testplanit/commit/a27e63e4ad6e3806e3dfdc43b7c6ad639758bcb0))

## [0.29.7](https://github.com/TestPlanIt/testplanit/compare/v0.29.6...v0.29.7) (2026-05-22)

### Bug Fixes

* **import:** forgive non-exporter CSVs in multi-row mode ([#332](https://github.com/TestPlanIt/testplanit/issues/332)) ([012ec3e](https://github.com/TestPlanIt/testplanit/commit/012ec3e4857dc528e9e504725aa9a8504c22bd55))

## [0.29.6](https://github.com/TestPlanIt/testplanit/compare/v0.29.5...v0.29.6) (2026-05-22)

### Bug Fixes

* **import:** round-trip support for labeled + multi-row CSV step exports ([#330](https://github.com/TestPlanIt/testplanit/issues/330)) ([176aa5e](https://github.com/TestPlanIt/testplanit/commit/176aa5e12eb9e8fce3a0247d2ad3b4b02ce0621c))

## [0.29.5](https://github.com/TestPlanIt/testplanit/compare/v0.29.4...v0.29.5) (2026-05-21)

### Bug Fixes

* **export:** include expectedResult content in test case exports ([#329](https://github.com/TestPlanIt/testplanit/issues/329)) ([bce26a4](https://github.com/TestPlanIt/testplanit/commit/bce26a456c36910a609aafb3fce8e2a5e542fabd))

## [0.29.4](https://github.com/TestPlanIt/testplanit/compare/v0.29.3...v0.29.4) (2026-05-21)

### Bug Fixes

* **llm:** surface details on test-case generation parse failures ([#327](https://github.com/TestPlanIt/testplanit/issues/327)) ([b2064f4](https://github.com/TestPlanIt/testplanit/commit/b2064f480698b19d225e665b10b5bafc84d9c2aa))

## [0.29.3](https://github.com/TestPlanIt/testplanit/compare/v0.29.2...v0.29.3) (2026-05-20)

### Bug Fixes

* **runs:** soft-delete test run cases to preserve result history ([#323](https://github.com/TestPlanIt/testplanit/issues/323)) ([5457653](https://github.com/TestPlanIt/testplanit/commit/5457653a5b2d0f05340572e4ce74bcd92c151ff7))

## [0.29.2](https://github.com/TestPlanIt/testplanit/compare/v0.29.1...v0.29.2) (2026-05-20)

### Bug Fixes

* **access:** enhance role-based permissions for create/update/delete actions ([#322](https://github.com/TestPlanIt/testplanit/issues/322)) ([e01816c](https://github.com/TestPlanIt/testplanit/commit/e01816cedc444514ae2648b36d01aed7e6fdb68f))

## [0.29.1](https://github.com/TestPlanIt/testplanit/compare/v0.29.0...v0.29.1) (2026-05-20)

### Bug Fixes

* **docker:** drop inline 8 GB cap on `pnpm zenstack generate` ([b327183](https://github.com/TestPlanIt/testplanit/commit/b3271836a23376d76edd00a7db8a7d224ddbf46f))

## [0.29.0](https://github.com/TestPlanIt/testplanit/compare/v0.28.0...v0.29.0) (2026-05-20)

### Features

* **datasets:** per-case local datasets and project-scoped shared datasets with version pinning ([7e1e9d8](https://github.com/TestPlanIt/testplanit/commit/7e1e9d8f6875b4b33556491a551cd078c12ef044))
* **i18n:** Turkish (tr-TR) and Russian (ru-RU) locale support ([d326973](https://github.com/TestPlanIt/testplanit/commit/d326973e243e61dbbcc0d03bc1c4a60ac5e914c6))
* **import:** configurable JUnit iteration-property names ([123d887](https://github.com/TestPlanIt/testplanit/commit/123d8872a0094e8c491aeb9d7333bc9ebfd77755))
* **llm:** includeParameters toggle in the test case generation wizard ([1774f0c](https://github.com/TestPlanIt/testplanit/commit/1774f0c675ba0f0cc2e418ea8d94a7428a4ca370))
* parameterized test cases — drive a single case from a table of input rows ([a0fdfb5](https://github.com/TestPlanIt/testplanit/commit/a0fdfb5a04b689a66cafb9388dbb74afd18d9cfc))
* **reports:** Parameter Iteration Matrix report preset ([12f8161](https://github.com/TestPlanIt/testplanit/commit/12f8161c49e647a1fe8a997031146b1b8b361c0f))
* **webhooks:** iteration.result.recorded outbound event + per-iteration redacted values on test_run.completed ([c16cf84](https://github.com/TestPlanIt/testplanit/commit/c16cf845286e9fa1835f9f4d6af1ae03cc83fb5b))

### Bug Fixes

* **editor:** let TipTap editor wrappers expand instead of scrolling internally ([73fd69e](https://github.com/TestPlanIt/testplanit/commit/73fd69e67acc17d2a6aeeae55bb1c580b34ad5e1))

## [0.28.0](https://github.com/TestPlanIt/testplanit/compare/v0.27.7...v0.28.0) (2026-05-19)

> **Note:** release-please auto-generated this section based on commit history and initially listed ~30 review-approval features. Those features did **not** ship in this release — the source code was reverted via [#317](https://github.com/TestPlanIt/testplanit/pull/317) before the release, but the original commit messages stayed in git history and were mistakenly picked up as changelog entries. This section has been corrected to reflect what actually shipped.

### Features

* **i18n:** add Turkish (tr-TR) and Russian (ru-RU) locale support ([#318](https://github.com/TestPlanIt/testplanit/pull/318)) ([a089676](https://github.com/TestPlanIt/testplanit/commit/a0896765f11ca5118c567a48d4f612e849872e60))

### Enhancements

* **queues:** extract shared `defaultJobOptions` presets ([#316](https://github.com/TestPlanIt/testplanit/pull/316)) ([259e16d](https://github.com/TestPlanIt/testplanit/commit/259e16dc))

### Chores

* **i18n:** sync Crowdin translation files ([9d4d27a](https://github.com/TestPlanIt/testplanit/commit/9d4d27aa))
* drop accidentally-merged work-in-progress commits from `main` ([#317](https://github.com/TestPlanIt/testplanit/pull/317)) ([6eb2245](https://github.com/TestPlanIt/testplanit/commit/6eb2245c))

## [0.27.7](https://github.com/TestPlanIt/testplanit/compare/v0.27.6...v0.27.7) (2026-05-13)

### Enhancements

* **audit:** harden audit-context plumbing ([#312](https://github.com/TestPlanIt/testplanit/issues/312)) ([b5be42d](https://github.com/TestPlanIt/testplanit/commit/b5be42d04052078343441b516098ced790f53ab6))

## [0.27.6](https://github.com/TestPlanIt/testplanit/compare/v0.27.5...v0.27.6) (2026-05-13)

### Bug Fixes

* address CodeQL quality findings and bump dependencies ([#311](https://github.com/TestPlanIt/testplanit/issues/311)) ([3bcc423](https://github.com/TestPlanIt/testplanit/commit/3bcc4239c20938e5da8412f0ba3f82b967859127))
* **ci:** pull --rebase before pushing in Crowdin sync workflow ([#307](https://github.com/TestPlanIt/testplanit/issues/307)) ([f587a60](https://github.com/TestPlanIt/testplanit/commit/f587a6082432cbfca9eda50f51f49e8f90446fca))
* **ci:** use RELEASE_PLEASE_TOKEN in Crowdin sync to bypass branch protection ([#310](https://github.com/TestPlanIt/testplanit/issues/310)) ([62b896b](https://github.com/TestPlanIt/testplanit/commit/62b896befd30c17d8c547934e05d0708f2175dcb))
* **tests:** add useExecutionLogColumns mock to ReportRenderer test ([#308](https://github.com/TestPlanIt/testplanit/issues/308)) ([1d9881f](https://github.com/TestPlanIt/testplanit/commit/1d9881ffbcf0707e927d6ab9494dbc2aa2a6f9a4))

## [0.27.5](https://github.com/TestPlanIt/testplanit/compare/v0.27.4...v0.27.5) (2026-05-13)

### Enhancements

* **reports:** add Execution Log pre-built report ([6631cad](https://github.com/TestPlanIt/testplanit/commit/6631cad42970cb7b53234066a3eb9c6089b1f19f))

## [0.27.4](https://github.com/TestPlanIt/testplanit/compare/v0.27.3...v0.27.4) (2026-05-13)

### Bug Fixes

* **i18n:** fix TypeScript type errors in next-intl interpolation calls ([08a0c9c](https://github.com/TestPlanIt/testplanit/commit/08a0c9cf7191a530feedd8db927970a1d95c9973))

## [0.27.3](https://github.com/TestPlanIt/testplanit/compare/v0.27.2...v0.27.3) (2026-05-13)

### Bug Fixes

* **i18n:** add missing interpolation placeholders to admin delete dialogs ([f15049b](https://github.com/TestPlanIt/testplanit/commit/f15049b2c26eeb3b184a15844c76a82c3895024f))

## [0.27.2](https://github.com/TestPlanIt/testplanit/compare/v0.27.1...v0.27.2) (2026-05-13)

### Bug Fixes

* **i18n:** ensure count is a string in confirmation dialog description ([a7c4d30](https://github.com/TestPlanIt/testplanit/commit/a7c4d30c7691ef54d3817c6c4ebea096cd6fd224))

## [0.27.1](https://github.com/TestPlanIt/testplanit/compare/v0.27.0...v0.27.1) (2026-05-12)

### Bug Fixes

* **i18n:** add confirmation dialog description for combinations in multiple languages ([ca6d785](https://github.com/TestPlanIt/testplanit/commit/ca6d7850906d515304ab845361cad5d8842bc171))

## [0.27.0](https://github.com/TestPlanIt/testplanit/compare/v0.26.2...v0.27.0) (2026-05-12)

### Features

* **i18n:** add localization support for 13 languages ([#305](https://github.com/TestPlanIt/testplanit/issues/305)) ([b739945](https://github.com/TestPlanIt/testplanit/commit/b739945e642c7bbe397ba253197ee1c79de997cc))

## [0.26.2](https://github.com/TestPlanIt/testplanit/compare/v0.26.1...v0.26.2) (2026-05-12)

### Bug Fixes

* apply prettier formatting after CodeQL fix ([476cbb2](https://github.com/TestPlanIt/testplanit/commit/476cbb22839e003cc9e11f069d04803591394bec))

## [0.26.1](https://github.com/TestPlanIt/testplanit/compare/v0.26.0...v0.26.1) (2026-05-12)

### Bug Fixes

* disable generate button with no folders; two-phase test case generation to avoid timeouts ([#304](https://github.com/TestPlanIt/testplanit/issues/304)) ([8b9f897](https://github.com/TestPlanIt/testplanit/commit/8b9f897c7ffbe34d8d7b80b9a7ee19ba1ec2fbff))

## [0.26.0](https://github.com/TestPlanIt/testplanit/compare/v0.25.1...v0.26.0) (2026-05-11)

### Features

* add GitLab and Gitea/Forgejo/Gogs issue tracker integrations ([#296](https://github.com/TestPlanIt/testplanit/issues/296)) ([5bbf277](https://github.com/TestPlanIt/testplanit/commit/5bbf277ef24fed47a492647a3b33e201aafe6fa1)), closes [namespace/project#iid](https://github.com/namespace/project/issues/iid) [owner/repo#number](https://github.com/owner/repo/issues/number) [group/project#42](https://github.com/group/project/issues/42)

## [0.25.1](https://github.com/TestPlanIt/testplanit/compare/v0.25.0...v0.25.1) (2026-05-11)

### Bug Fixes

* **ci:** run prisma generate before mcp-server build in packages-release ([#300](https://github.com/TestPlanIt/testplanit/issues/300)) ([f1c4acb](https://github.com/TestPlanIt/testplanit/commit/f1c4acb2835cffb19b335592f5f658cff50d695e))
* correct MCP server docs link in upgrade notification ([#303](https://github.com/TestPlanIt/testplanit/issues/303)) ([7cddd71](https://github.com/TestPlanIt/testplanit/commit/7cddd71f45491db8aa34aec02b9844b168be12c5))
* correct repository.url casing in package.json files ([#302](https://github.com/TestPlanIt/testplanit/issues/302)) ([5f4db71](https://github.com/TestPlanIt/testplanit/commit/5f4db714195fee24ae0ff71cc8933b19d87f32cd))
* make TESTPLANIT_API_URL optional with SaaS default ([#297](https://github.com/TestPlanIt/testplanit/issues/297)) ([d38432b](https://github.com/TestPlanIt/testplanit/commit/d38432b42af7e0025f90a5f1e906c394a10f0dcb))
* **mcp-server:** remove @prisma/client import to fix CI build ([#298](https://github.com/TestPlanIt/testplanit/issues/298)) ([4c0c9a2](https://github.com/TestPlanIt/testplanit/commit/4c0c9a21afde5a57437f50120dab4f1349fc5fcf))
* **mcp-server:** run prisma generate in packages-release workflow ([#299](https://github.com/TestPlanIt/testplanit/issues/299)) ([d3980d7](https://github.com/TestPlanIt/testplanit/commit/d3980d77d4ebb3d7cf327578a87b2939a18e08e8))

## [0.25.0](https://github.com/TestPlanIt/testplanit/compare/v0.24.24...v0.25.0) (2026-05-11)

### Features

* **mcp:** TestPlanIt MCP Server ([1d711b2](https://github.com/TestPlanIt/testplanit/commit/1d711b20982bf44f2447be0bf812c86c363e2e79))

## [0.24.24](https://github.com/TestPlanIt/testplanit/compare/v0.24.23...v0.24.24) (2026-05-11)

### Enhancements

* add self-registration toggle for admins ([#295](https://github.com/TestPlanIt/testplanit/issues/295)) ([68d6cf8](https://github.com/TestPlanIt/testplanit/commit/68d6cf80c4aef61608374e576386e051e7f20711))

## [0.24.23](https://github.com/TestPlanIt/testplanit/compare/v0.24.22...v0.24.23) (2026-05-10)

### Bug Fixes

* preserve URL page number on initial load + pin next-intl to 4.9.1 ([#294](https://github.com/TestPlanIt/testplanit/issues/294)) ([cf3d0fa](https://github.com/TestPlanIt/testplanit/commit/cf3d0fae6c0bc5835968d1685e0e44e66bb4a22e))

## [0.24.22](https://github.com/TestPlanIt/testplanit/compare/v0.24.21...v0.24.22) (2026-05-10)

### Bug Fixes

* stabilize column hooks to prevent Jira popover flicker and broken checkboxes ([#293](https://github.com/TestPlanIt/testplanit/issues/293)) ([0542d4b](https://github.com/TestPlanIt/testplanit/commit/0542d4be6c6bd28ba2701c7c0a7051e7bf24fb6c))

## [0.24.21](https://github.com/TestPlanIt/testplanit/compare/v0.24.20...v0.24.21) (2026-05-09)

### Bug Fixes

* webhook audit tenantId + summary sort toggle ([#292](https://github.com/TestPlanIt/testplanit/issues/292)) ([fe9f1ec](https://github.com/TestPlanIt/testplanit/commit/fe9f1ec8132cf80173462fcb72a8e6bff7809759))

## [0.24.20](https://github.com/TestPlanIt/testplanit/compare/v0.24.19...v0.24.20) (2026-05-09)

### Bug Fixes

* **docs:** pin pnpm to v10 in Dockerfile to match lockfile format ([4847551](https://github.com/TestPlanIt/testplanit/commit/48475516bfc56d0e635c6435df7165c6a3cc04d6))
* search access for non-direct project members + automated flag promotion on result submission ([#291](https://github.com/TestPlanIt/testplanit/issues/291)) ([7981f6e](https://github.com/TestPlanIt/testplanit/commit/7981f6e416ddf385d45776611f8499872ffefd54))

## [0.24.19](https://github.com/TestPlanIt/testplanit/compare/v0.24.18...v0.24.19) (2026-05-08)

### Enhancements

* **copy/move:** Enhancement/copy move in same project ([#290](https://github.com/TestPlanIt/testplanit/issues/290)) ([bac7c18](https://github.com/TestPlanIt/testplanit/commit/bac7c18df640082eca1b796413bbba28a0733357))

## [0.24.18](https://github.com/TestPlanIt/testplanit/compare/v0.24.17...v0.24.18) (2026-05-06)

### Bug Fixes

* **ProjectRepository:** update file drop conditions to include addCaseOpen state ([f09f344](https://github.com/TestPlanIt/testplanit/commit/f09f344e87fcc39380177e484c7f0ef211ec5f89))

## [0.24.17](https://github.com/TestPlanIt/testplanit/compare/v0.24.16...v0.24.17) (2026-05-06)

### Bug Fixes

* **AddCase:** simplify step handling by using default values ([09dd0b3](https://github.com/TestPlanIt/testplanit/commit/09dd0b399e01e4d6bfa3b52696a09527bdf8525e))

## [0.24.16](https://github.com/TestPlanIt/testplanit/compare/v0.24.15...v0.24.16) (2026-05-06)

### Bug Fixes

* preserve search params when clicking active menu link ([d3eb91c](https://github.com/TestPlanIt/testplanit/commit/d3eb91c2ef71dc1acc6cbc9afb1524433cfc611b))

## [0.24.15](https://github.com/TestPlanIt/testplanit/compare/v0.24.14...v0.24.15) (2026-05-05)

### Bug Fixes

* prevent repository menu link from stripping node/view search params ([13cd95c](https://github.com/TestPlanIt/testplanit/commit/13cd95c7a5a8a3baf982797c67c97c732bca96e3))

## [0.24.14](https://github.com/TestPlanIt/testplanit/compare/v0.24.13...v0.24.14) (2026-05-05)

### Enhancements

* graduated opacity per Gantt group and remove overlapping bar labels ([#283](https://github.com/TestPlanIt/testplanit/issues/283)) ([e7c7ad0](https://github.com/TestPlanIt/testplanit/commit/e7c7ad01adac3d274659b0dcef6a970b1394f970))

## [0.24.13](https://github.com/TestPlanIt/testplanit/compare/v0.24.12...v0.24.13) (2026-05-05)

### Bug Fixes

* small bug fixes for SSO linking, password policy, project menu, and LLM adapters ([#282](https://github.com/TestPlanIt/testplanit/issues/282)) ([e5a2af4](https://github.com/TestPlanIt/testplanit/commit/e5a2af4ecffe25d0642277b624bbc1ca219e281e))

## [0.24.12](https://github.com/TestPlanIt/testplanit/compare/v0.24.11...v0.24.12) (2026-05-04)

### Enhancements

* **repository:** route single-case add through importGeneratedTestCases action ([#280](https://github.com/TestPlanIt/testplanit/issues/280)) ([24b8523](https://github.com/TestPlanIt/testplanit/commit/24b85239fa3b0a17fc9d92eff3f1ebf99f634563))

## [0.24.11](https://github.com/TestPlanIt/testplanit/compare/v0.24.10...v0.24.11) (2026-05-04)

### Enhancements

* **audit:** system actor badge + wrap remaining routes with audit context ([#279](https://github.com/TestPlanIt/testplanit/issues/279)) ([b685997](https://github.com/TestPlanIt/testplanit/commit/b6859973f89ce448491abb6b164bdba0b1c8c91f))

## [0.24.10](https://github.com/TestPlanIt/testplanit/compare/v0.24.9...v0.24.10) (2026-05-04)

### Bug Fixes

* **tiptap:** drop pseudo-element backticks; remove bounded-height/expand wrappers ([#278](https://github.com/TestPlanIt/testplanit/issues/278)) ([9a17462](https://github.com/TestPlanIt/testplanit/commit/9a1746292c03fbe2c7b8314964508dd25217daf3))

## [0.24.9](https://github.com/TestPlanIt/testplanit/compare/v0.24.8...v0.24.9) (2026-05-04)

### Bug Fixes

* **i18n:** localize tiptap rich-text toolbar tooltips ([#277](https://github.com/TestPlanIt/testplanit/issues/277)) ([be18f5a](https://github.com/TestPlanIt/testplanit/commit/be18f5ada098cbff424b828f12841601ef1b79b9))

## [0.24.8](https://github.com/TestPlanIt/testplanit/compare/v0.24.7...v0.24.8) (2026-05-03)

### Bug Fixes

* **duplicates:** exclude source case from creation-time duplicate scan and fire toast from inline AddCaseRow ([#276](https://github.com/TestPlanIt/testplanit/issues/276)) ([6e011c2](https://github.com/TestPlanIt/testplanit/commit/6e011c21d066a6e9f66c74f6e3dbc5ae7dc852ff))

## [0.24.7](https://github.com/TestPlanIt/testplanit/compare/v0.24.6...v0.24.7) (2026-05-03)

### Bug Fixes

* **i18n:** LLM stream error codes + React stragglers sweep ([#275](https://github.com/TestPlanIt/testplanit/issues/275)) ([917890f](https://github.com/TestPlanIt/testplanit/commit/917890fbffd1e0e734d512da61364521fdacab35))

## [0.24.6](https://github.com/TestPlanIt/testplanit/compare/v0.24.5...v0.24.6) (2026-05-03)

### Bug Fixes

* **i18n:** localize magic-link email, validation errors, success toasts ([#274](https://github.com/TestPlanIt/testplanit/issues/274)) ([acea2d6](https://github.com/TestPlanIt/testplanit/commit/acea2d6670fc345d3a8a15f78a64179d11455131))

## [0.24.5](https://github.com/TestPlanIt/testplanit/compare/v0.24.4...v0.24.5) (2026-05-03)

### Bug Fixes

* **webhooks:** tenant-aware jobId, retention memory hygiene, raised PM2 ceilings ([#273](https://github.com/TestPlanIt/testplanit/issues/273)) ([590f91b](https://github.com/TestPlanIt/testplanit/commit/590f91b0c21d912d16ca0ff5f8f95f8e4ce7c0e0)), closes [#271](https://github.com/TestPlanIt/testplanit/issues/271)

## [0.24.4](https://github.com/TestPlanIt/testplanit/compare/v0.24.3...v0.24.4) (2026-05-03)

### Bug Fixes

* **i18n:** translate notifications for the four under-covered types ([#272](https://github.com/TestPlanIt/testplanit/issues/272)) ([a4c79bd](https://github.com/TestPlanIt/testplanit/commit/a4c79bdea48bbe9dd9d50889e7367a06cbd2a312))

## [0.24.3](https://github.com/TestPlanIt/testplanit/compare/v0.24.2...v0.24.3) (2026-05-03)

### Bug Fixes

* **webhooks:** make outbox + retention workers multi-tenant aware ([#271](https://github.com/TestPlanIt/testplanit/issues/271)) ([6731c68](https://github.com/TestPlanIt/testplanit/commit/6731c68329bfca35c5a73f43711a10d991968946))

## [0.24.2](https://github.com/TestPlanIt/testplanit/compare/v0.24.1...v0.24.2) (2026-05-03)

### Bug Fixes

* **comments:** enforce per-user project access on comment-mention notifications ([#269](https://github.com/TestPlanIt/testplanit/issues/269)) ([c82b565](https://github.com/TestPlanIt/testplanit/commit/c82b5657d92c46a6c4e7e5c589e592a2d857232a))
* **deps:** override transitive uuid to >=14.0.0 (GHSA-9w38-pjwr-2x88) ([#268](https://github.com/TestPlanIt/testplanit/issues/268)) ([834da4b](https://github.com/TestPlanIt/testplanit/commit/834da4b3b21ba398a808845dc53699eec0321554)), closes [#360](https://github.com/TestPlanIt/testplanit/issues/360) [#362](https://github.com/TestPlanIt/testplanit/issues/362)

## [0.24.1](https://github.com/TestPlanIt/testplanit/compare/v0.24.0...v0.24.1) (2026-05-03)

### Bug Fixes

* **integrations:** probe issue scopes + surface search errors ([#267](https://github.com/TestPlanIt/testplanit/issues/267)) ([212da3f](https://github.com/TestPlanIt/testplanit/commit/212da3f227d708e799b836e587ced28c53f62c61))

## [0.24.0](https://github.com/TestPlanIt/testplanit/compare/v0.23.1...v0.24.0) (2026-05-02)

### Features

* webhooks — two-way sync with issue trackers + outbound delivery ([#266](https://github.com/TestPlanIt/testplanit/issues/266)) ([2da2188](https://github.com/TestPlanIt/testplanit/commit/2da2188b91e12c7b23836677e28cb23108c8b6be)), closes [#1](https://github.com/TestPlanIt/testplanit/issues/1) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [#5](https://github.com/TestPlanIt/testplanit/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [#5](https://github.com/TestPlanIt/testplanit/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [#22c55e](https://github.com/TestPlanIt/testplanit/issues/22c55e) [#ef4444](https://github.com/TestPlanIt/testplanit/issues/ef4444) [#eab308](https://github.com/TestPlanIt/testplanit/issues/eab308) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [SC#5](https://github.com/TestPlanIt/SC/issues/5) [#4](https://github.com/TestPlanIt/testplanit/issues/4) [#5](https://github.com/TestPlanIt/testplanit/issues/5)

### Bug Fixes

* **docs:** correct link to API Tokens in user profile documentation ([9beda77](https://github.com/TestPlanIt/testplanit/commit/9beda778d66be84d031cfa75225edb190041669f))

## [0.23.1](https://github.com/TestPlanIt/testplanit/compare/v0.23.0...v0.23.1) (2026-04-30)

### Enhancements

* **llm:** LLM custom billing period, admin UX redesign, and capability probing ([#265](https://github.com/TestPlanIt/testplanit/issues/265)) ([6c1ee8b](https://github.com/TestPlanIt/testplanit/commit/6c1ee8b9372d222eafafc81067f528ecbe6734e1))

## [0.23.0](https://github.com/TestPlanIt/testplanit/compare/v0.22.22...v0.23.0) (2026-04-30)

### Features

* **notifications:** SSE transport replaces bell polling ([#264](https://github.com/TestPlanIt/testplanit/issues/264)) ([bcf9d9f](https://github.com/TestPlanIt/testplanit/commit/bcf9d9f35e49e1634b3f52511bbaeae60fc10c8e))

## [0.22.22](https://github.com/TestPlanIt/testplanit/compare/v0.22.21...v0.22.22) (2026-04-29)

### Bug Fixes

* minor UI polish and form-submission bug sweep ([#260](https://github.com/TestPlanIt/testplanit/issues/260)) ([7da0162](https://github.com/TestPlanIt/testplanit/commit/7da016250f4fc700f441bbbf1f78296989fa3e84)), closes [#result-history](https://github.com/TestPlanIt/testplanit/issues/result-history)

## [0.22.21](https://github.com/TestPlanIt/testplanit/compare/v0.22.20...v0.22.21) (2026-04-29)

### Enhancements

* **llms:** Enhance/generate context from issue linked ([#257](https://github.com/TestPlanIt/testplanit/issues/257)) ([c3e796a](https://github.com/TestPlanIt/testplanit/commit/c3e796ac799496b5440b39e23ac4d3fbbebb7857)), closes [#1](https://github.com/TestPlanIt/testplanit/issues/1) [owner/repo#number](https://github.com/owner/repo/issues/number) [#42](https://github.com/TestPlanIt/testplanit/issues/42) [acme/foo/bar#42](https://github.com/acme/foo/bar/issues/42) [owner/repo#number](https://github.com/owner/repo/issues/number)

## [0.22.20](https://github.com/TestPlanIt/testplanit/compare/v0.22.19...v0.22.20) (2026-04-28)

### Bug Fixes

* **deps:** bump postcss to 8.5.10 to address XSS advisory ([#253](https://github.com/TestPlanIt/testplanit/issues/253)) ([0be5e13](https://github.com/TestPlanIt/testplanit/commit/0be5e13c1c2a595304f7b9539d78b4955206459e))

### Enhancements

* smooth out jira issue create-and-link flow ([#256](https://github.com/TestPlanIt/testplanit/issues/256)) ([7dfdb6a](https://github.com/TestPlanIt/testplanit/commit/7dfdb6a97a0808cefb2348526dce49d7fadc3494))

## [0.22.19](https://github.com/TestPlanIt/testplanit/compare/v0.22.18...v0.22.19) (2026-04-28)

### Bug Fixes

* workflow type translations + linked projects on integration card ([#252](https://github.com/TestPlanIt/testplanit/issues/252)) ([66b5923](https://github.com/TestPlanIt/testplanit/commit/66b5923489727ae2592930d6d2b8e5cfde63e5b2))

## [0.22.18](https://github.com/TestPlanIt/testplanit/compare/v0.22.17...v0.22.18) (2026-04-26)

### Bug Fixes

* **repository:** keep browser history clean on auto-select + folder click ([#250](https://github.com/TestPlanIt/testplanit/issues/250)) ([42ce3a7](https://github.com/TestPlanIt/testplanit/commit/42ce3a73658eb725c8ba8e302def4639052a8d41))

## [0.22.17](https://github.com/TestPlanIt/testplanit/compare/v0.22.16...v0.22.17) (2026-04-26)

### Bug Fixes

* **tests:** repair unit tests broken by TooltipProvider hoisting ([8ee514f](https://github.com/TestPlanIt/testplanit/commit/8ee514f6f3011c29b95afa4424ab25a613518d33)), closes [#249](https://github.com/TestPlanIt/testplanit/issues/249)

## [0.22.16](https://github.com/TestPlanIt/testplanit/compare/v0.22.15...v0.22.16) (2026-04-25)

### Bug Fixes

* **admin:** atomic soft-delete-aware create endpoints for users + tags ([#248](https://github.com/TestPlanIt/testplanit/issues/248)) ([0ad6ac9](https://github.com/TestPlanIt/testplanit/commit/0ad6ac98a8fede934c62975774d1012485d7e1c8))

## [0.22.15](https://github.com/TestPlanIt/testplanit/compare/v0.22.14...v0.22.15) (2026-04-25)

### Bug Fixes

* **e2e:** unblock 9 skipped/flaky tests + spawn BullMQ workers in E2E ([#247](https://github.com/TestPlanIt/testplanit/issues/247)) ([9ab4dc6](https://github.com/TestPlanIt/testplanit/commit/9ab4dc65fc360abbe67584b5f079b132c5e8b32a))

## [0.22.14](https://github.com/TestPlanIt/testplanit/compare/v0.22.13...v0.22.14) (2026-04-25)

### Bug Fixes

* **e2e:** unblock ACL-06 + collision detection by fixing test pollution and shared-state races ([99e05e0](https://github.com/TestPlanIt/testplanit/commit/99e05e0b63358d8cb92261859457bb888736fbe1))

## [0.22.13](https://github.com/TestPlanIt/testplanit/compare/v0.22.12...v0.22.13) (2026-04-24)

### Bug Fixes

* **reports:** Fix/report type switch stale dimensions ([#245](https://github.com/TestPlanIt/testplanit/issues/245)) ([fc287db](https://github.com/TestPlanIt/testplanit/commit/fc287db33026501a419ba370e9553cfeef424249))

## [0.22.12](https://github.com/TestPlanIt/testplanit/compare/v0.22.11...v0.22.12) (2026-04-24)

### Enhancements

* **users:** Enhancement/create user password hardening ([#242](https://github.com/TestPlanIt/testplanit/issues/242)) ([08c61c9](https://github.com/TestPlanIt/testplanit/commit/08c61c9bae134789dbc95913291f95219c64afec))

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
