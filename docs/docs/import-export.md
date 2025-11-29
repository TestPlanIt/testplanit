---
sidebar_position: 10
title: Import & Export
---

# Import & Export

TestPlanIt provides comprehensive import and export capabilities to help you migrate data, integrate with other tools, and backup your test management data.

## Overview

The import/export system supports:

- **CSV Import/Export** for test cases and bulk data operations
- **JUnit XML Import** for automated test results
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

Your CSV file should include these standard columns:

| Column | Required | Description |
|--------|----------|-------------|
| `title` | Yes | Test case title |
| `description` | No | Test case description |
| `steps` | No | Test steps (formatted) |
| `expected_result` | No | Expected outcome |
| `folder_path` | No | Repository folder path |
| `tags` | No | Comma-separated tags |
| `automation_status` | No | MANUAL or AUTOMATED |
| `estimate` | No | Time estimate in minutes |
| `template_name` | No | Template to apply |

#### Example CSV Format

```csv
title,description,steps,expected_result,folder_path,tags,automation_status,estimate
"Login Test","Test user login functionality","1. Navigate to login page\n2. Enter credentials\n3. Click login","User is logged in successfully","/Authentication/Login","smoke,login",MANUAL,5
"Password Reset","Test password reset flow","1. Click forgot password\n2. Enter email\n3. Check email","Reset link received","/Authentication/Password","email,security",MANUAL,10
```

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

**Standard Fields:**
- Title, Description, Expected Result
- Automation Status, Estimate
- Priority, Severity (if configured)

**Custom Fields:**
- Map to template-specific custom fields
- Automatic type conversion (text, number, date)
- Default value assignment for missing data

**Special Handling:**
- **Folders**: Auto-create folder hierarchy
- **Tags**: Merge with existing or replace
- **Templates**: Apply template and custom fields
- **Attachments**: Reference external files

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

## JUnit XML Import

Import automated test results from JUnit XML files.

### Accessing JUnit Import

1. Navigate to **Test Runs** in your project
2. Click **Import Results** button
3. Select **JUnit XML Import**

### JUnit XML Format

TestPlanIt supports standard JUnit XML format:

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

### Import Process

1. **Upload JUnit File**
   - Select JUnit XML file
   - Validate XML format

2. **Test Run Configuration**
   - Create new test run or add to existing
   - Set test run name and description
   - Choose configuration (environment)

3. **Test Case Mapping**
   - Map JUnit test names to existing test cases
   - Auto-create missing test cases option
   - Set folder for new test cases

4. **Result Processing**
   - Import test results with status mapping:
     - **Success** → Passed
     - **Failure** → Failed
     - **Error** → Blocked
     - **Skipped** → Skipped

5. **Review and Confirm**
   - Review mapping summary
   - Start import process
   - View import results

### Status Mapping

| JUnit Status | TestPlanIt Status | Description |
|-------------|-------------------|-------------|
| Success | Passed | Test executed successfully |
| Failure | Failed | Test assertion failed |
| Error | Blocked | Test execution error |
| Skipped | Skipped | Test was not executed |

### Test Case Auto-Creation

When importing JUnit results, TestPlanIt can automatically create missing test cases:

- **Test Name**: Uses JUnit test name
- **Class Name**: Added as tag or custom field
- **Folder**: Organized by class name or custom structure
- **Template**: Applied based on configuration

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
                    uploadToTestPlanIt(
                        file: 'target/surefire-reports/TEST-*.xml',
                        project: 'my-project',
                        testRun: env.BUILD_NUMBER
                    )
                }
            }
        }
    }
}
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

### JUnit Import API

```http
POST /api/junit/import
Content-Type: multipart/form-data

file: [JUnit XML file]
testRunId: "123e4567-e89b-12d3-a456-426614174000"
createTestCases: true
folder: "/Automated Tests"
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