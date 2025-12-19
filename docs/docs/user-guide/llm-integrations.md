---
sidebar_label: 'AI Models'
title: 'AI-Powered Test Case Generation'
---

# AI-Powered Test Case Generation

TestPlanIt integrates with leading AI providers to automatically generate comprehensive test cases from requirements, issues, and documentation. This powerful feature uses Large Language Models (LLMs) to understand your project context and create detailed, executable test scenarios.

## Overview

The AI test case generation feature allows you to:

- **Generate from Issues**: Create test cases directly from Jira, GitHub, or Azure DevOps issues
- **Generate from Documents**: Create test cases from requirements documents or specifications
- **Smart Field Population**: Automatically populate custom template fields with relevant content
- **Context-Aware Generation**: Considers existing test cases to avoid duplication
- **Flexible Quantity Control**: Generate anywhere from single test cases to comprehensive test suites
- **Auto-tagging**: Automatically generate and assign relevant tags

## Supported AI Providers

### OpenAI

- **Models**: GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
- **Authentication**: API Key
- **Strengths**: Excellent natural language understanding, reliable structured output

### Google Gemini

- **Models**: Gemini Pro, Gemini Pro Vision
- **Authentication**: API Key
- **Strengths**: Strong reasoning capabilities, cost-effective

### Anthropic Claude

- **Models**: Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku
- **Authentication**: API Key
- **Strengths**: Excellent instruction following, safety-focused

### Ollama (Self-Hosted)

- **Models**: Llama 2, Code Llama, Mistral, and other open-source models
- **Authentication**: None (local deployment)
- **Strengths**: Privacy, no API costs, customizable

### Azure OpenAI

- **Models**: GPT-4, GPT-3.5 Turbo (deployed on Azure)
- **Authentication**: API Key + Deployment Name
- **Strengths**: Enterprise features, data residency, SLA guarantees

### Custom LLM

- **Models**: Any OpenAI-compatible API endpoint
- **Authentication**: Configurable (API Key)
- **Strengths**: Maximum flexibility, support for custom models

## System Configuration

### Administrator Setup

1. Navigate to **Administration** → **LLM Integrations**
2. Click **Add LLM Integration**
3. Configure your preferred AI provider:

```yaml
Name: "Production OpenAI"
Provider: OPENAI
Model: gpt-4-turbo-preview
Status: ACTIVE
```

#### OpenAI Configuration

```text
API Key: sk-...your-openai-api-key
Model: gpt-4-turbo-preview
Max Tokens: 4096
Temperature: 0.7
```

#### Google Gemini Configuration

```text
API Key: your-gemini-api-key
Model: gemini-pro
Max Tokens: 8192
Temperature: 0.7
```

#### Anthropic Claude Configuration

```text
API Key: your-anthropic-api-key
Model: claude-3-sonnet-20240229
Max Tokens: 4096
Temperature: 0.7
```

#### Ollama Configuration

```text
Base URL: https://your-ollama-server.example.com:11434
Model: llama2:13b
Max Tokens: 4096
Temperature: 0.7
```

#### Azure OpenAI Configuration

```text
API Key: your-azure-openai-key
Endpoint: https://your-resource.openai.azure.com/
Deployment Name: gpt-4-deployment
API Version: 2024-02-15-preview
Max Tokens: 4096
Temperature: 0.7
```

#### Custom LLM Configuration

```text
Base URL: https://your-custom-endpoint.com/v1
API Key: your-custom-api-key
Model: your-model-name
Max Tokens: 4096
Temperature: 0.7
```

**Note**: Custom LLM endpoints must be compatible with the OpenAI API format.

### Endpoint URL Requirements

For security reasons, custom endpoint URLs are validated to prevent Server-Side Request Forgery (SSRF) attacks:

**Standard Providers (OpenAI, Anthropic, Gemini):**

- Only official provider URLs are accepted
- OpenAI: `https://api.openai.com`
- Anthropic: `https://api.anthropic.com`
- Gemini: `https://generativelanguage.googleapis.com`

**Self-Hosted Providers (Ollama, Azure OpenAI, Custom LLM):**

- Custom endpoint URLs are allowed but must use publicly accessible addresses
- The following are **blocked** for security:
  - `localhost`, `127.0.0.1`, `0.0.0.0`
  - Private IP ranges: `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`
  - Cloud metadata endpoints: `169.254.169.254`, `*.internal`
  - IPv6 loopback addresses

If you need to connect to a self-hosted LLM running on a local network, you must expose it through a publicly accessible URL or use a reverse proxy with proper authentication.

### Project Assignment

After creating an LLM integration:

1. Go to **Project Settings** → **LLM Integrations**
2. Select the integration from available options
3. Configure project-specific settings:
   - Default generation parameters
   - Field selection preferences
   - Auto-tagging preferences
4. Save settings

## Using AI Test Generation

### Prerequisites

Before using AI test generation, ensure:

- At least one active LLM integration is configured
- At least one active issue tracking integration (for issue-based generation)
- Project has test case templates configured
- User has appropriate permissions for test case creation

### Generation Wizard

The AI test generation wizard guides you through a 4-step process:

#### Step 1: Select Source

Choose your test generation source:

**From Issue:**

- Select an existing issue from your integrated tracking system
- Issues are automatically fetched with full context including descriptions and comments
- Supports Jira, GitHub Issues, Azure DevOps work items

**From Document:**

- Enter requirements directly into the form
- Provide title, description, and priority
- Ideal for early-stage requirements or internal specifications

#### Step 2: Select Template

- Choose the test case template to use for generated cases
- All template fields are displayed for review
- Select which fields to populate with AI-generated content
- Required fields are automatically included
- Optional fields can be included or excluded based on your needs

#### Step 3: Configure Generation

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

#### Step 4: Review and Import

- Review all generated test cases
- Each case shows:
  - Name and description
  - Generated test steps (if applicable)
  - Populated template fields
  - Generated tags (if enabled)
  - Priority and automation status
- Select specific test cases to import
- Bulk select/deselect options available

### Generation Process

When you click "Generate":

1. **Context Analysis**: The AI analyzes the source material and existing test cases
2. **Template Processing**: Template fields and requirements are processed
3. **Content Generation**: Test cases are generated based on your specifications
4. **Field Population**: Custom fields are populated with relevant content
5. **Tag Generation**: Tags are automatically created (if enabled)
6. **Quality Validation**: Generated content is validated for completeness

## Generated Content Structure

### Test Case Fields

The AI automatically populates:

**Core Fields:**

- **Name**: Descriptive, action-oriented test case names
- **Description**: Detailed test objectives and scope (if template field exists)
- **Priority**: Inferred from source issue priority or requirement importance

**Template Fields:**

- **Preconditions**: Required setup or system state
- **Test Data**: Sample data needed for execution
- **Environment**: Target testing environment
- **Expected Results**: Detailed expected outcomes
- **Post-conditions**: Expected system state after testing

**System Fields:**

- **Steps**: Detailed action/expected result pairs
- **Tags**: Contextually relevant tags
- **Automated**: Suggestion for automation potential
- **Estimate**: Time estimate based on complexity

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

- **Existing Test Cases**: Avoids duplication of current test scenarios
- **Project Domain**: Understands your application type and testing needs
- **Template Structure**: Adapts content to fit your specific template fields
- **Issue History**: Incorporates comments and updates from linked issues

### Field Selection Optimization

- **Required Fields**: Always populated with essential content
- **Optional Fields**: Can be selectively included based on your workflow
- **Field Types**: Content is formatted appropriately for each field type:
  - Rich text fields receive formatted content
  - Dropdown fields receive valid option values
  - Multi-select fields receive appropriate value arrays

### Intelligent Tagging

Auto-generated tags include:

- **Functional Areas**: Based on the feature being tested (e.g., authentication, payment)
- **Test Types**: Based on testing approach (e.g., integration, unit, e2e)
- **Priorities**: Based on issue priority or risk assessment
- **Platforms**: Based on mentioned platforms or environments

## Best Practices

### Source Material Quality

1. **Detailed Issues**: More detailed issues produce better test cases
2. **Clear Requirements**: Well-written requirements lead to comprehensive test coverage
3. **Include Context**: Add comments or descriptions that explain business logic
4. **Specify Constraints**: Mention any technical limitations or dependencies

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

### Performance Optimization

1. **Model Selection**: Balance quality needs with response time
2. **Batch Processing**: Generate multiple test cases in single requests when possible
3. **Field Selection**: Only populate fields you actually need
4. **Template Optimization**: Streamline templates for AI generation

## API Integration

For programmatic access to AI test generation:

### Key Endpoints

**LLM Integrations:**

- `GET /api/llm-integrations` - List available integrations
- `POST /api/llm-integrations/test-connection` - Test integration
- `GET /api/llm-integrations/{id}/models` - Get available models

**Test Generation:**

- `POST /api/llm/generate-test-cases` - Generate test cases
- `POST /api/llm/validate-content` - Validate generated content
- `GET /api/llm/generation-history` - Get generation history

### Example Request

```javascript
POST /api/llm/generate-test-cases
{
  "projectId": 123,
  "issue": {
    "key": "PROJ-456",
    "title": "User login functionality",
    "description": "Implement secure user authentication..."
  },
  "template": {
    "id": 789,
    "fields": [...selectedFields]
  },
  "context": {
    "userNotes": "Focus on security testing",
    "existingTestCases": [...],
    "folderContext": 10
  },
  "quantity": "several",
  "autoGenerateTags": true
}
```

## Security Considerations

### Data Privacy

- **API Requests**: Source material is sent to AI providers for processing
- **Retention**: Most providers don't retain request data (verify with your provider)
- **Sensitive Data**: Avoid including sensitive information in source material
- **Self-Hosted Options**: Consider Ollama for maximum data privacy

### Access Control

- **Permission Model**: Same as regular test case creation
- **Audit Logging**: All AI generation activities are logged
- **Rate Limiting**: Built-in rate limiting prevents abuse

## Migration and Updates

### Upgrading AI Providers

1. Create new integration with updated settings
2. Test generation quality with new provider
3. Update project assignments
4. Archive old integration when satisfied

### Model Updates

- New models are automatically available when providers release them
- Update model names in integration settings
- Test generation quality with new models before switching

## Monitoring and Analytics

### Usage Metrics

Track important metrics in the admin dashboard:

- **Generation Volume**: Number of test cases generated per period
- **Success Rate**: Percentage of successful generations
- **User Adoption**: Which teams are using AI generation
- **Cost Tracking**: API usage and associated costs

### Quality Metrics

- **Review Rate**: Percentage of generated cases that are reviewed before import
- **Acceptance Rate**: Percentage of generated cases that are imported
- **Modification Rate**: How often generated cases are edited post-import

## AI-Powered Test Case Selection (Magic Select)

The Magic Select feature uses AI to intelligently suggest relevant test cases when creating a test run. Based on the test run's name, description, documentation, and linked issues, the AI analyzes your test case repository and recommends the most appropriate cases to include.

### Magic Select Overview

Magic Select helps you:

- **Save Time**: Quickly identify relevant test cases from large repositories
- **Improve Coverage**: Ensure you don't miss related test cases
- **Leverage Context**: Use test run metadata to find matching cases
- **Include Linked Cases**: Automatically add test cases that are linked to suggested cases

### Using Magic Select

#### Magic Select Prerequisites

- At least one active LLM integration configured for your project
- Test cases in your repository
- Elasticsearch configured (optional, but improves performance for large repositories)

#### Step-by-Step Usage

1. **Create a Test Run**: Click "Add Test Run" and fill in the first step with:
   - Test run name (required)
   - Description (optional but improves suggestions)
   - Documentation (optional but improves suggestions)
   - Linked issues (optional but improves suggestions)

2. **Click Next**: Navigate to the test case selection step

3. **Click Magic Select**: The button appears alongside the "Selected Test Cases" button

4. **Configure Analysis** (for large repositories):
   - **Batch Size**: Choose how many test cases to analyze per AI request
   - **Clarification**: Add additional context to help the AI understand what you need

5. **Review Suggestions**: The AI presents:
   - Number of suggested test cases
   - Reasoning for the selection
   - Option to view and modify the suggestions

6. **Accept or Refine**:
   - **Accept**: Merge suggestions with any existing selection
   - **Refine**: Add clarification and re-run the analysis
   - **Cancel**: Keep your existing selection unchanged

### How It Works

#### Context Analysis

The AI analyzes several sources to understand your test run:

1. **Test Run Name**: Primary signal for matching relevant test cases
2. **Description**: Additional context about what's being tested
3. **Documentation**: Detailed requirements or specifications
4. **Linked Issues**: Issue titles and descriptions from Jira, GitHub, etc.

#### Test Case Matching

For each test case in your repository, the AI considers:

- **Name**: Primary matching criterion
- **Folder Path**: Organizational context
- **Tags**: Category and classification information
- **Custom Fields**: Additional metadata from your templates
- **Linked Cases**: Relationships between test cases

#### Search Pre-Filtering

For repositories with many test cases (default: 250+), Magic Select uses Elasticsearch to pre-filter before sending to the AI:

1. Keywords are extracted from your test run metadata
2. Elasticsearch finds potentially relevant test cases
3. Only matching cases are sent to the AI for detailed analysis

This significantly reduces AI processing time and cost for large repositories.

#### Progressive Score Reduction

When the initial search doesn't find results above the configured minimum score threshold, Magic Select automatically tries progressively lower thresholds to ensure relevant cases are found:

1. **Initial threshold**: Uses the configured `MAGIC_SELECT_MIN_SEARCH_SCORE` (default: 50.0)
2. **50% reduction**: If no results, tries half the threshold (25.0)
3. **75% reduction**: If still no results, tries quarter threshold (12.5)
4. **90% reduction**: Tries 10% of original (5.0)
5. **Minimum threshold**: As a last resort, uses a score of 1

This adaptive approach ensures that even queries with weak keyword matches (like generic test run names) will still return relevant results rather than falling back to analyzing all test cases, which would be slow and expensive for large repositories.

**Example log output:**

```text
=== Magic Select Search Pre-filter ===
Total cases in project: 23695
Search keywords: cloud forgot password functionality
Name terms for search: test run for cloud
No results at min_score 50 - trying lower threshold...
No results at min_score 25 - trying lower threshold...
Search returned 342 matching cases (min score: 12.5 reduced from 50)
Score range: 12.50 - 89.32
=== End Search Pre-filter ===
```

#### Linked Case Expansion

After the AI suggests test cases, Magic Select automatically includes any test cases that are linked to the suggestions:

- **Links To**: Cases that the suggested case links to
- **Links From**: Cases that link to the suggested case

This ensures you don't miss dependent or related test cases.

### Configuration

#### Environment Variables

Fine-tune Magic Select behavior with these optional environment variables:

**Truncation Limits** (characters, for token optimization):

```env
# Test case name truncation (default: 80)
MAGIC_SELECT_TRUNCATE_CASE_NAME=80

# Text Long field truncation (default: 100)
MAGIC_SELECT_TRUNCATE_TEXT_LONG=100

# Other field truncation (default: 100)
MAGIC_SELECT_TRUNCATE_OTHER_FIELD=100

# Issue description truncation (default: 250)
MAGIC_SELECT_TRUNCATE_ISSUE_DESC=250
```

**Search Pre-Filtering**:

```env
# Minimum cases before search pre-filtering activates (default: 250)
MAGIC_SELECT_SEARCH_THRESHOLD=250

# Minimum keyword length for search (default: 3)
MAGIC_SELECT_MIN_KEYWORD_LENGTH=3

# Minimum Elasticsearch score for relevance (default: 50.0)
MAGIC_SELECT_MIN_SEARCH_SCORE=50.0

# Maximum results from search pre-filter (default: 2000)
MAGIC_SELECT_MAX_SEARCH_RESULTS=2000
```

#### Adjusting for Your Repository

**Small Repositories** (< 250 cases):

- Search pre-filtering is skipped
- All cases are sent directly to the AI
- No configuration needed

**Medium Repositories** (250-1000 cases):

- Default settings work well
- Consider lowering `MAGIC_SELECT_MIN_SEARCH_SCORE` if too few cases match

**Large Repositories** (1000+ cases):

- Use batch processing for better results
- Consider increasing `MAGIC_SELECT_MAX_SEARCH_RESULTS` if relevant cases are missed
- Ensure Elasticsearch is configured and healthy

### Magic Select Best Practices

#### Writing Effective Test Run Names

Good names help the AI find relevant test cases:

```text
Good: "User Authentication - Login Flow Regression"
Good: "Payment Processing - Credit Card Validation"
Good: "Mobile App - iOS Push Notifications"

Poor: "Sprint 23 Testing"
Poor: "Bug Fixes"
Poor: "QA Testing"
```

#### Using Descriptions and Documentation

Add context that matches your test case content:

```text
Test run for verifying the new user registration flow including:
- Email validation
- Password strength requirements
- CAPTCHA verification
- Welcome email delivery
```

#### Linking Issues

Link relevant issues to improve suggestions:

- The AI reads issue titles and descriptions
- Multiple linked issues provide more context
- Issue priority helps identify critical test areas

#### Using Clarification

Add specific guidance when needed:

```text
"Focus on edge cases and error handling"
"Include all API endpoint tests"
"Prioritize security-related test cases"
"Only include automated test cases"
```

### Magic Select Troubleshooting

#### No Suggestions Returned

**Causes:**

- Test run name is too generic
- No test cases match the context
- Search pre-filter is too restrictive

**Solutions:**

- Use more specific test run names
- Add description or link issues
- Add clarification with specific keywords
- Lower `MAGIC_SELECT_MIN_SEARCH_SCORE`

#### Too Many Suggestions

**Causes:**

- Test run name is too broad
- Clarification is too vague

**Solutions:**

- Use more specific test run names
- Add clarification to narrow focus
- Use batch processing with smaller batches

#### Magic Select Button Disabled

**Causes:**

- No active LLM integration for the project
- Test run name is empty

**Solutions:**

- Configure an LLM integration in project settings
- Enter a test run name before clicking Magic Select

#### Slow Performance

**Causes:**

- Large repository without Elasticsearch
- Too many cases sent to AI
- Network latency to AI provider

**Solutions:**

- Configure Elasticsearch for pre-filtering
- Use batch processing
- Increase `MAGIC_SELECT_MIN_SEARCH_SCORE` to reduce candidates
- Lower `MAGIC_SELECT_MAX_SEARCH_RESULTS`

#### Missing Relevant Cases

**Causes:**

- Search pre-filter is too aggressive
- Test case names don't match test run context
- Truncation limits are too restrictive

**Solutions:**

- Lower `MAGIC_SELECT_MIN_SEARCH_SCORE`
- Increase `MAGIC_SELECT_MAX_SEARCH_RESULTS`
- Add clarification with specific test case keywords
- Increase truncation limits if custom fields contain important context

### API Reference

#### Endpoint

```http
POST /api/llm/magic-select-cases
```

#### Request Body

```json
{
  "projectId": 123,
  "testRunMetadata": {
    "name": "User Authentication Tests",
    "description": "Testing login and registration flows",
    "docs": null,
    "linkedIssueIds": [456, 789],
    "tags": ["authentication", "security"]
  },
  "clarification": "Focus on security test cases",
  "excludeCaseIds": [101, 102],
  "batchSize": 100,
  "batchIndex": 0,
  "countOnly": false
}
```

#### Response

```json
{
  "success": true,
  "suggestedCaseIds": [1, 2, 3, 4, 5],
  "reasoning": [
    "Selected login-related test cases based on authentication context",
    "Included security validation tests matching linked issue requirements"
  ],
  "metadata": {
    "totalCasesAnalyzed": 150,
    "suggestedCount": 5,
    "directlySelected": 3,
    "linkedCasesAdded": 2,
    "model": "gpt-4-turbo",
    "tokens": {
      "prompt": 2500,
      "completion": 150,
      "total": 2650
    }
  }
}
```

## Future Enhancements

Planned improvements include:

- **Custom Model Fine-Tuning**: Train models on your specific domain
- **Multi-Language Support**: Generate test cases in different languages
- **Visual Test Generation**: Generate test cases from UI mockups
- **Regression Analysis**: Automatically update test cases when requirements change
- **Test Execution Integration**: Connect generated cases to automation frameworks
- **Magic Select Improvements**: Historical analysis of test run patterns for better suggestions
