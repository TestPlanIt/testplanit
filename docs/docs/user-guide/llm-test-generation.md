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

- Select an existing issue from your integrated tracking system
- Issues are automatically fetched with full context including descriptions and comments
- Supports Jira, GitHub Issues, Azure DevOps work items

**From Document:**

- Enter requirements directly into the form
- Provide title, description, and priority
- Ideal for early-stage requirements or internal specifications

**From URL:**

- Enter a web page URL to crawl and analyze
- Choose between two modes:
  - **Application**: Treats the URL as a live application and generates test cases for its functionality
  - **Requirements**: Treats the page content as a requirements document
- **Follow Links**: Optionally crawl linked pages on the same domain
  - Configure maximum crawl depth (1-5 levels)
  - Configure maximum pages to crawl (1-50)
- Pages are crawled in the background, so you can continue working while waiting
- A notification is sent when crawling completes, allowing you to review results later
- The crawl respects `robots.txt` rules and skips disallowed pages

### Step 2: Select Template

- Choose the test case template to use for generated cases
- All template fields are displayed for review
- Select which fields to populate with AI-generated content
- Required fields are automatically included
- Optional fields can be included or excluded based on your needs

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
- Tags can be added or removed interactively during editing

**For URL-based generation with multiple pages:**

- A page filter dropdown allows you to view test cases from a specific page
- Each test case shows which folder it will be imported into (derived from the page URL path)
- Test cases from each page are placed in their own subfolder on import

**Notification Link:**

- After generating test cases, you can close the wizard and return later via the notification link
- Previously generated test cases are preserved for 24 hours and restored without re-generating

## Generation Process

When you click "Generate":

**For Issue/Document sources:**

1. **Context Analysis**: The AI analyzes the source material and existing test cases in the folder
2. **Streaming Generation**: Test cases appear in real-time as the AI generates them
3. **Field Population**: Custom fields are populated with relevant content
4. **Quality Validation**: Generated content is validated for completeness

**For URL sources:**

1. **Background Crawl**: Pages are fetched in a background job (you'll see progress)
2. **Content Extraction**: HTML is converted to clean markdown for analysis
3. **Per-Page Generation**: The AI generates test cases for each crawled page via streaming
4. **Folder Organization**: Test cases are organized by source page for easy navigation

## Generated Content Structure

### Test Case Fields

The AI populates fields based on your selected template. Only template-defined fields are included in the output.

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
- **Project Domain**: Understands your application type and testing needs
- **Template Structure**: Adapts content to fit your specific template fields
- **Issue History**: Incorporates comments and updates from linked issues

### Field Selection Optimization

- **Required Fields**: Always populated with essential content
- **Optional Fields**: Can be selectively included based on your workflow
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

### URL Crawling Details

When generating from a URL:

- **Same-domain only**: Only pages on the same domain as the seed URL are crawled
- **Redirect handling**: If the seed URL redirects (e.g., `example.com` to `www.example.com`), the final hostname is used for link filtering
- **Content deduplication**: Pages with identical content are automatically skipped
- **SPA detection**: Single-page applications that require JavaScript rendering are flagged with a warning
- **Polite crawling**: A 500ms delay between page fetches prevents overloading target servers
- **robots.txt**: Disallowed paths are skipped (the seed URL itself is always fetched)
- **SSRF protection**: Private/internal IP addresses and cloud metadata endpoints are blocked

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

**Notification says "already generated and imported":**

- The test cases from this crawl have already been imported
- Start a new generation from the Generate Test Cases button

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
