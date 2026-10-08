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

TestPlanIt supports three types of test case links:

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

### Duplicated From

**Purpose**: Records that a test case was created as a copy of another. TestPlanIt adds this link automatically when you copy a case within a project, and you can also add it by hand. It carries no execution meaning.

### Depends On

**Purpose**: Indicates that one test case depends on another. The link has a direction: the case that **depends on** the other is the dependant, and the other case is its **prerequisite**.

**Common Use Cases**:
- Test execution order requirements
- Setup/precondition dependencies
- Integration test dependencies
- Data dependency relationships
- Cross-team end-to-end scenarios, where each team's part is its own test case and must run after the previous one has passed

**Example**:
```
Test Case C: "Update User Profile"
    depends on ↓
Test Case B: "User Login"
    depends on ↓
Test Case A: "Create User Account"
```

On each case the panel shows the relationship from that case's side:

- **Depends on** — the linked case is a prerequisite of this one (shown on C for B, and on B for A).
- **Blocks** — the linked case depends on this one (shown on A for B, and on B for C).

When you add the link you can choose either direction, so you can record "C depends on B" from either C's page (*Depends on*) or B's page (*Blocks*). Both create the same link.

**Benefits**:
- Document test execution prerequisites
- Plan test run sequencing
- Identify blockers when tests fail
- Understand test case relationships
- With [dependency enforcement](#enforcing-dependencies-in-test-runs) enabled, sequence execution inside a test run and hand off to the next tester automatically

### Enforcing dependencies in test runs

By default a *Depends on* link is documentation only. A project can turn it into an execution gate with the **Enforce test case dependencies in test runs** toggle under **Settings → Advanced** (see [Advanced settings](settings/advanced.md#enforce-test-case-dependencies-in-test-runs)).

When enforcement is on, inside every test run of the project:

- A test case is **blocked** while any case it depends on, *in that same run*, has not **passed** (a status flagged as a success). Untested, failed, retest and blocked prerequisites all keep the gate shut.
- A blocked case is marked **Blocked** in the run's case table and in the execution panel, with the prerequisites it is waiting on. Its result controls are disabled, and the server refuses a result for it from every path — the web app, the API and the MCP server — so the sequence can't be bypassed.
- When the last prerequisite passes, the case's gate opens and its **assignee is notified** (in-app and by email, following their notification preferences) that the case is ready to execute. This is the handoff between testers: assign each case in the chain to the person responsible for it, and each one is told when it is their turn. Resubmitting an already-passed result does not notify again.
- If a prerequisite is later changed to a non-passing result, its dependants are blocked again.
- A prerequisite that is **not in the run** never blocks: a run's behaviour depends only on what is in it. The execution panel lists such missing prerequisites as a warning so the omission is visible. A prerequisite removed from the run counts as not in it. In a [multi-configuration run](run-details.md#multi-configuration-support) each configuration is its own run, so the prerequisite has to be in the same configuration's run.
- A run is naturally complete only once every case has a result, so the scenario is done when every part has passed.

A few details worth knowing:

- **The Blocked marker is not the Blocked status.** A gated case keeps whatever status it has (usually *Untested*); the badge and the disabled controls are the only change. The *Blocked* status remains something a tester records deliberately, for example for an environment problem.
- **Only new results are gated.** Turning the setting on never alters results already recorded, and a result that exists on a blocked case can still be edited in place. The gate refuses new attempts only.
- **Parameterized cases** are gated as a whole: every iteration result, including a bulk skip, is refused while the case is blocked. A parameterized prerequisite counts as passed only when its rolled-up case status is a pass, which means every iteration has passed.
- **Automated results are not gated.** Results that arrive through the automation import or the test reporters set a case's status directly rather than recording an attempt, so they are applied regardless of dependencies.
- **API and MCP clients** get the same refusal as the web app: a `409` response with the code `DEPENDENCIES_NOT_PASSED` and the list of prerequisites still blocking the case.

Links are checked for cycles when they are created, so a chain of dependencies always has a start.

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
   - **Select Link Type**: Choose one of:
     - **Depends on** — this case requires the selected case to pass first
     - **Blocks** — the selected case requires this case to pass first (the same dependency, recorded from the other side)
     - **Same Test (Different Source)**
     - **Duplicated From**
5. Click **Add Link** to save

### Link Validation

The system prevents invalid links:
- **Self-Links**: Cannot link a test case to itself
- **Duplicate Links**: Cannot create the same link twice
- **Circular Dependencies**: A *Depends on* link that would make a case depend on itself, directly or through other cases, is rejected. The check is made on the server, so it also covers links created through the API, restored from the trash, or carried over when cases are merged.

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

Every link is stored once, from Case A to Case B. For *Same Test, Different Source* links the direction carries no meaning. For *Depends on* links it does: **Case A depends on Case B**, so Case B is the prerequisite.

The Linked Cases panel shows both outgoing and incoming links together, and labels a dependency from the current case's point of view — **Depends on** when the current case is the dependant, **Blocks** when it is the prerequisite.

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
5. Turn on [dependency enforcement](#enforcing-dependencies-in-test-runs) so dependent cases are blocked until their prerequisites pass, and the next tester is notified when they do

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
- [Advanced Settings](./settings/advanced.md#enforce-test-case-dependencies-in-test-runs) - Enforcing dependencies in test runs
- [Forecasting](../forecasting.md) - Understanding time forecasts
- [JUnit Import](../../import-export.md) - Importing automated tests
