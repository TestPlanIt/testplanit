---
sidebar_position: 15
title: Shared Steps
---

# Shared Steps

Shared Steps allow you to create reusable step groups that can be referenced across multiple test cases, reducing duplication and improving maintenance of common testing procedures.

## Overview

Shared Steps provide:

- **Reusable step libraries** for common testing patterns
- **Centralized maintenance** of frequently used procedures
- **Cross-project sharing** of standardized test steps
- **Version control** for step group changes
- **Efficient test case creation** through step reuse

## What are Shared Steps?

Shared Steps are predefined groups of test steps that can be inserted into multiple test cases. They're particularly useful for:

- **Login procedures** used across many tests
- **Setup and teardown** operations
- **Common navigation flows**
- **Standard verification steps**
- **Data preparation procedures**

### Example Use Cases

**Login Shared Step:**
```
1. Navigate to login page
2. Enter username: {{username}}
3. Enter password: {{password}}
4. Click login button
5. Verify user is logged in
```

**Product Search Shared Step:**
```
1. Navigate to search page
2. Enter search term: {{search_term}}
3. Click search button
4. Verify search results are displayed
```

## Creating Shared Steps

### Accessing Shared Steps

1. Navigate to your project
2. Click **Shared Steps** in the left sidebar
3. Click **Add Shared Step Group** to create new shared steps

### Creating a Shared Step Group

1. **Basic Information**
   - **Name**: Descriptive name for the step group
   - **Description**: Purpose and usage notes
   - **Tags**: Categorization tags

2. **Step Definition**
   - Add individual steps using the step editor
   - Include expected results for each step
   - Use parameter placeholders for reusable values

3. **Parameters**
   - Define parameters using `{{parameter_name}}` syntax
   - Set default values for parameters
   - Add parameter descriptions for clarity

### Step Editor Features

**Rich Text Formatting:**
- Bold, italic, underline text
- Bullet points and numbered lists
- Code blocks and syntax highlighting
- Links and references

**Parameter Support:**
- Use `{{parameter_name}}` for dynamic values
- Parameters automatically detected and configurable
- Default values and validation rules

**Attachments:**
- Add reference images or documents
- Include template files or examples
- Attach configuration files

## Using Shared Steps in Test Cases

### Inserting Shared Steps

When creating or editing a test case:

1. Click **Insert Shared Step** in the step editor
2. Browse or search available shared step groups
3. Select the desired shared step group
4. Configure parameter values
5. Insert into your test case

### Parameter Configuration

When inserting shared steps:

1. **Review Parameters**: See all available parameters
2. **Set Values**: Provide specific values for this test case
3. **Use Defaults**: Keep default values where appropriate
4. **Validation**: Ensure required parameters are filled

Example parameter configuration:
```
Shared Step: User Login
Parameters:
- username: "testuser@example.com"
- password: "SecurePassword123"
- expected_role: "Administrator"
```

### Step References

Shared steps appear in test cases as references:

```
Step 3: [Shared] User Login
  → Username: testuser@example.com
  → Password: SecurePassword123
  → Expected Role: Administrator

Step 4: Navigate to dashboard
Step 5: Verify admin menu is visible
```

## Managing Shared Steps

### Viewing Shared Steps

The Shared Steps page displays:

- **Name and Description**: Overview of each step group
- **Usage Count**: Number of test cases using these steps
- **Last Modified**: Recent change information
- **Tags**: Categorization and filtering
- **Actions**: Edit, copy, delete options

### Editing Shared Steps

1. Click the **Edit** button on a shared step group
2. Modify steps, parameters, or metadata
3. Save changes
4. All referencing test cases automatically updated

:::warning Impact of Changes
Editing shared steps affects ALL test cases that use them. Review usage before making changes.
:::

### Versioning Shared Steps

Shared steps support version history:

- **View History**: See all previous versions
- **Compare Versions**: Diff between versions
- **Restore Version**: Revert to previous version
- **Version Notes**: Add change descriptions

### Copying Shared Steps

Create variations of existing shared steps:

1. Click **Copy** on an existing shared step group
2. Modify the copied version
3. Save with a new name
4. Original shared steps remain unchanged

## Advanced Features

### Cross-Project Sharing

Share step groups across multiple projects:

1. **Export Shared Steps**: Export to file format
2. **Import to Project**: Import into target project
3. **Maintain Separately**: Each project can modify independently
4. **Template Sharing**: Create organization-wide templates

### Search and Filtering

Find shared steps efficiently:

- **Text Search**: Search in names and descriptions
- **Tag Filtering**: Filter by category tags
- **Usage Filtering**: Find frequently or rarely used steps
- **Recent Activity**: See recently modified steps

### Bulk Operations

Manage multiple shared steps:

- **Bulk Edit**: Update tags or descriptions
- **Bulk Export**: Export multiple step groups
- **Bulk Delete**: Remove unused step groups
- **Batch Import**: Import multiple step groups

## Best Practices

### Creating Effective Shared Steps

1. **Single Responsibility**: Each shared step should have one clear purpose
2. **Descriptive Names**: Use clear, searchable names
3. **Parameter Usage**: Make steps flexible with parameters
4. **Documentation**: Include good descriptions and examples
5. **Logical Grouping**: Group related steps together

### Parameter Design

1. **Meaningful Names**: Use descriptive parameter names
2. **Default Values**: Provide sensible defaults
3. **Validation**: Include parameter requirements
4. **Documentation**: Explain parameter usage

### Organization and Maintenance

1. **Consistent Naming**: Follow naming conventions
2. **Regular Reviews**: Periodically review and clean up
3. **Usage Monitoring**: Track which steps are actively used
4. **Version Control**: Use version history effectively
5. **Team Coordination**: Coordinate changes with team members

### Performance Considerations

1. **Step Complexity**: Keep shared steps reasonably sized
2. **Nesting Limits**: Avoid deeply nested shared step references
3. **Parameter Count**: Limit number of parameters per step group
4. **Regular Cleanup**: Remove unused shared steps

## Examples

### Common Shared Step Patterns

**Application Login:**
```
Name: Standard User Login
Parameters: username, password, expected_page

Steps:
1. Navigate to {{base_url}}/login
2. Enter username: {{username}}
3. Enter password: {{password}}  
4. Click "Sign In" button
5. Wait for page load
6. Verify current page is {{expected_page}}
```

**Database Setup:**
```
Name: Test Data Preparation
Parameters: dataset_name, cleanup_option

Steps:
1. Connect to test database
2. Run cleanup script if {{cleanup_option}} is true
3. Load dataset: {{dataset_name}}
4. Verify data integrity
5. Log setup completion
```

**API Authentication:**
```
Name: Get API Access Token
Parameters: client_id, client_secret, scope

Steps:
1. Send POST to /oauth/token
2. Include client_id: {{client_id}}
3. Include client_secret: {{client_secret}}
4. Include scope: {{scope}}
5. Store returned access_token
6. Verify token is valid
```

## Troubleshooting

### Common Issues

**Missing Parameters:**
- Ensure all required parameters are defined
- Check parameter names match exactly
- Verify default values are provided where needed

**Step Reference Errors:**
- Shared step may have been deleted or renamed
- Check if you have access to the shared step
- Verify shared step is in the same project

**Performance Issues:**
- Large shared steps may slow test case loading
- Consider breaking complex steps into smaller groups
- Remove unused parameters and steps

### Resolution Steps

1. **Check Access**: Ensure you have permission to view/edit shared steps
2. **Verify References**: Confirm shared steps still exist
3. **Update Parameters**: Ensure parameter values are valid
4. **Review Changes**: Check recent modifications to shared steps
5. **Contact Admin**: Get help with access or technical issues

## API Reference

### Get Shared Steps

```http
GET /api/projects/{projectId}/shared-steps
```

### Create Shared Step Group

```http
POST /api/projects/{projectId}/shared-steps
Content-Type: application/json

{
  "name": "User Login",
  "description": "Standard login procedure",
  "steps": [
    {
      "action": "Navigate to login page",
      "expected": "Login form displays"
    }
  ],
  "parameters": [
    {
      "name": "username",
      "defaultValue": "testuser",
      "required": true
    }
  ]
}
```

### Use Shared Step in Test Case

```http
POST /api/test-cases/{caseId}/steps
Content-Type: application/json

{
  "type": "shared_step",
  "sharedStepId": "uuid",
  "parameters": {
    "username": "specific_user",
    "password": "specific_password"
  }
}
```