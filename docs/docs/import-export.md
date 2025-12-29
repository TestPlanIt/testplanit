---
sidebar_position: 10
title: Import & Export
---

# Import & Export

TestPlanIt provides comprehensive import and export capabilities to help you migrate data, integrate with other tools, and backup your test management data.

## Overview

The import/export system supports:

- **CSV Import/Export** for test cases and bulk data operations
- **Automated Test Results Import** for multiple formats (JUnit, TestNG, NUnit, xUnit, MSTest, Mocha, Cucumber)
- **Field Mapping** for flexible data transformation
- **Bulk Operations** for efficient data management
- **Attachment Support** during import/export processes

## CSV Import/Export

### Test Case CSV Import

Import test cases from CSV files with flexible field mapping.

#### Accessing CSV Import

1. Navigate to **Repository** in your project
2. Click the **Import** button in the toolbar
3. Select **CSV Import** from the dropdown

#### CSV Format Requirements

Your CSV file can use any column names - you'll map them to TestPlanIt fields during import. The only requirement is that your CSV has a header row.

**Available Fields for Mapping:**

The fields available for mapping depend on the template you select. You'll always have access to system fields, plus any custom fields defined in the template.

**System Fields (always available):**

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Test case name/title |
| Steps | No | Test steps (formatted) |
| Tags | No | Comma-separated tags |
| Automated | No | Whether the test is automated (checkbox) |
| Estimate | No | Time estimate in minutes |
| Forecast | No | Forecasted time in minutes |
| Attachments | No | File attachments |
| Issues | No | Linked issues |
| Linked Cases | No | Related test cases |
| Workflow State | No | Current workflow state |
| Created At | No | Creation date/time |
| Created By | No | User who created the case |
| Version | No | Version number |
| Test Runs | No | Associated test runs |
| ID | No | Test case ID |
| Folder | Conditional | Required when importing to multiple folders |

**Template Custom Fields:**

Any custom fields defined in the selected template will also be available for mapping. For example, if your template includes fields like "Priority", "Severity", "Preconditions", or "Expected Result", these will appear in the mapping options.

#### Example CSV Format

Your CSV might look like this (column names are flexible):

```csv
Test Name,Details,Procedure,Labels,Priority,Automated
"Login Test","Test user login functionality","1. Navigate to login page\n2. Enter credentials\n3. Click login","smoke,login",High,false
"Password Reset","Test password reset flow","1. Click forgot password\n2. Enter email\n3. Check email","email,security",Medium,false
```

During import, you'll map these columns to the available fields. The wizard auto-matches columns when names are similar.

#### Step Format in CSV

Test steps can be formatted in several ways:

**Simple Format:**

```
1. Step one
2. Step two
3. Step three
```

**Detailed Format with Expected Results:**

```
1. Navigate to login page | Login page displays
2. Enter username and password | Fields accept input
3. Click login button | User is redirected to dashboard
```

#### Import Process

1. **Upload CSV File**
   - Click "Choose File" or drag CSV file
   - File is validated for format and size

2. **Field Mapping**
   - Map CSV columns to TestPlanIt fields
   - Preview shows sample data mapping
   - Set default values for unmapped fields

3. **Options Configuration**
   - Choose folder for imported cases
   - Select template to apply
   - Configure tag handling (merge/replace)
   - Set attachment handling options

4. **Import Execution**
   - Review import summary
   - Start import process
   - Monitor progress with real-time updates

5. **Results Review**
   - View import statistics
   - Review any errors or warnings
   - Access imported test cases

#### Field Mapping Options

**System Fields:**

- Name (required), Steps, Tags, Automated
- Estimate, Forecast, Attachments, Issues
- Linked Cases, Workflow State, ID
- Folder (when using multi-folder import)

**Template Custom Fields:**

- All custom fields from the selected template are available
- Automatic type conversion based on field type (text, number, date, checkbox, etc.)

**Special Handling:**

- **Folders**: Auto-create folder hierarchy based on folder split mode
- **Tags**: Comma-separated values are split into individual tags
- **Auto-matching**: Column names are automatically matched to similar field names

### CSV Export

Export test cases and related data to CSV format.

#### Export Options

1. **Scope Selection**
   - Current folder only
   - Current folder and subfolders
   - Selected test cases
   - Entire repository

2. **Field Selection**
   - Choose which fields to include
   - Custom field inclusion
   - Relationship data (tags, attachments)

3. **Format Options**
   - Step formatting (simple/detailed)
   - Date format preferences
   - Custom field formatting

#### Export Process

1. Navigate to Repository
2. Click **Export** button
3. Configure export options
4. Click **Generate Export**
5. Download generated CSV file

## Automated Test Results Import

Import automated test results from multiple testing frameworks and formats.

### Supported Formats

TestPlanIt supports importing test results from the following formats:

| Format | File Types | Description |
|--------|-----------|-------------|
| **JUnit XML** | `.xml` | Standard JUnit XML format (Java, Python pytest, etc.) |
| **TestNG XML** | `.xml` | TestNG XML reports from Java projects |
| **NUnit XML** | `.xml` | NUnit v2/v3 XML reports from .NET projects |
| **xUnit XML** | `.xml` | xUnit.net XML reports from .NET projects |
| **MSTest TRX** | `.trx`, `.xml` | Visual Studio Test Results (TRX) files |
| **Mocha JSON** | `.json` | Mocha JSON reporter output (JavaScript/Node.js) |
| **Cucumber JSON** | `.json` | Cucumber JSON reporter output (BDD frameworks) |

### Accessing Test Results Import

1. Navigate to **Test Runs** in your project
2. Click **Import Results** button
3. The import dialog opens with format options

### Import Process

1. **Select Format**
   - Choose **Auto-detect** (recommended) to automatically identify the file format
   - Or manually select a specific format from the dropdown

2. **Configure Test Run**
   - Enter a **Test Run Name** (required)
   - Select a **Parent Folder** for organizing imported test cases
   - Choose a **Template** to apply to imported test cases
   - Select **State** for the test run
   - Optionally set **Configuration**, **Milestone** (only active milestones are shown), and **Tags**

3. **Upload Files**
   - Select one or more test result files
   - Multiple files of the same format can be imported together

4. **Import Execution**
   - Progress is displayed in real-time
   - Test cases are automatically created or updated
   - Results are mapped to appropriate statuses

### Format-Specific Examples

#### JUnit XML Format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="LoginTests" tests="3" failures="1" errors="0" time="45.2">
    <testcase name="testValidLogin" classname="auth.LoginTest" time="12.5">
      <!-- Passing test -->
    </testcase>
    <testcase name="testInvalidLogin" classname="auth.LoginTest" time="8.3">
      <failure message="Login should fail">
        Expected login to fail but user was logged in
      </failure>
    </testcase>
    <testcase name="testPasswordReset" classname="auth.LoginTest" time="24.4">
      <error message="Database connection failed">
        Could not connect to test database
      </error>
    </testcase>
  </testsuite>
</testsuites>
```

#### NUnit XML Format

```xml
<?xml version="1.0" encoding="utf-8"?>
<test-run id="0" name="MyApp.Tests" testcasecount="2" result="Passed"
          engine-version="3.12.0" clr-version="4.0.30319.42000">
  <test-suite type="Assembly" name="MyApp.Tests.dll">
    <test-case id="1001" name="AdditionTest" fullname="MyApp.Tests.CalculatorTests.AdditionTest"
               result="Passed" duration="0.0234">
    </test-case>
    <test-case id="1002" name="DivisionTest" fullname="MyApp.Tests.CalculatorTests.DivisionTest"
               result="Failed" duration="0.0156">
      <failure>
        <message>Expected: 5, But was: 4</message>
        <stack-trace>at MyApp.Tests.CalculatorTests.DivisionTest()</stack-trace>
      </failure>
    </test-case>
  </test-suite>
</test-run>
```

#### MSTest TRX Format

```xml
<?xml version="1.0" encoding="UTF-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="abc-123" testName="TestMethod1" outcome="Passed"
                    duration="00:00:01.234" />
    <UnitTestResult testId="abc-124" testName="TestMethod2" outcome="Failed"
                    duration="00:00:00.567">
      <Output>
        <ErrorInfo>
          <Message>Assert.AreEqual failed</Message>
          <StackTrace>at TestClass.TestMethod2()</StackTrace>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
  </Results>
</TestRun>
```

#### Cucumber JSON Format

```json
[
  {
    "uri": "features/login.feature",
    "keyword": "Feature",
    "name": "User Login",
    "elements": [
      {
        "keyword": "Scenario",
        "name": "Valid login",
        "steps": [
          {
            "keyword": "Given",
            "name": "a registered user",
            "result": { "status": "passed", "duration": 1234567 }
          },
          {
            "keyword": "When",
            "name": "they enter valid credentials",
            "result": { "status": "passed", "duration": 2345678 }
          }
        ]
      }
    ]
  }
]
```

#### Mocha JSON Format

```json
{
  "stats": {
    "suites": 2,
    "tests": 5,
    "passes": 4,
    "failures": 1,
    "duration": 1234
  },
  "results": [
    {
      "title": "Authentication",
      "suites": [],
      "tests": [
        {
          "title": "should login successfully",
          "fullTitle": "Authentication should login successfully",
          "duration": 45,
          "state": "passed"
        }
      ]
    }
  ]
}
```

### Status Mapping

Test result statuses are automatically mapped to TestPlanIt statuses:

| Source Status | TestPlanIt Status | Description |
|--------------|-------------------|-------------|
| pass, passed, success, ok | Passed | Test executed successfully |
| fail, failed, failure | Failed | Test assertion failed |
| error, errored, broken | Error | Test execution error |
| skip, skipped, pending, ignored, disabled | Skipped | Test was not executed |

### Folder Structure

When importing test results, TestPlanIt automatically creates a folder hierarchy based on the test suite structure:

- **For .NET formats** (NUnit, xUnit, MSTest): Namespace-based folders are created
  - `MyApp.Tests.CalculatorTests` → `MyApp` > `Tests` > `CalculatorTests`
- **For Cucumber**: Feature file paths are used
  - `features/login/authentication.feature` → `features` > `login` > `authentication`
- **For Java formats** (JUnit, TestNG): Class name hierarchy is used
  - `com.example.auth.LoginTest` → `com` > `example` > `auth` > `LoginTest`

### Test Case Auto-Creation

When importing test results, TestPlanIt automatically creates or updates test cases:

- **Test Name**: Uses the test method/scenario name
- **Class Name**: Stores the fully qualified name for uniqueness
- **Source**: Records the format type (JUNIT, NUNIT, CUCUMBER, etc.)
- **Template**: Uses the selected template from the import dialog
- **Folder**: Organized based on suite/namespace structure

### Auto-Detection

The Auto-detect feature examines file content and extension to determine the format:

- **`.trx` files**: Always identified as MSTest
- **JSON files**: Analyzed for Cucumber or Mocha structure
- **XML files**: Parsed for format-specific root elements:
  - `<testsuites>` or `<testsuite>` → JUnit
  - `<testng-results>` → TestNG
  - `<test-run>` with NUnit attributes → NUnit
  - `<assemblies>` → xUnit
  - `<TestRun>` with Microsoft namespace → MSTest

## Advanced Import Features

### Attachment Handling

#### CSV Import with Attachments

Reference external files in CSV:

```csv
title,description,attachments
"Screenshot Test","Test with images","screenshot1.png;screenshot2.png"
```

Requirements:

- Files must be accessible via URL or local path
- Supported file types only
- File size within limits

#### JUnit Import with Attachments

Include test artifacts in JUnit XML:

```xml
<testcase name="testWithScreenshot">
  <system-out>
    [[ATTACHMENT|screenshot.png|http://example.com/screenshot.png]]
  </system-out>
</testcase>
```

### Bulk Operations

#### Bulk Test Case Updates

Update multiple test cases via CSV:

1. Export existing test cases
2. Modify CSV data
3. Import with "Update existing" option
4. Changes applied to matching cases

#### Bulk Tag Management

Import/export operations support bulk tag operations:

- Add tags to multiple test cases
- Remove tags from filtered cases
- Replace tag sets entirely

### Error Handling

#### Import Validation

Common validation errors:

- **Missing required fields**
- **Invalid data types**
- **Duplicate test cases**
- **Missing folders/templates**
- **Attachment access issues**

#### Error Resolution

1. **Preview Mode**: Validate before importing
2. **Skip Invalid Rows**: Continue with valid data
3. **Fix and Retry**: Correct CSV and re-import
4. **Partial Import**: Import successful rows only

## Export Features

### Comprehensive Data Export

Export complete project data including:

- Test cases with all fields and attachments
- Test runs and results
- Sessions and outcomes
- Issues and milestones
- User assignments and history

### Export Formats

#### CSV Export

- Standard comma-separated values
- Configurable field selection
- Custom formatting options
- Configurable delimiter (comma, semicolon, colon, pipe)

#### PDF Export

- Professional document format for sharing and printing
- Formatted test case details with sections
- Page numbers and export metadata

**PDF Export Options:**

| Option | Values | Description |
|--------|--------|-------------|
| **Scope** | Selected / All Filtered / All Project | Which test cases to include |
| **Columns** | Visible / All | Which fields to export |
| **Text Fields** | JSON / Plain Text | How to format rich text content |
| **Attachment Format** | Names / Embed Images | How to display attachments |
| **Steps Format** | JSON / Plain Text | How to format test steps |

**Attachment Format Options:**

- **Names**: Display attachment file names as text (default for PDF)
- **Embed Images**: Embed image attachments directly in the PDF document. Non-image files are listed by name. Supported image formats: JPEG, PNG, GIF, WebP, BMP.

#### Excel Export (Future)

- Multi-sheet workbooks
- Formatted data with styles
- Charts and pivot tables

#### JSON Export (API)

- Complete data structure
- Relationship preservation
- API-compatible format

## Integration Examples

### CI/CD Pipeline Integration

#### Java/Maven with JUnit

```bash
# Example Jenkins pipeline step
pipeline {
    stages {
        stage('Test') {
            steps {
                sh 'mvn test'
                archiveArtifacts 'target/surefire-reports/*.xml'
            }
        }
        stage('Upload Results') {
            steps {
                script {
                    // Upload JUnit results to TestPlanIt
                    sh '''
                        curl -X POST "${TESTPLANIT_URL}/api/test-results/import" \
                            -H "Authorization: Bearer ${TESTPLANIT_TOKEN}" \
                            -F "files=@target/surefire-reports/TEST-*.xml" \
                            -F "name=Build ${BUILD_NUMBER}" \
                            -F "projectId=${PROJECT_ID}" \
                            -F "format=auto"
                    '''
                }
            }
        }
    }
}
```

#### .NET with NUnit/xUnit

```yaml
# GitHub Actions example
- name: Run Tests
  run: dotnet test --logger "trx;LogFileName=results.trx"

- name: Upload Results
  run: |
    curl -X POST "${{ secrets.TESTPLANIT_URL }}/api/test-results/import" \
        -H "Authorization: Bearer ${{ secrets.TESTPLANIT_TOKEN }}" \
        -F "files=@TestResults/results.trx" \
        -F "name=PR #${{ github.event.number }}" \
        -F "projectId=${{ vars.PROJECT_ID }}" \
        -F "format=auto"
```

#### Node.js with Mocha

```bash
# Generate JSON report
mocha --reporter json > test-results.json

# Upload to TestPlanIt
curl -X POST "${TESTPLANIT_URL}/api/test-results/import" \
    -F "files=@test-results.json" \
    -F "name=Mocha Tests $(date +%Y-%m-%d)" \
    -F "projectId=${PROJECT_ID}" \
    -F "format=mocha"
```

#### Cucumber/BDD

```bash
# Generate Cucumber JSON report
cucumber-js --format json:results.json

# Upload to TestPlanIt
curl -X POST "${TESTPLANIT_URL}/api/test-results/import" \
    -F "files=@results.json" \
    -F "name=BDD Tests $(date +%Y-%m-%d)" \
    -F "projectId=${PROJECT_ID}" \
    -F "format=cucumber"
```

### Test Management Migration

```bash
# Export from old system
curl -X GET "https://old-system.com/api/testcases" > testcases.json

# Convert to CSV format
python convert-to-csv.py testcases.json testcases.csv

# Import to TestPlanIt
# Use CSV import feature in UI
```

## API Reference

### CSV Import API

```http
POST /api/repository/import
Content-Type: multipart/form-data

file: [CSV file]
options: {
  "folder": "/Imported Tests",
  "template": "Standard Template",
  "createFolders": true,
  "mergeTags": true
}
```

### Automated Test Results Import API

```http
POST /api/test-results/import
Content-Type: multipart/form-data

files: [Test result file(s)]
name: "Test Run Name"
projectId: 123
format: "auto" | "junit" | "testng" | "nunit" | "xunit" | "mstest" | "mocha" | "cucumber"
templateId: 456
stateId: 789
parentFolderId: 101
configId: 102 (optional)
milestoneId: 103 (optional)
tagIds: [1, 2, 3] (optional)
```

Response is Server-Sent Events (SSE) with progress updates:

```json
{"progress": 25, "status": "Processing test case 5 of 20..."}
{"progress": 100, "status": "Import completed successfully!"}
{"complete": true, "testRunId": 12345}
```

### Export API

```http
GET /api/repository/export?format=csv&folder=/&includeSubfolders=true
```

## Best Practices

### For Import Operations

1. **Data Preparation**
   - Clean and validate data before import
   - Use consistent naming conventions
   - Prepare folder structure in advance

2. **Testing**
   - Test with small data sets first
   - Use preview mode to validate mapping
   - Backup existing data before bulk operations

3. **Performance**
   - Split large imports into smaller batches
   - Import during off-peak hours
   - Monitor system resources during import

### For Export Operations

1. **Regular Backups**
   - Schedule regular data exports
   - Export to multiple formats
   - Store exports in secure locations

2. **Selective Exports**
   - Export only necessary data
   - Use filters to reduce file size
   - Consider privacy and security requirements

## Troubleshooting

### Common Import Issues

**Issue**: CSV parsing errors
**Solution**: Check file encoding (UTF-8), delimiter consistency, quote handling

**Issue**: Field mapping failures
**Solution**: Verify column headers match expected format, check data types

**Issue**: Duplicate test cases
**Solution**: Use update mode instead of create, check duplicate detection settings

**Issue**: Attachment import failures
**Solution**: Verify file accessibility, check file size limits, validate file types

### Performance Optimization

- **Batch Size**: Adjust import batch size for optimal performance
- **Parallel Processing**: Enable parallel import for large datasets
- **Resource Monitoring**: Monitor database and storage during imports
- **Cleanup**: Remove temporary files after import completion