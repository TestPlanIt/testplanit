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
Base URL: http://localhost:11434
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

## Future Enhancements

Planned improvements include:

- **Custom Model Fine-Tuning**: Train models on your specific domain
- **Multi-Language Support**: Generate test cases in different languages
- **Visual Test Generation**: Generate test cases from UI mockups
- **Regression Analysis**: Automatically update test cases when requirements change
- **Test Execution Integration**: Connect generated cases to automation frameworks
