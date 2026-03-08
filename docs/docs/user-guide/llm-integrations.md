---
sidebar_label: 'AI Models'
title: 'AI Models'
---

# AI Models

TestPlanIt integrates with leading AI providers to power features across the platform, including test case generation, intelligent test case selection, in-editor writing assistance, and AI-assisted imports.

## Overview

AI-powered features in TestPlanIt:

- **[Test Case Generation](../llm-test-generation)** — Generate test cases from requirements, issues, and documents
- **[Magic Select](../llm-magic-select)** — AI-assisted test case selection when building test runs
- **[Writing Assistant](../llm-writing-assistant)** — Improve, translate, and enhance content in any rich text field
- **[Markdown Import](../llm-markdown-import)** — AI-assisted field mapping when importing markdown test cases
- **[QuickScript](../projects/quickscript)** — AI-assisted automation script generation from manual test cases

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

1. Go to **Project Settings** → **AI Models**
2. Select the integration from available options
3. Optionally assign a **[Prompt Configuration](../prompt-configurations)** to customize how AI prompts behave for this project
4. Save settings

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
- **Magic Select Improvements**: Historical analysis of test run patterns for better suggestions
