# Import Shared Steps

TestPlanIt allows you to import shared steps from CSV files, making it easy to bulk import shared step groups and their associated steps from external tools or existing datasets.

## Accessing the Import Feature

1. Navigate to **Shared Steps** in your project
2. Click the **Import Shared Steps** button (visible to users with edit permissions)
3. The Import Wizard will guide you through the process

## Import Wizard

The import process consists of three steps:

### Step 1: Upload File and Configuration

- **Upload CSV File**: Select your CSV file containing the shared steps data
- **Field Delimiter**: Choose the delimiter used in your CSV (comma, semicolon, colon, pipe, or tab)
- **First row contains headers**: Check this if your CSV has column headers in the first row
- **File Encoding**: Select the character encoding of your file (UTF-8, ISO-8859-1, ISO-8859-15, or Windows-1252)
- **Row Mode**: Choose how steps are organized in your CSV:
  - **Single row per shared step**: Each row represents one step within a group
  - **Multiple rows for complex shared steps**: Multiple rows can belong to the same shared step group

### Step 2: Map CSV Columns to Fields

Map your CSV columns to the appropriate shared step fields:

#### Required Fields

- **Group Name**: The name of the shared step group

#### Optional Fields

- **Step**: The action to be performed (required for multi-row mode)
- **Expected Result**: The expected outcome of the step
- **Order**: The sequence number of the step within the group
- **Step #**: Step number (for multi-row exports)
- **Step Content**: Step action content (for multi-row exports)
- **Expected Result Content**: Expected result content (for multi-row exports)
- **Combined Step Data**: All steps in JSON or formatted text (for single-row exports)
- **Steps Data**: Alternative field name for combined step data

### Step 3: Preview Import Data

Review the data that will be imported before finalizing the import. You can navigate through pages of data to ensure everything looks correct.

## Supported CSV Formats

TestPlanIt can import shared steps in multiple formats, including data exported from TestPlanIt itself:

### Simple Format (Basic Import)

```csv
Group Name,Step,Expected Result,Order
"Login Steps","Navigate to login page","Login page is displayed",1
"Login Steps","Enter username and password","Credentials are entered",2
"Login Steps","Click login button","User is logged in successfully",3
"Search Steps","Click search button","Search results are displayed",1
"Search Steps","Enter search term","Search term is entered in field",2
```

### Multi-Row Export Format

When importing data exported from TestPlanIt in multi-row mode:

```csv
Group Name,Step #,Step Content,Expected Result Content
"User Authentication",1,"Navigate to the login page","The login page should be displayed with username and password fields"
"User Authentication",2,"Enter valid username in the username field","The username should be accepted and displayed in the field"
"User Authentication",3,"Enter valid password in the password field","The password should be masked with asterisks"
"User Authentication",4,"Click the Login button","The user should be redirected to the dashboard"
"Product Search",1,"Navigate to the products page","The products page should load with a search bar"
"Product Search",2,"Enter 'laptop' in the search field","The search term should appear in the search field"
"Product Search",3,"Click the Search button","A list of laptop products should be displayed"
```

### Single-Row Export Format (JSON)

When importing data exported from TestPlanIt in single-row mode with JSON format:

```csv
Group Name,Combined Step Data
"Login Process","[{""stepNumber"":1,""step"":""Navigate to login page"",""expectedResult"":""Login page displays""},{""stepNumber"":2,""step"":""Enter credentials"",""expectedResult"":""Fields are populated""}]"
```

### Single-Row Export Format (Plain Text)

When importing data exported from TestPlanIt in single-row mode with plain text format:

```csv
Group Name,Steps Data
"Login Process","Step 1:\nNavigate to login page\nExpected Result 1:\nLogin page displays\n---\nStep 2:\nEnter credentials\nExpected Result 2:\nFields are populated"
```

## Step Content Formats

TestPlanIt supports both plain text and rich text (JSON) formats for step content:

### Plain Text

Simple text that will be converted to the appropriate format for storage.

### JSON Format (TipTap/ProseMirror)

Rich text in JSON format as used by the TipTap editor:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [
        {
          "type": "text",
          "text": "Click the login button"
        }
      ]
    }
  ]
}
```

## Import Behavior

- **Duplicate Groups**: If a shared step group with the same name already exists, new steps will be added to the existing group
- **Step Ordering**: Steps are ordered based on the Order field if provided, otherwise by their appearance in the CSV
- **Data Validation**: All required fields must be mapped and contain valid data
- **Error Handling**: Any validation errors will be displayed before import, and no data will be imported until all errors are resolved

## Best Practices

1. **Test with Small Files**: Start with a small sample to ensure your CSV format is correct
2. **Use Consistent Naming**: Use consistent group names to avoid creating duplicate groups unintentionally
3. **Include Headers**: Always include column headers in your CSV for easier mapping
4. **Validate Data**: Review the preview carefully before importing
5. **Backup**: Consider exporting existing shared steps before importing new ones

## Troubleshooting

### Common Issues

**"Group name is required" error**

- Ensure every row has a value in the Group Name column
- Check that the Group Name column is properly mapped

**"At least one step field is required" error**

- Ensure you have mapped at least one step content field (Step, Step Content, Combined Step Data, or Steps Data)
- Verify that the mapped columns contain data

**"CSV parsing failed" error**

- Check that your file is a valid CSV format
- Verify the delimiter setting matches your file
- Ensure the file encoding is correct

**Steps appear in wrong order**

- Include an Order column with numeric values
- Ensure the Order column is mapped correctly

### Getting Help

If you encounter issues with importing shared steps:

1. Check the error messages in the import wizard
2. Verify your CSV format matches one of the supported formats
3. Test with a smaller sample file first
4. Contact your system administrator for assistance

## Example Files

You can download these example CSV files to use as templates:

- [Basic Shared Steps Example](/examples/basic-shared-steps.csv) - Simple format with one step per row
- [Multi-Row Export Format Example](/examples/multi-row-shared-steps.csv) - TestPlanIt export format with step numbers

### Basic Example (basic-shared-steps.csv)

```csv
Group Name,Step,Expected Result,Order
"User Login","Open the application","Application launches successfully",1
"User Login","Click on Login link","Login page is displayed",2
"User Login","Enter username","Username field is populated",3
"User Login","Enter password","Password field is populated (masked)",4
"User Login","Click Login button","User is authenticated and redirected to dashboard",5
"Product Search","Navigate to Products page","Products page loads with search functionality",1
"Product Search","Enter search term in search box","Search term appears in search field",2
"Product Search","Click Search button","Relevant products are displayed in results",3
"Product Search","Select a product from results","Product details page opens",4
"Data Validation","Check required field validation","Error message appears for empty required fields",1
"Data Validation","Enter invalid email format","Validation error shows 'Invalid email format'",2
"Data Validation","Enter password less than 8 characters","Validation error shows 'Password must be at least 8 characters'",3
```

This example demonstrates:

- Multiple shared step groups (User Login, Product Search, Data Validation)
- Steps with clear actions and expected results
- Proper ordering within each group
- Realistic test scenarios