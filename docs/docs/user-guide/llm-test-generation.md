---
title: Test Case Generation
---

# AI-Powered Test Case Generation

Generate comprehensive test cases from requirements, issues, documentation, or live web pages using AI.

## Prerequisites

Before using AI test generation, ensure:

- At least one active LLM integration is configured
- At least one active issue tracking integration (for issue-based generation)
- Project has test case templates configured
- User has appropriate permissions for test case creation

## Generation Wizard

The AI test generation wizard guides you through a 4-step process:

### Step 1: Select Source

Choose your test generation source:

**From Issue:**

- Select an existing issue from your integrated tracking system. Supports Jira, GitHub Issues, and Azure DevOps work items.
- The selected issue's title, description, and comment thread are included in the LLM context.
- Issues directly linked to your selected issue (one hop) are also included automatically — for example, the Stories under an Epic, or the issues an issue blocks / is-blocked-by. Each linked issue contributes its own title, description, and comments to the context.
- A "Linked issues that will be included" section appears in the issue preview after selection, listing each linked issue's key and link type so you can preview what context the AI will see before generating.
- Linked-issue traversal is capped at one hop. Issues linked to your linked issues are not followed.
- Image attachments on the selected issue — screenshots pasted into Jira descriptions and comments, files attached to Azure DevOps work items — are offered as visual context; see [Images as Generation Context](#images-as-generation-context).
- "Linked" means whatever the tracker reports as a linked relationship:
  - **Jira**: `issuelinks` (blocks/blocked-by, relates-to, duplicates, custom Jira link types), parent/subtask hierarchy, and the Epic-Link custom field
  - **GitHub**: native sub-issues and timeline cross-references (mentions in other issues or pull requests that link both ways)
  - **Azure DevOps**: every `System.LinkTypes.*` relationship the work item reports — Related, Hierarchy-Forward/Reverse (parent/child), Successor, Predecessor, Affects-Forward/Reverse, Tested-By/Tests, Duplicate-Forward/Reverse

**From Document:**

- Paste or write requirements into a rich-text editor
- Images embedded in the document — pasted screenshots, uploaded mockups — can be sent to the AI as visual context; see [Images as Generation Context](#images-as-generation-context)
- Ideal for early-stage requirements or internal specifications

**From URL:**

- Enter a web page URL to crawl and analyze
- Choose between two modes:
  - **Application**: Treats the URL as a live application and generates test cases for its functionality
  - **Requirements**: Treats the page content as a requirements document
- **Follow Links**: Optionally crawl linked pages on the same domain
  - Configure maximum crawl depth (1-5 levels)
  - Configure maximum pages to crawl (1-50)
- Pages are crawled in the background while you wait in the wizard
- The crawl respects `robots.txt` rules and skips disallowed pages
- **Recent Generations**: When you select the URL tab, any recent crawl jobs for the current project are shown above the URL input. You can click to resume a previous generation or remove it with the X button.

### Step 2: Select Template

- Choose the test case template to use for generated cases
- All template fields are displayed for review
- Select which fields to populate with AI-generated content
- Fields start selected or deselected according to the template's per-field generation default, configured by an administrator in Templates & Fields (fields are included by default unless excluded there)
- Required fields are always included and cannot be deselected
- Optional fields can be included or excluded based on your needs, regardless of the template default
- Deselected fields are named in the AI request as fields it must not return, and any value it returns for one is discarded — so an excluded field is never populated, never shown in the review step, and never written on import
- Your selection persists for the rest of the wizard. Changing the template resets it to that template's defaults.

### Step 3: Configure Generation

**Quantity Options:**

- **Just One**: Generate a single, comprehensive test case
- **A Couple**: Generate 2-3 focused test cases
- **A Few**: Generate 3-5 test cases covering different scenarios
- **Several**: Generate 5-8 test cases with good coverage
- **Many**: Generate 8-12 test cases for thorough testing
- **Maximum**: Generate comprehensive test suite (12+ cases)

**Additional Instructions:**

- Provide specific guidance for the AI
- Example: "Focus on security testing scenarios"
- Common suggestions available as quick-add buttons:
  - Security testing
  - Edge cases
  - Happy path scenarios
  - Mobile compatibility
  - API testing
  - Accessibility testing

**Auto-Generate Tags:**

- Enable to automatically create and assign relevant tags
- Tags are generated based on test content and context
- Existing tags are reused when appropriate

### Step 4: Review and Import

- Test cases stream in as they are generated, appearing as collapsible cards
- Click the chevron next to a test case name to expand and view all fields
- Each case shows:
  - Name
  - Populated template fields (description, steps, priority, etc.)
  - Generated tags (if enabled)
  - Folder assignment (for multi-page URL generation)
- Select specific test cases to import using checkboxes
- Bulk select/deselect options available
- Edit any test case inline before importing (click the Edit button)
- Tags can be added or removed interactively during editing using tag badges with add/remove controls

**Linked-issue context notice:**

- If linked-issue content had to be dropped to fit the LLM's token budget, an alert appears above the generated test cases listing which linked issues were excluded (by their tracker-native key — e.g., `PROJ-123` for Jira, `#456` for GitHub, the work item ID for ADO). The source issue itself is always included in full; only linked-issue content can be trimmed for budget. When everything fits, no notice is shown.

**For URL-based generation with multiple pages:**

- A page filter dropdown allows you to view test cases from a specific page
- Each test case shows which folder it will be imported into (derived from the page URL path)
- Test cases from each page are placed in their own subfolder on import
- Progress is saved after each page completes, so you can safely close the wizard and return later without losing completed pages

**Resuming a previous generation:**

- Recent URL generations appear at the top of the URL tab when you open the wizard
- Each entry shows the URL, page count, test case count (if generated), and completion date in your preferred date format
- Entries marked "Ready to review" have cached test cases that load instantly
- Entries marked "Click to generate test cases" have crawled pages ready for LLM generation
- In-progress crawls show a spinner with the current page count
- You can remove any entry using the X button (with confirmation)
- Generated results are cached for 7 days

## Generating from the Jira Issue Panel

If your team uses the **TestPlanIt for Jira** app, you can generate test cases for an issue without leaving Jira. The app's issue panel includes a **Generate Test Cases** button that runs the same AI generation described above and saves the results back to TestPlanIt, linked to the Jira issue.

### Panel prerequisites

- The **TestPlanIt for Jira** app is installed and configured with your instance URL and a Forge API key — see [Issue Tracking and External Integrations](./integrations.md).
- Your Jira account's email matches an **active TestPlanIt user** who has access to the target project. Generation and the saved cases are attributed to that user.
- The target project has an active LLM integration.

The **Generate Test Cases** button only appears when all of the above are met. If your Jira account isn't linked to a TestPlanIt user, or you don't have access to any connected project, the button is hidden.

### Generating

1. Open a Jira issue and expand the **TestPlanIt** panel.
2. Click **Generate Test Cases** — available in the panel footer, and on the empty state when no tests are linked to the issue yet.
3. Configure the generation:
   - **Project** — defaults to the TestPlanIt project mapped to the issue's Jira project; switch to another connected project you have access to if needed.
   - **Template** — the project's default template is preselected.
   - **Destination folder** — choose one of:
     - **Create a new folder** named after the Jira ticket (e.g. `PROJ-123`). This is the default when the issue has no linked test cases yet.
     - **Use an existing folder** — pick any folder in the project's hierarchy. When the issue already has linked cases, this is the default, preselected to the folder those cases live in.
   - **How many cases**, **additional guidance**, and **auto-generate tags** — the same options as the wizard (auto-generate tags is on by default).
4. Click **Generate**. Cases stream into the panel as they are produced.
5. Select the cases you want and click **Save**. They are created in the chosen folder and linked to the Jira issue, so they appear in the panel's **Test Cases** section.

### Context and parity

Generation from the panel assembles the same LLM context as the in-app wizard's streaming generation: the issue's title, description, and comments; **linked Jira issues** (one hop) with their own titles, bodies, and comments; the test cases already linked to the issue, wherever they live in the repository; and existing test cases in the destination folder (when you generate into an existing folder). The same token-budgeting and trimming rules apply.

When the generating model is vision-capable, the issue's image attachments ride along automatically under the same limits as the wizard (up to 5 images, 4 MB each) — the panel offers no image picker.

Because linked cases do not depend on a folder, the panel has meaningful existing-case context even on the first generation for an issue that has no destination folder picked yet.

:::note
Parameter and starter-dataset generation is not offered from the Jira panel.
:::

## Generation Process

When you click "Generate":

**For Issue/Document sources:**

1. **Context Analysis**: The AI analyzes the source material, the test cases already linked to the source issue, and existing test cases in the folder
2. **Streaming Generation**: Test cases appear in real-time as the AI generates them, with partial field previews as data arrives
3. **Field Population**: Custom fields are populated with relevant content
4. **Quality Validation**: Generated content is validated for completeness

**For URL sources:**

1. **Background Crawl**: Pages are fetched in a background job (you'll see progress in the wizard)
2. **Content Extraction**: HTML is converted to clean markdown for analysis
3. **Per-Page Generation**: The AI generates test cases for each crawled page via streaming, with progress saved after each page
4. **Folder Organization**: Test cases are organized by source page for easy navigation

## Images as Generation Context

Screenshots and other images from your source material can be sent to the AI alongside the text, so mockups, error screenshots, and UI captures inform the generated test cases.

### Where images come from

- **From Issue**: image attachments on the selected issue — Jira attachments (including screenshots pasted into the description or comments) and files attached to Azure DevOps work items. Images referenced inline in a Jira description render as `[image: filename]` placeholders in the issue preview so you can see where they sit in the text.
- **From Document**: images embedded in the requirements editor. The saved preview marks each one as `[image N: filename]` at its position in the text.
- **From URL**: when screenshot capture is enabled for your installation, the crawler captures a screenshot of each page and offers it as context. This is off by default — an administrator enables it with the `CRAWL_SCREENSHOTS=true` environment variable and a Chromium executable (bundled in the official workers image; see `.env.example`).

### The image picker

After you select an issue or save a document, an **Images to include as context** section lists the images found:

- Up to **5 images** can be sent, each up to **4 MB**; PNG, JPEG, GIF, and WebP are supported
- Eligible images start **selected** — untick any you don't want sent
- Images over the size limit are listed but marked and cannot be selected

### Vision-capable models

Images are only sent when the model handling the generation supports image input. TestPlanIt detects this from the model name, and an administrator can override the detection per model — see [Model capability overrides](./llm-integrations.md#test-connection--model-capability-probing).

When the configured model does not support images, the picker stays visible but shows: _"The configured AI model does not support image input — selected images will not be sent."_ Generation proceeds with text only.

### Review notices

The review step reports what actually happened:

- _"N images sent as context: …"_ lists the images the AI received
- _"N images skipped (too large or unsupported): …"_ lists any that were excluded
- If images were selected but the model was not vision-capable, a notice reports they were not sent

Images are fetched by the TestPlanIt server at generation time and held in a short-lived cache for the duration of the generation; they are not copied into TestPlanIt's file storage.

## Generated Content Structure

### Test Case Fields

The AI populates the fields you selected in Step 2. Fields outside that selection — including template fields you deselected — are never populated.

**Common Fields:**

- **Name**: Descriptive, action-oriented test case names
- **Description**: Detailed test objectives and scope
- **Steps**: Detailed step/expected result pairs
- **Priority**: Inferred from source context (when a Priority dropdown field exists)
- **Preconditions**: Required setup or system state
- **Tags**: Contextually relevant tags (when auto-generate is enabled)

### Test Steps Format

Generated test steps follow a consistent structure:

```text
Step 1: Navigate to the login page
Expected Result: Login form is displayed with username and password fields

Step 2: Enter valid credentials (user@test.com / password123)
Expected Result: Credentials are accepted and validated

Step 3: Click the "Login" button
Expected Result: User is redirected to the dashboard
```

## Advanced Features

### Context Awareness

The AI considers:

- **Existing Test Cases**: Avoids duplication of current test scenarios in the folder
- **Cases Already Linked to the Source Issue**: Test cases anywhere in the repository that are already linked to the issue you are generating from are included first, ahead of folder cases, so regenerating for an issue extends its coverage instead of repeating it. This applies to any connected issue source — Jira, GitHub, Azure DevOps, or a manual issue — and does not depend on a folder, so it is the context that carries surfaces where no folder is involved, such as the milestone issue list or the Jira panel. A case that is both linked to the issue and in the folder is only sent once.
- **Project Domain**: Understands your application type and testing needs
- **Template Structure**: Adapts content to fit your specific template fields
- **Source Issue Comments**: The full comment thread on the selected issue is included alongside its title and description.
- **Linked Issues (1 hop)**: When the selected issue has linked issues in the same tracker, each linked issue's title, description, and comments are also included. Hierarchical relationships (Epic→Stories, parent→subtasks), bidirectional links (blocks/blocked-by, relates-to, duplicates), and tracker-specific link types are all followed. Linked-issue traversal does not recurse — issues linked to your linked issues are not followed.
- **Token Budget**: When the assembled context would exceed the LLM's token budget, linked-issue content is trimmed first (preserving the source issue's full body and comments), and the dropped linked issues are surfaced in an alert on the generated-cases surface. Selected context images reserve a fixed share of the budget before text context is packed.
- **Context Images**: On vision-capable models, the selected source images (issue screenshots, embedded document images, page screenshots) are sent alongside the text — see [Images as Generation Context](#images-as-generation-context).

### Field Selection Optimization

- **Required Fields**: Always populated with essential content
- **Optional Fields**: Can be selectively included based on your workflow
- **Deselected Fields**: Named in the request as fields the AI must not return, which also keeps them from consuming output tokens
- **Field Types**: Content is formatted appropriately for each field type:
  - **Text String**: Short text values relevant to the test case
  - **Text Long**: Rich text with detailed, multi-sentence content
  - **Dropdown**: A valid option value from the field's configured options
  - **Multi-Select**: An array of valid option values from the field's configured options
  - **Steps**: Structured step/expected result pairs
  - **Number / Integer**: Numeric values
  - **Checkbox**: Boolean true/false values
  - **Date**: ISO date strings (e.g., `2024-01-01`)

### Intelligent Tagging

Auto-generated tags include:

- **Functional Areas**: Based on the feature being tested (e.g., authentication, payment)
- **Test Types**: Based on testing approach (e.g., integration, unit, e2e)
- **Priorities**: Based on issue priority or risk assessment
- **Platforms**: Based on mentioned platforms or environments

Tags can be edited before import: click Edit on any test case to add, remove, or rename tags using the interactive tag editor. Tags are sanitized to remove special characters, matching the same rules used elsewhere in the application.

### URL Crawling Details

When generating from a URL:

- **Same-domain only**: Only pages on the same domain as the seed URL are crawled
- **Redirect handling**: If the seed URL redirects (e.g., `example.com` to `www.example.com`), the final hostname is used for link filtering
- **Content deduplication**: Pages with identical content are automatically skipped
- **SPA detection**: Single-page applications that require JavaScript rendering are flagged with a warning
- **Polite crawling**: A 500ms delay between page fetches prevents overloading target servers
- **robots.txt**: Disallowed paths are skipped (the seed URL itself is always fetched)
- **SSRF protection**: Private/internal IP addresses and cloud metadata endpoints are blocked. When screenshot capture is enabled, the same blocking applies to every sub-resource the page itself loads during rendering
- **Incremental saves**: Test cases are saved to a server-side cache after each page completes, so closing the wizard mid-generation preserves all completed pages
- **Page screenshots** (optional): with `CRAWL_SCREENSHOTS=true` and a Chromium executable configured, each crawled page is also captured as a screenshot and offered to vision-capable models as context — see [Images as Generation Context](#images-as-generation-context)

## Best Practices

### Source Material Quality

1. **Detailed Issues**: More detailed issues produce better test cases
2. **Clear Requirements**: Well-written requirements lead to comprehensive test coverage
3. **Include Context**: Add comments or descriptions that explain business logic
4. **Specify Constraints**: Mention any technical limitations or dependencies

### URL Generation Tips

1. **Start with the main page**: Use the most relevant page as the seed URL
2. **Limit page count**: Start with fewer pages and increase if needed
3. **Use Application mode**: For testing live web applications
4. **Use Requirements mode**: For specification or documentation pages
5. **Add notes**: Use the additional instructions field to focus generation on specific areas
6. **Safe to close**: You can close the wizard after any page completes — your results are saved and available in the Recent Generations list

### Template Configuration

1. **Field Naming**: Use descriptive field names that clearly indicate their purpose
2. **Field Types**: Choose appropriate field types for different content types
3. **Required vs Optional**: Mark fields as required only if they're truly essential
4. **Field Ordering**: Arrange fields logically in the template

### Generation Settings

1. **Start Small**: Begin with fewer test cases and adjust based on quality
2. **Review Carefully**: Always review generated content before importing
3. **Iterate**: Use additional instructions to refine generation
4. **Tag Strategy**: Develop a consistent tagging strategy for your project

### Quality Assurance

1. **Review Generated Steps**: Ensure test steps are executable and complete
2. **Validate Field Content**: Check that generated content fits field constraints
3. **Test Data Verification**: Ensure generated test data is appropriate and valid
4. **Link Verification**: Confirm that generated test cases properly link to source issues

## Troubleshooting

### Common Issues

**No AI providers available:**

- Verify that at least one LLM integration is configured and active
- Check that the integration is assigned to your project
- Confirm your user has appropriate permissions

**Generation fails with timeout:**

- Try reducing the quantity of test cases to generate
- Simplify additional instructions
- Check API rate limits for your provider

**Poor quality test cases:**

- Provide more detailed source material
- Add specific instructions about testing focus
- Review and refine your template field definitions
- Consider using a more capable AI model

**Fields not populating correctly:**

- Verify field types in your template
- Check field naming and descriptions
- Ensure selected fields are appropriate for AI generation

**URL crawl returns no content:**

- Verify the URL is accessible from the server
- Check if the page requires authentication
- Some single-page applications (SPAs) may not render without JavaScript
- Try entering the URL directly in a browser to verify it loads

**"This generation is no longer available":**

- The cached results have expired (7-day limit) or were removed
- Start a new generation from the Generate Test Cases wizard

**Images were not sent to the AI:**

- The configured model may not support image input — the picker shows a notice when this is the case; switch the generation to a vision-capable model or override the detection (see [Model capability overrides](./llm-integrations.md#test-connection--model-capability-probing))
- Images over 4 MB are always skipped, as is anything beyond the 5-image limit
- Only PNG, JPEG, GIF, and WebP are sent
- The review step's context notice reports exactly which images were sent and which were skipped

### Error Messages

**"No AI model is configured"**

- Add an LLM integration in project settings
- Ensure the integration is active and properly configured

**"API quota exceeded"**

- Your AI provider's usage limits have been reached
- Wait for quota reset or upgrade your plan
- Consider switching to a different provider

**"Invalid API configuration"**

- Check API keys and credentials
- Verify the model name is correct
- Test the integration connection

**"Blocked private/internal URL"**

- Self-hosted LLM providers (Ollama, Custom LLM) using localhost or private IPs require the `ALLOWED_PRIVATE_HOSTS` environment variable
- Add the hostname to the comma-separated list (e.g., `ALLOWED_PRIVATE_HOSTS=localhost,192.168.1.100`)

### Performance Optimization

1. **Model Selection**: Balance quality needs with response time
2. **Field Selection**: Only populate fields you actually need
3. **URL Crawl Limits**: Keep page counts reasonable (5-10 pages is usually sufficient)
4. **Template Optimization**: Streamline templates for AI generation
