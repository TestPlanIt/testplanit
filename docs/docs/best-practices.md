---
title: Best Practices
sidebar_position: 5
slug: /best-practices
---

# Best Practices

This guide covers recommended practices for getting the most out of TestPlanIt. Whether you're just getting started or looking to improve your existing test management process, these tips will help you work more effectively.

## Organizing Your Test Repository

### Use a Logical Folder Structure

Organize test cases into folders that reflect your application's structure or testing domains:

```text
├── Authentication
│   ├── Login
│   ├── Registration
│   └── Password Reset
├── Core Features
│   ├── Dashboard
│   ├── User Management
│   └── Settings
├── Integrations
│   ├── API
│   └── Third-Party Services
└── Non-Functional
    ├── Performance
    ├── Security
    └── Accessibility
```

**Tips:**

- Keep folder depth manageable (3-4 levels maximum)
- Use consistent naming conventions
- Group related test cases together
- Consider both feature areas and test types

### Write Clear Test Case Titles

Good test case titles should:

- Describe what is being tested
- Be specific enough to understand without reading the full test
- Follow a consistent format

**Examples:**

- ✅ "Verify login fails with incorrect password"
- ✅ "User can update profile picture"
- ❌ "Test login"
- ❌ "Profile test 1"

### Use Tags Effectively

Tags help you filter and organize test cases across folder boundaries:

- **Priority tags:** `critical`, `high`, `medium`, `low`
- **Type tags:** `smoke`, `regression`, `integration`
- **Component tags:** `api`, `ui`, `database`
- **Status tags:** `automated`, `needs-review`, `deprecated`

**Tips:**

- Define a standard set of tags for your organization
- Don't over-tag; 3-5 tags per test case is usually sufficient
- Use tags for cross-cutting concerns that don't fit folder structure

## Writing Effective Test Cases

### Structure Test Steps Clearly

Each test step should:

- Contain a single action
- Be specific and unambiguous
- Include expected results

**Example of well-structured steps:**

| Step | Action | Expected Result |
| ------ | -------- | ----------------- |
| 1 | Navigate to the login page | Login form is displayed |
| 2 | Enter valid username `"testuser@example.com"` | Username field is populated |
| 3 | Enter valid password | Password field shows masked characters |
| 4 | Click the "Login" button | User is redirected to dashboard |

### Use Shared Steps for Common Actions

If you find yourself writing the same steps repeatedly, create shared steps:

- **Login as standard user** - Reusable login sequence
- **Navigate to settings** - Common navigation path
- **Clear test data** - Cleanup procedure

**Benefits:**

- Reduces duplication
- Ensures consistency
- Makes maintenance easier

### Include Preconditions

Document what must be true before the test can run:

- Required user accounts or roles
- Test data that must exist
- System configuration requirements
- Dependencies on other tests or features

### Keep Test Cases Independent

Each test case should:

- Not depend on other test cases running first
- Set up its own required state
- Clean up after itself when possible

This makes tests easier to run in any order and simplifies debugging.

## Managing Test Runs

### Plan Your Test Runs

Before creating a test run:

- Define the scope (what are you testing?)
- Set clear objectives (what questions are you answering?)
- Choose appropriate configurations
- Assign testers with relevant expertise

### Use Configurations Wisely

Configurations help you track results across different environments:

**Examples:**

- Browsers: Chrome, Firefox, Safari, Edge
- Environments: Development, Staging, Production
- Devices: Desktop, Tablet, Mobile
- Operating Systems: Windows, macOS, Linux

**Tips:**

- Only create configurations you actually need
- Consider which test cases need multi-configuration testing
- Use configuration results to identify environment-specific issues

### Document Failures Thoroughly

When a test fails:

- Describe the actual vs. expected behavior
- Include error messages and logs
- Add screenshots or screen recordings
- Note the exact steps that led to the failure
- Link to any related issues

### Track Blockers and Dependencies

Use comments and status updates to communicate:

- Tests blocked by bugs
- Dependencies on other teams
- Environment issues
- Data problems

## Exploratory Testing Sessions

### Define Clear Charters

A good session charter includes:

- **Goal:** What are you trying to discover?
- **Scope:** What areas will you explore?
- **Time:** How long will the session last?
- **Resources:** What tools or data do you need?

**Example charter:**
> "Explore the new file upload feature focusing on edge cases with various file types and sizes. Look for usability issues, error handling problems, and performance concerns."

### Take Notes During Sessions

Capture your observations as you go:

- Interesting behaviors
- Potential issues
- Questions for developers
- Ideas for new test cases
- Areas that need more testing

### Debrief After Sessions

After each session:

- Review and organize your notes
- Create issues for bugs found
- Add new test cases to cover important scenarios
- Share findings with your team

## Integrating with Issue Trackers

### Link Tests to Requirements

Connect test cases to:

- User stories or requirements
- Feature specifications
- Bug reports being verified

This creates traceability and helps measure coverage.

### Create Issues from Failed Tests

When creating issues from test failures:

- Include a link to the test case and run
- Copy relevant failure details
- Add reproduction steps
- Attach screenshots or logs

### Keep Links Updated

Regularly review and update links:

- Add links to new related items
- Verify that linked items are still relevant

## Working with Automation

### Sync Manual and Automated Tests

- Use the CLI or SDK to report automation results to TestPlanIt
- Link automated tests to their manual counterparts
- Track automation coverage over time

### Handle Automation Failures

When automated tests fail:

- Review the results in TestPlanIt
- Determine if it's a product bug or test issue
- Create issues for product bugs
- Fix or update flaky tests

### Balance Manual and Automated Testing

Consider automation for:

- Stable, repetitive tests
- Data-driven tests with many inputs
- Tests requiring precise timing or calculations

Keep manual testing for:

- Exploratory testing
- Usability evaluation
- New or frequently changing features
- Complex scenarios requiring judgment

## Reporting and Metrics

### Track Meaningful Metrics

Focus on metrics that drive improvement:

- **Pass/fail rates:** Overall quality indicator
- **Defects found:** Testing effectiveness
- **Test coverage:** What's been tested
- **Blocked tests:** Process issues

Avoid vanity metrics that don't lead to action.

### Review Results Regularly

- Daily: Check active test run progress
- Weekly: Review overall testing status
- Per milestone: Analyze trends and patterns
- Retrospectively: Identify process improvements

### Share Reports with Stakeholders

Customize reports for your audience:

- **Developers:** Technical details, specific failures
- **Managers:** Summary metrics, trends
- **Stakeholders:** High-level status, risk areas

## Team Collaboration

### Establish Clear Ownership

- Assign test case owners for maintenance
- Define who reviews and approves changes
- Clarify responsibilities for different test areas

### Use Comments Effectively

- Ask questions about test cases
- Document decisions and rationale
- Share knowledge with team members
- Provide context for future reference

### Review and Improve Continuously

- Regularly audit test cases for relevance
- Remove or update obsolete tests
- Incorporate lessons learned
- Share best practices across teams
