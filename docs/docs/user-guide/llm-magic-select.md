---
title: Magic Select
---

# AI-Powered Test Case Selection (Magic Select)

The Magic Select feature uses AI to intelligently suggest relevant test cases when creating a test run. Based on the test run's name, description, documentation, and linked issues, the AI analyzes your test case repository and recommends the most appropriate cases to include.

## Overview

Magic Select helps you:

- **Save Time**: Quickly identify relevant test cases from large repositories
- **Improve Coverage**: Ensure you don't miss related test cases
- **Leverage Context**: Use test run metadata to find matching cases
- **Include Linked Cases**: Automatically add test cases that are linked to suggested cases

## Using Magic Select

### Prerequisites

- At least one active LLM integration configured for your project
- Test cases in your repository
- Elasticsearch configured (optional, but improves performance for large repositories)

### Step-by-Step Usage

1. **Create a Test Run**: Click "Add Test Run" and fill in the first step with:
   - Test run name (required)
   - Description (optional but improves suggestions)
   - Documentation (optional but improves suggestions)
   - Linked issues (optional but improves suggestions)

2. **Click Next**: Navigate to the test case selection step

3. **Click Magic Select**: The button appears alongside the "Selected Test Cases" button

4. **Configure Analysis** (for large repositories):
   - **Clarification**: Add additional context to help the AI understand what you need

5. **Wait for Analysis**: Magic Select runs in the background, showing real-time progress:
   - **Batch progress**: "Analyzing batch X of Y" as the AI processes test cases
   - **Partial results warning**: If any batch was truncated by the AI provider, a warning is shown so you know some analysis may be incomplete

6. **Review Suggestions**: The AI presents:
   - Number of suggested test cases
   - Reasoning for the selection
   - Option to view and modify the suggestions

7. **Accept or Refine**:
   - **Accept**: Merge suggestions with any existing selection
   - **Refine**: Add clarification and re-run the analysis
   - **Cancel**: Keep your existing selection unchanged

## How It Works

### Context Analysis

The AI analyzes several sources to understand your test run:

1. **Test Run Name**: Primary signal for matching relevant test cases
2. **Description**: Additional context about what's being tested
3. **Documentation**: Detailed requirements or specifications
4. **Linked Issues**: Issue titles and descriptions from Jira, GitHub, etc.

### Test Case Matching

For each test case in your repository, the AI considers:

- **Name**: Primary matching criterion
- **Folder Path**: Organizational context
- **Tags**: Category and classification information
- **Custom Fields**: Additional metadata from your templates
- **Linked Cases**: Relationships between test cases

### Search Pre-Filtering

For repositories with many test cases (default: 250+), Magic Select uses Elasticsearch to pre-filter before sending to the AI:

1. Keywords are extracted from your test run metadata
2. Elasticsearch finds potentially relevant test cases
3. Only matching cases are sent to the AI for detailed analysis

This significantly reduces AI processing time and cost for large repositories.

### Progressive Score Reduction

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

### Linked Case Expansion

After the AI suggests test cases, Magic Select automatically includes any test cases that are linked to the suggestions:

- **Links To**: Cases that the suggested case links to
- **Links From**: Cases that link to the suggested case

This ensures you don't miss dependent or related test cases.

## Configuration

### Environment Variables

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

### Adjusting for Your Repository

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

## Best Practices

### Writing Effective Test Run Names

Good names help the AI find relevant test cases:

```text
Good: "User Authentication - Login Flow Regression"
Good: "Payment Processing - Credit Card Validation"
Good: "Mobile App - iOS Push Notifications"

Poor: "Sprint 23 Testing"
Poor: "Bug Fixes"
Poor: "QA Testing"
```

### Using Descriptions and Documentation

Add context that matches your test case content:

```text
Test run for verifying the new user registration flow including:
- Email validation
- Password strength requirements
- CAPTCHA verification
- Welcome email delivery
```

### Linking Issues

Link relevant issues to improve suggestions:

- The AI reads issue titles and descriptions
- Multiple linked issues provide more context
- Issue priority helps identify critical test areas

### Using Clarification

Add specific guidance when needed:

```text
"Focus on edge cases and error handling"
"Include all API endpoint tests"
"Prioritize security-related test cases"
"Only include automated test cases"
```

## Troubleshooting

### No Suggestions Returned

**Causes:**

- Test run name is too generic
- No test cases match the context
- Search pre-filter is too restrictive

**Solutions:**

- Use more specific test run names
- Add description or link issues
- Add clarification with specific keywords
- Lower `MAGIC_SELECT_MIN_SEARCH_SCORE`

### Too Many Suggestions

**Causes:**

- Test run name is too broad
- Clarification is too vague

**Solutions:**

- Use more specific test run names
- Add clarification to narrow focus
- Use batch processing with smaller batches

### Magic Select Button Disabled

**Causes:**

- No active LLM integration for the project
- Test run name is empty

**Solutions:**

- Configure an LLM integration in project settings
- Enter a test run name before clicking Magic Select

### Slow Performance

**Causes:**

- Large repository without Elasticsearch
- Too many cases sent to AI
- Network latency to AI provider

**Solutions:**

- Configure Elasticsearch for pre-filtering
- Use batch processing
- Increase `MAGIC_SELECT_MIN_SEARCH_SCORE` to reduce candidates
- Lower `MAGIC_SELECT_MAX_SEARCH_RESULTS`

### Missing Relevant Cases

**Causes:**

- Search pre-filter is too aggressive
- Test case names don't match test run context
- Truncation limits are too restrictive

**Solutions:**

- Lower `MAGIC_SELECT_MIN_SEARCH_SCORE`
- Increase `MAGIC_SELECT_MAX_SEARCH_RESULTS`
- Add clarification with specific test case keywords
- Increase truncation limits if custom fields contain important context

## API Reference

Magic Select uses a submit/poll pattern backed by a background worker. See [Background Processes](../background-processes) for worker setup.

### Count Only (synchronous)

Returns the number of test cases that would be analyzed, without making any LLM calls.

```http
POST /api/llm/magic-select-cases
```

```json
{
  "projectId": 123,
  "testRunMetadata": {
    "name": "User Authentication Tests",
    "description": "Testing login and registration flows",
    "docs": null,
    "linkedIssueIds": [456, 789]
  },
  "countOnly": true
}
```

**Note:** Non-`countOnly` requests to this endpoint return **410 Gone** and should use the submit endpoint below instead.

### Submit Job

Enqueues a Magic Select background job and returns a job ID for polling.

```http
POST /api/llm/magic-select-cases/submit
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
  "excludeCaseIds": [101, 102]
}
```

#### Response

```json
{
  "jobId": "abc-123"
}
```

### Poll Job Status

Returns the current state, progress, and (when complete) results of a Magic Select job.

```http
GET /api/llm/magic-select-cases/status/{jobId}
```

#### Response (completed)

```json
{
  "jobId": "abc-123",
  "state": "completed",
  "progress": { "phase": "ai", "current": 3, "total": 3 },
  "result": {
    "suggestedCaseIds": [1, 2, 3, 4, 5],
    "truncatedBatches": [],
    "reasoning": "Selected login-related test cases based on authentication context",
    "metadata": {
      "totalCasesAnalyzed": 150,
      "suggestedCount": 5,
      "directlySelected": 3,
      "linkedCasesAdded": 2,
      "model": "gpt-4-turbo",
      "tokens": { "prompt": 2500, "completion": 150, "total": 2650 },
      "batchCount": 3,
      "failedBatchCount": 0
    }
  },
  "failedReason": null
}
```
