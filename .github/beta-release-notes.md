**Beta pre-release of TestPlanIt 1.0 — source only.**

> 🔒 **This is release candidate 2 for 1.0** (superseding beta.20). The beta
> channel is locked: barring showstoppers, this build is what graduates to
> `main` as **v1.0.0**. Only critical fixes land between now and release — if
> you've been waiting to try the beta, this is the one to test.

There is no prebuilt Docker image for betas: official images bake
`BASE_DOMAIN=testplanit.com` into the build and can't be reused by other
installs. You build it yourself from the source attached below.

> ⚠️ This is pre-release software. **Back up your database before trying it.**

### What's new since beta.20

#### AI test case generation

- **Generation no longer fails on models that think before answering.** With
  Claude Opus 5, and any model that returns a reasoning block ahead of its
  answer, the outline step crashed with
  `Cannot read properties of undefined (reading 'trim')`. The Anthropic
  adapter now reads every text block of the response, a refusal is reported as
  a content-filter stop rather than an adapter error, and the OpenAI adapter
  handles a null message body the same way.
- **Clearer errors when a case can't be generated.** An empty response is
  explained from the provider's finish reason — the output budget was used up
  by reasoning, the provider declined, or a transient blank — with the matching
  suggestion (raise Default Max Tokens, rephrase, retry). A malformed response
  is only reported as "truncated" when the provider says it was cut off or the
  JSON is visibly incomplete; a formatting slip on a completed response now
  says so instead of sending you after token limits.
- **Retry a single test case.** A card that failed or was cancelled in the
  review step has a **Retry** button, so one bad expansion no longer means
  regenerating the whole batch.

#### Admin

- **Token settings help text corrected.** The _Default Max Tokens_ popover on
  an AI model and the _Max Output Tokens_ popover in Prompt Config now say
  which features use which: Test Case Generation, Markdown Test Case Parsing,
  the Editor Writing Assistant, and Smart Test Case Selection always use the
  model's Default Max Tokens; Export Code Generation, AI Tag Suggestions, AI
  Step Derivation, and the Automation Candidates Report use the prompt's Max
  Output Tokens. The
  [LLM Integrations](https://docs.testplanit.com/docs/user-guide/llm-integrations#token-limits)
  and
  [Prompt Configurations](https://docs.testplanit.com/docs/user-guide/prompt-configurations)
  guides say the same.

#### Contributor tooling

- **Crowdin sync moved to CLI v5.** `pnpm crowdin:sync` and the sync workflow
  now call `crowdin auto-translate --scope untranslated`; v5 removed
  `pre-translate`.
