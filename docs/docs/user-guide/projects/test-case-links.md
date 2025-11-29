---
title: Test Case Links
sidebar_position: 11
---

# Test Case Links

Test Case Links allow you to create relationships between test cases in your repository. This feature helps you track dependencies, connect related tests, and link manual and automated versions of the same test.

## Overview

Test case linking provides:

- **Dependency Tracking** - Document which tests depend on others
- **Test Variations** - Link manual and automated versions of the same test
- **Traceability** - Maintain relationships between related test scenarios
- **Impact Analysis** - Understand which tests are affected by changes
- **Forecast Accuracy** - Linking affects test execution time forecasts

## Link Types

TestPlanIt supports two types of test case links:

### Same Test, Different Source

**Purpose**: Links test cases that represent the same test but come from different sources.

**Common Use Cases**:
- Linking a manually created test case to its automated JUnit equivalent
- Connecting API tests to their UI counterparts
- Linking test cases imported from different systems

**Example**:
```
Manual Test: "User Login - Happy Path"
    ↕ SAME_TEST_DIFFERENT_SOURCE
JUnit Test: "com.example.auth.LoginTest.testSuccessfulLogin"
```

**Benefits**:
- Track both manual and automated coverage for the same scenario
- Compare execution results between manual and automated runs
- Ensure test case parity across different test types
- Identify gaps in automation coverage

### Depends On

**Purpose**: Indicates that one test case depends on another.

**Common Use Cases**:
- Test execution order requirements
- Setup/precondition dependencies
- Integration test dependencies
- Data dependency relationships

**Example**:
```
Test Case A: "Create User Account"
    ↓ DEPENDS_ON
Test Case B: "User Login"
    ↓ DEPENDS_ON
Test Case C: "Update User Profile"
```

**Benefits**:
- Document test execution prerequisites
- Plan test run sequencing
- Identify blockers when tests fail
- Understand test case relationships

## Accessing Linked Cases

### Viewing Links

1. Navigate to a test case in the repository
2. Scroll to the **Linked Cases** section (usually below test steps)
3. View all test cases linked to the current case

The Linked Cases panel displays:
- **Test Case Name** - Clickable link to the linked case
- **Source Icon** - Visual indicator (manual vs. JUnit)
- **Link Type** - Badge showing the relationship type
- **Latest Status** - Most recent test execution result
- **Execution Date** - When the linked case was last tested
- **Linked By** - User who created the link
- **Created Date** - When the link was established
- **Remove Action** - Button to unlink (if you have permission)

### Empty State

If no links exist, the panel shows: "No linked cases"

## Creating Links

### Prerequisites

To create links, you need:
- Write permissions on the project
- Access to both test cases
- Test cases must be in the same project

### Adding a Link

1. Open a test case in the repository
2. Locate the **Linked Cases** section
3. Click the **Add Link** button (+ icon)
4. In the "Add Linked Test Case" dialog:
   - **Select Test Case**: Use the searchable dropdown to find the case
     - Type to search by test case name
     - Paginated results for large repositories
     - Shows test case source icons
     - Excludes already-linked cases
   - **Select Link Type**: Choose either:
     - "Same Test, Different Source"
     - "Depends On"
5. Click **Add Link** to save

### Link Validation

The system prevents invalid links:
- **Self-Links**: Cannot link a test case to itself
- **Duplicate Links**: Cannot create the same link twice
- **Circular Links**: Prevents circular dependency chains

If validation fails, an error message explains the issue.

## Managing Links

### Viewing Link Details

For each linked case, you can see:

**Test Case Information**:
- Name with clickable link to view the case
- Source indicator (manual or automated)

**Link Metadata**:
- Link type badge
- When the link was created
- Who created the link

**Execution Status**:
- Latest test result status (Passed, Failed, etc.)
- Status badge with color coding
- Execution timestamp
- Combines manual and JUnit results (shows most recent)

### Removing Links

To unlink test cases:

1. Locate the link in the Linked Cases table
2. Click the **X** (remove) button in the rightmost column
3. In the confirmation popover:
   - Review the unlink action
   - Click **Cancel** to keep the link
   - Click **Remove Link** to confirm

:::warning Unlink Action
Removing a link is permanent and cannot be undone. The link relationship is deleted from both test cases.
:::

**Permissions**: You can only remove links if you have write permissions on the project.

## Link Directionality

Links have a direction based on the order they were created:

### Outgoing Links
- Created from the current test case (Case A) to another case (Case B)
- Current case is the "source" of the link

### Incoming Links
- Created from another test case to the current case
- Current case is the "target" of the link

**Display**: The Linked Cases panel shows both outgoing and incoming links together, making it easy to see all relationships.

## Impact on Forecasting

Creating or removing links affects test execution forecasts:

**Automatic Forecast Updates**:
- When you add a link, forecasts update for both test cases
- When you remove a link, forecasts recalculate for both cases
- Helps maintain accurate time estimates
- Considers relationship types in calculations

**Forecast Behavior**:
- Links may adjust estimated execution time
- "Depends On" relationships can affect test run planning
- "Same Test" links help identify redundant execution
- Automatic recalculation happens in the background

## Best Practices

### Linking Strategy

**1. Link Related Tests Consistently**
- Establish team conventions for when to create links
- Document your linking strategy in project documentation
- Review links during test case reviews

**2. Use Appropriate Link Types**
- Use "Same Test, Different Source" for test variations
- Use "Depends On" for actual dependencies
- Don't overuse links - only link when meaningful

**3. Maintain Links**
- Remove obsolete links when test cases are updated
- Verify links after major test case changes
- Update links when test dependencies change

### Organization Tips

**1. Link During Test Creation**
- Create links as you write new test cases
- Link automated tests when importing JUnit results
- Add dependency links during test planning

**2. Review Links Periodically**
- Audit links during sprint retrospectives
- Check for broken relationships
- Remove unnecessary links

**3. Use Links for Planning**
- Review dependency links when planning test runs
- Check "Same Test" links for automation coverage gaps
- Use links to optimize test execution order

### Common Patterns

**Pattern 1: Manual to Automated Transition**
```
1. Create manual test case
2. Implement automated version
3. Link with "Same Test, Different Source"
4. Compare execution results
5. Gradually phase out manual execution
```

**Pattern 2: Test Suite Dependencies**
```
Setup Tests (no dependencies)
    ↓ DEPENDS_ON
Core Feature Tests (depend on setup)
    ↓ DEPENDS_ON
Integration Tests (depend on core)
    ↓ DEPENDS_ON
Teardown Tests (depend on all)
```

**Pattern 3: Cross-Platform Testing**
```
Web Test: "Search Functionality"
    ↕ SAME_TEST_DIFFERENT_SOURCE
Mobile Test: "Search Functionality"
    ↕ SAME_TEST_DIFFERENT_SOURCE
API Test: "Search Endpoint"
```

## Use Cases

### 1. Automation Coverage Tracking

**Scenario**: You're automating manual test cases

**Process**:
1. Identify manual test case for automation
2. Create JUnit automated test
3. Import JUnit results into TestPlanIt
4. Link manual and automated versions with "Same Test, Different Source"
5. Compare results to verify automation accuracy
6. Track automation coverage percentage

**Benefits**:
- Easily see which tests are automated
- Verify automation matches manual tests
- Track automation progress
- Identify gaps in automation

### 2. Test Execution Dependencies

**Scenario**: Tests must run in a specific order

**Process**:
1. Identify test execution dependencies
2. Create "Depends On" links from dependent tests to prerequisites
3. Use links to plan test run order
4. Review dependency chain before execution
5. Block dependent tests when prerequisites fail

**Benefits**:
- Document execution order requirements
- Prevent wasted test effort
- Clear communication of dependencies
- Faster failure identification

### 3. Impact Analysis

**Scenario**: A feature changes and you need to know affected tests

**Process**:
1. Find test case for the changed feature
2. Review all linked test cases
3. Check both incoming and outgoing links
4. Identify all dependent tests
5. Plan retesting strategy

**Benefits**:
- Quickly identify affected tests
- Reduce risk of missing related tests
- Better change impact assessment
- More efficient regression testing

### 4. Test Case Consolidation

**Scenario**: Multiple test cases cover the same functionality

**Process**:
1. Identify duplicate or overlapping test cases
2. Link them with "Same Test, Different Source"
3. Compare execution history
4. Consolidate or retire redundant cases
5. Maintain best version

**Benefits**:
- Reduce test maintenance burden
- Eliminate redundant test execution
- Improve test suite efficiency
- Better test case organization

## Troubleshooting

### Cannot Create Link

**Issue**: "Add Link" button is disabled or not visible

**Solutions**:
- Verify you have write permissions on the project
- Ensure you're viewing a test case (not a folder)
- Check that you're logged in
- Contact project admin for permission changes

### Link Creation Fails

**Issue**: Error message when trying to add a link

**Common Causes**:
- **"Cannot link to self"**: You selected the current test case
  - Solution: Select a different test case
- **"Circular link detected"**: The link would create a cycle
  - Solution: Choose a different test case or link type
- **Case already linked**: A link already exists between these cases
  - Solution: Check existing links, or remove and recreate

### Missing Linked Cases

**Issue**: Expected links don't appear in the panel

**Solutions**:
- Refresh the page to reload links
- Verify the linked case wasn't deleted
- Check if links were removed
- Ensure you have read access to linked cases
- Review project permissions

### Link Doesn't Update

**Issue**: Changes to linked cases don't reflect immediately

**Solutions**:
- Wait a moment for data to sync
- Refresh the browser page
- Check network connectivity
- Clear browser cache if issues persist

## Permissions

### Required Permissions

**View Links**:
- Read access to the test case
- Read access to the project
- Links to cases you can't access won't appear

**Create Links**:
- Write access to the project
- Read access to both test cases
- Cannot link cases across different projects

**Remove Links**:
- Write access to the project
- Permission to modify test cases
- Same permissions as creating links

### Permission Inheritance

- Links inherit permissions from the source test case (Case A)
- Both users must have access to see the link
- Project-level permissions apply
- Role-based restrictions apply

## Technical Details

### Link Storage

- Links are bidirectional relationships
- Stored with direction (Case A → Case B)
- Soft-delete mechanism (links can be restored)
- Unique constraint prevents duplicate links

### Performance

- Links load asynchronously with test case
- Pagination for large link lists
- Efficient database queries
- Cached for performance

### API Integration

Links are accessible via API:

**Get Links for Test Case**:
```http
GET /api/model/RepositoryCaseLink/findMany?q={
  "where": {
    "OR": [
      {"caseAId": 123, "isDeleted": false},
      {"caseBId": 123, "isDeleted": false}
    ]
  },
  "include": {
    "caseA": true,
    "caseB": true
  }
}
```

**Create Link**:
```http
POST /api/model/RepositoryCaseLink/create
Content-Type: application/json

{
  "data": {
    "caseA": {"connect": {"id": 123}},
    "caseB": {"connect": {"id": 456}},
    "type": "SAME_TEST_DIFFERENT_SOURCE"
  }
}
```

**Remove Link (Soft Delete)**:
```http
PUT /api/model/RepositoryCaseLink/update
Content-Type: application/json

{
  "where": {"id": 789},
  "data": {"isDeleted": true}
}
```

---

**Related Documentation**:
- [Test Case Repository](./repository.md) - Managing test cases
- [Test Execution](./test-case-execution.md) - Running tests
- [Forecasting](../forecasting.md) - Understanding time forecasts
- [JUnit Import](../../import-export.md) - Importing automated tests
