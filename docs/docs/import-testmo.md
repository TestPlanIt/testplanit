---
title: Testmo Import
sidebar_position: 10
---

# Testmo Import

TestPlanIt provides a comprehensive import wizard for migrating data from Testmo exports. This feature allows administrators to import test cases, test runs, users, configurations, and other data from Testmo into TestPlanIt.

:::info Administrator Feature
Testmo import is only available to system administrators (users with ADMIN access level).
:::

## Overview

The Testmo import process consists of four main steps:

1. **Upload** - Upload your Testmo export file
2. **Analyze** - System analyzes the data and provides a summary
3. **Configure** - Map Testmo data to TestPlanIt entities
4. **Import** - Execute the import and monitor progress

## Prerequisites

Before starting the import:

1. **Export from Testmo** - Create a full export from your Testmo instance
2. **Administrator Access** - Ensure you have ADMIN access in TestPlanIt
3. **Project Setup** - Consider creating target projects in TestPlanIt beforehand
4. **Backup** - Take a database backup before importing large datasets

## Accessing the Import Tool

1. Log in as an administrator
2. Navigate to **Administration** > **Imports**
3. Click on the **Testmo** tab
4. The import wizard interface will appear

## Import Wizard Steps

### Step 1: Upload

Upload your Testmo export file to begin the import process.

**Upload Process:**

1. Click the **Upload File** button or drag and drop your file
2. Select the Testmo export ZIP file from your computer
3. Wait for the file to upload completely
4. The system validates the file format
5. Once validated, the **Next** button becomes available

**Supported Formats:**
- Testmo export ZIP files
- Maximum file size depends on your server configuration

**File Validation:**
- System checks for required datasets
- Verifies file structure and integrity
- Displays warnings for any issues detected

:::tip File Size
Large Testmo exports may take several minutes to upload. The progress bar shows upload status.
:::

### Step 2: Analyze

The system automatically analyzes the uploaded data and presents a summary.

**Analysis Information Displayed:**

- **File Details:**
  - Original file name
  - File size
  - Upload timestamp

- **Dataset Summary:**
  - List of all datasets found in the export
  - Row counts for each dataset
  - Sample data preview
  - Schema information

- **Supported Datasets:**
  - Workflow States
  - Test Run Statuses
  - Templates and Template Fields
  - Custom Fields
  - Milestone Types
  - Roles and Users
  - Groups
  - Issue Tracker Integrations
  - Test Configurations
  - Tags

- **Dataset Details Table:**
  For each dataset, you can see:
  - Dataset name
  - Total row count
  - Sample rows displayed
  - Whether data was truncated (for very large datasets)

**Actions:**
- **View Details** - Expand each dataset to see sample data
- **Back** - Return to upload step to choose a different file
- **Next** - Proceed to configuration step

:::note Data Limits
For performance reasons, the system may truncate very large datasets in the preview. All data will be imported regardless of truncation in the preview.
:::

### Step 3: Configure

Map Testmo entities to TestPlanIt entities to ensure correct data import.

**Mapping Configuration:**

The configuration step allows you to:

1. **Map Existing Entities** - Link Testmo data to existing TestPlanIt records
2. **Create New Entities** - Automatically create new records during import
3. **Skip Entities** - Exclude certain data from import

**Configurable Mappings:**

**Workflow States:**
- Map Testmo states to TestPlanIt workflow states
- Choose to map to existing or create new states
- Configure state types (Not Started, In Progress, Done)

**Test Run Statuses:**
- Map Testmo statuses to TestPlanIt test result statuses
- Link to existing statuses or create new ones
- Set status completion behavior

**Users:**
- Map Testmo users to TestPlanIt users by email
- Option to create placeholder users for missing accounts
- Configure user access levels and roles

**Roles:**
- Map Testmo roles to TestPlanIt project roles
- Create new roles if needed
- Define permission mappings

**Templates:**
- Map Testmo test case templates to TestPlanIt templates
- Link template fields appropriately
- Configure default templates

**Template Fields:**
- Map custom fields from Testmo to TestPlanIt
- Match field types (text, dropdown, number, etc.)
- Configure field options and defaults

**Milestone Types:**
- Map Testmo milestone types to TestPlanIt
- Create new milestone type configurations

**Groups:**
- Map Testmo groups to TestPlanIt groups
- Configure group memberships

**Issue Tracker Integrations:**
- Map Testmo issue tracker configs to TestPlanIt integrations
- Configure integration authentication

**Test Configurations:**
- Map Testmo test configurations to TestPlanIt
- Set up configuration options

**Tags:**
- Map Testmo tags to TestPlanIt tags
- Merge or create separate tags

**Mapping Interface:**

For each dataset, you'll see:
- **Source**: Testmo entity name and ID
- **Mapping Type**: Dropdown to choose "Map to Existing" or "Create New"
- **Target**: Dropdown to select existing TestPlanIt entity (when mapping)
- **Preview**: Shows how the mapping will work

**Best Practices:**

1. **Review All Mappings** - Check each dataset configuration carefully
2. **Map Before Creating** - Prefer mapping to existing entities when possible
3. **User Mapping** - Ensure user email addresses match between systems
4. **Test with Sample** - Consider testing with a small export first
5. **Document Changes** - Note any mapping decisions for future reference

:::warning Mapping Accuracy
Incorrect mappings can lead to data inconsistencies. Review all configurations carefully before proceeding to import.
:::

**Actions:**
- **Configure Mappings** - Use the mapping configurator for each dataset
- **Reset** - Reset all mappings to defaults
- **Back** - Return to analysis step
- **Start Import** - Begin the import process with current configuration

### Step 4: Import

Execute the import and monitor real-time progress.

**Import Process:**

Once you click "Start Import":

1. **Queuing** - Import job is queued in the background worker system
2. **Processing Phases**:
   - **Uploading** - Preparing data for import
   - **Analyzing** - Re-validating data structure
   - **Configuring** - Applying mapping configuration
   - **Importing** - Creating/updating records in TestPlanIt
   - **Finalizing** - Completing import and cleanup

**Progress Monitoring:**

The interface displays real-time import progress:

- **Overall Progress Bar** - Shows completion percentage
- **Current Phase** - Displays which phase is executing
- **Status Messages** - Provides detailed status updates
- **Processed Datasets** - Shows which datasets have been imported
- **Error Messages** - Displays any errors encountered

**Import Statistics:**

After import completes, you'll see:
- Total records processed
- Records created vs. updated
- Processing duration
- Any warnings or errors
- Link to view imported data

**Background Processing:**

Imports run as background jobs:
- You can navigate away from the page
- Progress is saved and can be checked later
- Multiple imports can be queued
- System admin receives notifications on completion

:::note Long-Running Imports
Large Testmo exports may take significant time to import. The process continues in the background even if you close the browser.
:::

## Import Data Types

### Projects

Testmo projects are imported as TestPlanIt projects:
- Project name and description
- Project settings and preferences
- Project members and assignments
- Default configurations

### Test Cases

Repository test cases are imported with:
- Test case name and description
- Test steps and expected results
- Custom field values
- Tags and categorization
- Template associations
- Folder structure

### Test Runs

Test runs are imported with:
- Run name and configuration
- Associated test cases
- Test results and outcomes
- Execution history
- Milestone assignments

### Milestones

Milestones are imported with:
- Milestone name and description
- Due dates
- Hierarchical structure (parent/child relationships)
- Milestone type associations
- Completion status

### Custom Fields

Custom fields are mapped and imported:
- Field definitions (case fields and result fields)
- Field types and configurations
- Field values for all entities
- Dropdown options and defaults

### Users and Groups

User and group data:
- User accounts (matched by email)
- Group definitions
- Group memberships
- Role assignments
- Access permissions

## Troubleshooting

### Upload Fails

**Issue**: File upload fails or times out

**Solutions**:
- Check file format (must be Testmo export ZIP)
- Verify file size is within limits
- Ensure stable internet connection
- Try uploading in smaller chunks if possible
- Contact administrator for server configuration

### Analysis Errors

**Issue**: Analysis step shows errors or warnings

**Solutions**:
- Review the error messages for specific issues
- Verify the export was created correctly in Testmo
- Check for corrupt or incomplete export files
- Re-export from Testmo and try again

### Mapping Confusion

**Issue**: Unsure how to configure mappings

**Solutions**:
- Start with default "Create New" for unfamiliar items
- Map users by email for accuracy
- Leave complex mappings for later manual cleanup
- Document mapping decisions for reference
- Contact support for guidance on specific mappings

### Import Stalls

**Issue**: Import progress appears stuck

**Solutions**:
- Large imports may take hours - be patient
- Check system resources (CPU, memory, database)
- Review background worker logs
- Check for database connection issues
- Contact administrator to check worker status

### Partial Import

**Issue**: Some data imported but not all

**Solutions**:
- Review error messages in import log
- Check for data validation failures
- Verify all mappings were configured correctly
- May need to manually import failed items
- Contact support with job ID for investigation

### Duplicate Data

**Issue**: Import created duplicate records

**Solutions**:
- Check if "Create New" was used instead of "Map to Existing"
- Review user and entity mappings
- May need to manually clean up duplicates
- Re-import with correct mappings if necessary

## Best Practices

### Pre-Import Planning

1. **Review Export** - Examine Testmo export before uploading
2. **Clean Data** - Remove obsolete data in Testmo before exporting
3. **Document Structure** - Note Testmo project and data structure
4. **Plan Mappings** - Decide mapping strategy in advance
5. **Test First** - Try with a small subset if possible

### During Import

1. **Monitor Progress** - Keep the import page open initially
2. **Note Issues** - Document any warnings or errors
3. **Avoid Conflicts** - Don't modify data in TestPlanIt during import
4. **Check Resources** - Monitor server resources for large imports
5. **Stay Available** - Be available to address issues if they arise

### Post-Import Validation

1. **Verify Data** - Spot-check imported records for accuracy
2. **Test Functionality** - Ensure imported data works as expected
3. **Check Relationships** - Verify links between entities are correct
4. **User Access** - Confirm users have appropriate permissions
5. **Clean Up** - Remove any test or temporary data

### Multiple Imports

If importing from multiple Testmo projects:

1. Import one project at a time
2. Verify each import before proceeding
3. Reuse mappings where appropriate
4. Document mapping decisions between imports
5. Consider creating separate TestPlanIt projects

## Security and Access Control

### Admin-Only Access

- Only system administrators can initiate imports
- Regular users cannot view or access import functionality
- Import jobs are logged with creator information

### Data Privacy

- Uploaded files are stored securely
- Files are deleted after import completes (configurable)
- Sensitive data (passwords) is not exported by Testmo
- User emails are used for matching but not exposed

### Audit Trail

All import activities are logged:
- Import job creation timestamp
- User who initiated the import
- Configuration changes
- Success/failure status
- Duration and statistics

## Technical Details

### Background Workers

Imports use the BullMQ background job system:
- Jobs are queued and processed asynchronously
- Supports job retry on failure
- Progress is tracked in real-time
- Multiple workers can process jobs concurrently

### Database Transactions

Import operations use transactions where appropriate:
- Related records are imported together
- Failed imports can be rolled back
- Data integrity is maintained
- Foreign key relationships are preserved

### Performance Considerations

For large imports:
- Process runs in batches to avoid memory issues
- Database indexes are used for fast lookups
- Progress is saved incrementally
- System can handle imports with thousands of records

## API Reference

### Start Import Job

```http
POST /api/admin/imports/testmo/jobs
Content-Type: multipart/form-data

file: <Testmo export ZIP file>
```

### Get Import Status

```http
GET /api/admin/imports/testmo/jobs/{jobId}
```

### Configure Mappings

```http
PUT /api/admin/imports/testmo/jobs/{jobId}/configuration
Content-Type: application/json

{
  "mappings": {
    "states": [...],
    "users": [...],
    ...
  }
}
```

### Execute Import

```http
POST /api/admin/imports/testmo/jobs/{jobId}/execute
```

---

**Related Documentation:**
- [Import & Export](./import-export.md) - CSV and JUnit import options
- [Administration](./user-guide/administration.md) - Admin panel overview
- [Background Processes](./background-processes.md) - Worker system details
- [Projects](./user-guide/projects.md) - Project management
