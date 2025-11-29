---
title: Documentation
sidebar_position: 2 # After Overview
---

# Project Documentation

The Documentation section provides a rich-text space for project-specific documentation such as test strategies, scope definitions, onboarding guides, and reference materials. Each project has its own dedicated documentation page that supports collaborative editing with comprehensive formatting capabilities.

## Overview

Project documentation provides:

- **Rich Text Editing** - Full-featured editor with formatting, media, and AI assistance
- **Centralized Knowledge** - Single source of truth for project information
- **Access Control** - Permission-based editing with read-only viewing
- **Version History** - Track changes through edit and save operations
- **Collaborative** - Multiple team members can contribute to project documentation
- **Default Templates** - Start with pre-configured documentation structure

## Accessing Documentation

Navigate to **Projects** → **[Your Project]** → **Documentation** from the sidebar.

The documentation page displays:
- **Project Header** - Shows project icon and name
- **Edit Button** - Available to users with edit permissions (top-right)
- **Rich Text Content** - Formatted documentation displayed in a full-height editor

## Viewing Documentation

All project members with read access can view documentation:

1. Navigate to the Documentation tab for your project
2. View the rendered rich-text content
3. Scroll through the documentation as needed
4. Links, images, and videos are interactive
5. Code blocks are syntax-highlighted

**Read-Only Mode:**
- Editor displays content without modification capability
- All formatting, images, and media are visible
- Links are clickable
- Users without edit permissions see read-only view automatically

## Editing Documentation

### Starting Edit Mode

To edit project documentation:

1. Click the **Edit Documentation** button in the top-right corner
2. The editor becomes active with full toolbar
3. Make your changes using the rich-text editor
4. Click **Save** to persist changes or **Cancel** to discard

:::info Permissions Required
Editing documentation requires the `Add/Edit` permission for the `Documentation` application area for the specific project. Users without this permission will not see the "Edit Documentation" button and the editor will be read-only.
:::

### Editor Features

The TipTap-based editor provides extensive formatting capabilities:

#### Text Formatting

**Basic Formatting:**
- **Bold** - Highlight important text (Ctrl/Cmd + B)
- **Italic** - Emphasize text (Ctrl/Cmd + I)
- **Underline** - Underline text (Ctrl/Cmd + U)
- **Strikethrough** - Cross out text

**Text Structure:**
- **Heading 1** - Top-level section headers
- **Heading 2** - Subsection headers
- **Heading 3** - Sub-subsection headers
- **Paragraph** - Normal body text
- **Blockquote** - Quoted content
- **Code** - Inline code snippets
- **Code Block** - Multi-line code with syntax highlighting

**Lists:**
- **Bullet List** - Unordered lists
- **Numbered List** - Ordered lists with automatic numbering

#### Advanced Features

**Links:**
1. Select text to link
2. Click the Link button in the toolbar
3. Enter the URL in the popup dialog
4. Click to confirm
5. Linked text appears with link styling

**To Remove Links:**
- Select linked text and click the link button again

**Images:**
1. Click the Upload button or drag and drop an image file
2. Images are automatically uploaded to project storage
3. Resize images by dragging corners (in edit mode)
4. Images display inline within the documentation

**Supported Image Formats:**
- PNG, JPG, JPEG, GIF, WebP
- Automatic resize and optimization

**Videos:**
1. Upload video files using the upload button
2. Videos are embedded with playback controls
3. Supports common video formats

**Emoji:**
1. Click the Emoji button (smile icon)
2. Search or browse GitHub emoji library
3. Click to insert emoji into text
4. Emojis render as standard Unicode characters

**Color:**
- Text color customization available
- Choose from color palette
- Applies to selected text

#### AI Assistance

If your project has LLM integrations configured, AI features become available:

**AI-Powered Actions:**
- **Improve Writing** - Enhance clarity and grammar
- **Make Shorter** - Condense verbose text
- **Make Longer** - Expand brief content
- **Fix Spelling & Grammar** - Correct errors
- **Change Tone** - Adjust formality or style
- **Simplify Language** - Make content more accessible
- **Custom Prompt** - Provide specific instructions

**Using AI Features:**
1. Select text you want to improve
2. Click the AI (wand) button in the toolbar
3. Choose an action from the dropdown
4. AI processes the text using configured LLM
5. Review the suggestion in the dialog
6. Click **Apply** to accept or **Cancel** to discard

**Requirements for AI:**
- Project must have an LLM integration configured
- See [LLM Integrations](../llm-integrations.md) for setup instructions
- Supported providers: OpenAI, Anthropic Claude, Google Gemini, Azure OpenAI, Ollama, Custom LLM

### Saving and Canceling

**Save Changes:**
- Click the **Save** button at the bottom of the editor
- Documentation is saved to the database as JSON
- Changes are immediately visible to all project members
- You return to read-only view mode

**Cancel Editing:**
- Click the **Cancel** button to discard changes
- Original documentation content is restored from the database
- All unsaved edits are lost
- You return to read-only view mode

:::warning Unsaved Changes
Navigating away from the page while editing will lose unsaved changes. Always click Save before leaving.
:::

### Undo and Redo

- **Undo** (Ctrl/Cmd + Z) - Revert the last change
- **Redo** (Ctrl/Cmd + Y / Ctrl/Cmd + Shift + Z) - Reapply undone change
- Edit history is maintained during your editing session
- Undo/redo history is lost when you save or cancel

## Default Documentation Content

### Initial Content

When a project is created, it may include default documentation content based on system configuration.

**Default Template:**
- Configured in system settings under `project_docs_default`
- Administrators can customize the default template
- Provides a starting structure for new projects
- Can include headings, sections, and placeholder text

**Example Default Structure:**
```
# Project Overview
[Project description and goals]

# Testing Strategy
[Approach to testing this project]

# Scope
[What's in scope and out of scope]

# Test Environments
[Available test environments]

# Getting Started
[Onboarding information for new team members]
```

### Customizing Defaults

System administrators can update the default template:
1. Navigate to **Administration** → **Settings**
2. Find the `project_docs_default` configuration
3. Edit the JSON content
4. New projects will use the updated template

## Best Practices

### Documentation Structure

**1. Organize with Headings**
- Use Heading 1 for main sections
- Use Heading 2 and 3 for subsections
- Create a logical hierarchy

**2. Start with Overview**
- Begin with project introduction
- Define scope and objectives
- Link to related resources

**3. Include Key Sections:**
- **Test Strategy** - Overall approach to testing
- **Environments** - Available test environments and access
- **Test Data** - Where to find or how to create test data
- **Known Issues** - Current limitations or workarounds
- **Contacts** - Key stakeholders and their roles
- **Resources** - Links to requirements, designs, APIs

### Writing Effective Documentation

**1. Be Concise**
- Use clear, simple language
- Break up large paragraphs
- Use lists for multiple items
- Avoid unnecessary jargon

**2. Keep It Current**
- Update documentation when processes change
- Remove outdated information
- Mark temporary notes clearly
- Review periodically

**3. Use Visual Elements**
- Include diagrams and screenshots
- Use code blocks for technical examples
- Embed videos for complex workflows
- Use emoji sparingly for visual breaks

**4. Link to Resources**
- Link to external documentation
- Reference test cases and test runs
- Link to issue tracker tickets
- Connect to related projects

### Collaboration Guidelines

**1. Communicate Changes**
- Notify team when making major updates
- Use comments to discuss changes
- Coordinate with other editors
- Avoid simultaneous editing

**2. Establish Conventions**
- Agree on documentation structure
- Define standard sections
- Use consistent terminology
- Follow style guidelines

**3. Ownership and Maintenance**
- Assign documentation ownership
- Schedule regular reviews
- Archive obsolete content
- Keep information accurate

## Common Use Cases

### Test Strategy Documentation

**Purpose**: Define the overall testing approach

**Content to Include:**
- Testing objectives and goals
- Types of testing (unit, integration, E2E, performance)
- Test coverage targets
- Entry and exit criteria
- Risk assessment
- Tools and frameworks
- Reporting procedures

**Example Structure:**
```markdown
# Test Strategy

## Objectives
- Ensure all critical user flows are tested
- Maintain 80%+ code coverage
- Automate regression tests

## Testing Types
### Unit Testing
- Framework: Jest
- Coverage target: 80%
- Responsible: Developers

### Integration Testing
- Framework: Playwright
- Environment: Staging
- Frequency: Every release

## Risk Assessment
- High Risk: Payment processing
- Medium Risk: User authentication
- Low Risk: UI cosmetics
```

### Onboarding Guide

**Purpose**: Help new team members get started

**Content to Include:**
- Project overview and context
- Team structure and contacts
- Development environment setup
- Test environment access
- Coding standards
- Testing standards
- Common workflows
- FAQ

### Environment Documentation

**Purpose**: Document test environments and access

**Content to Include:**
- Environment names and URLs
- Access credentials (or where to find them)
- Environment-specific configurations
- Data refresh schedules
- Known environment issues
- Deployment procedures

### API Reference

**Purpose**: Document APIs under test

**Content to Include:**
- Base URLs for different environments
- Authentication methods
- Key endpoints and their purposes
- Request/response examples
- Rate limits
- Error codes

### Runbook

**Purpose**: Operational procedures for testing

**Content to Include:**
- How to execute test runs
- Smoke test procedures
- Regression test procedures
- Performance test procedures
- Bug reporting process
- Escalation procedures

## Troubleshooting

### Cannot Edit Documentation

**Issue**: Edit button is not visible or disabled

**Solutions:**
- Verify you have the `Add/Edit` permission for Documentation
- Check your project role and permissions
- Contact project admin to request edit access
- Ensure you're viewing the correct project

### Changes Not Saving

**Issue**: Save button doesn't work or changes are lost

**Solutions:**
- Check your network connection
- Ensure you clicked Save (not just Cancel)
- Verify you have edit permissions
- Try refreshing and re-editing
- Check browser console for errors

### Images Not Uploading

**Issue**: Image upload fails or images don't display

**Solutions:**
- Verify image file size is reasonable (< 10MB recommended)
- Check file format is supported (PNG, JPG, GIF, WebP)
- Ensure project has file storage configured
- Check network connectivity during upload
- Try using a smaller image

### AI Features Not Available

**Issue**: AI button is missing or doesn't work

**Solutions:**
- Verify project has LLM integration configured
- Check that integration is active and properly set up
- Ensure you selected text before clicking AI button
- Verify API keys are valid for the LLM provider
- Check project permissions for LLM features

### Content Formatting Lost

**Issue**: Formatting disappears or looks incorrect

**Solutions:**
- Avoid pasting from Microsoft Word (use plain text)
- Use the editor's formatting tools rather than copy-paste
- Clear formatting and reapply if needed
- Check for conflicting HTML in pasted content
- Try editing in a different browser

### Performance Issues

**Issue**: Editor is slow or unresponsive

**Solutions:**
- Break up very long documentation into multiple sections
- Optimize large images before uploading
- Remove unused images and videos
- Clear browser cache
- Try a different browser
- Check system resources

## Permissions

### Required Permissions

**View Documentation:**
- Read access to the project
- Default permission for all project members
- Documentation inherits project access control

**Edit Documentation:**
- `Add/Edit` permission for `Documentation` application area
- Assigned at the project level through roles
- Typically granted to Managers, Admins, and specific Members

### Permission Levels

**Project Roles with Documentation Editing:**
- **Admin** - Full edit access
- **Manager** - Full edit access (default)
- **Member** - Can be granted edit access
- **Tester** - Typically read-only
- **Guest** - Read-only

**Granting Edit Access:**
1. Navigate to **Projects** → **[Project]** → **Settings** → **Permissions**
2. Select a role to modify
3. Enable `Add/Edit` for the `Documentation` application area
4. Save changes
5. Users with that role can now edit documentation

## Technical Details

### Storage Format

- Documentation is stored in the `Projects.docs` field
- Format: JSON (TipTap document structure)
- Contains content nodes with formatting metadata
- Supports rich media references (images, videos)

**Example JSON Structure:**
```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "Project Overview" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "This project..." }]
    }
  ]
}
```

### File Uploads

- Images and videos are uploaded to project file storage
- S3 or MinIO backend (configurable)
- Files are associated with the project
- URLs are embedded in the documentation JSON
- Deleted documentation doesn't auto-delete uploaded files

### Performance

- Documentation loads asynchronously
- Large documents are handled efficiently by TipTap
- Images are lazy-loaded
- Video playback is on-demand
- Editor optimized for documents up to several MB

### Browser Compatibility

- Modern browsers: Chrome, Firefox, Safari, Edge
- JavaScript must be enabled
- Drag-and-drop requires modern browser
- Mobile browsers supported (view mode)
- Edit mode best on desktop/laptop

## API Reference

### Get Project Documentation

```http
GET /api/model/Projects/findFirst?q={
  "where": { "id": 123 },
  "select": { "docs": true }
}
```

### Update Project Documentation

```http
PUT /api/model/Projects/update
Content-Type: application/json

{
  "where": { "id": 123 },
  "data": {
    "docs": {
      "type": "doc",
      "content": [...]
    }
  }
}
```

**Response:**
```json
{
  "id": 123,
  "name": "Project Name",
  "docs": { "type": "doc", "content": [...] }
}
```

### Default Template Configuration

```http
GET /api/model/AppConfig/findFirst?q={
  "where": { "key": "project_docs_default" }
}
```

Returns the default documentation template used for new projects.

---

**Related Documentation:**
- [Projects](../projects.md) - Project management overview
- [LLM Integrations](../llm-integrations.md) - Configure AI assistance
- [Permissions](../permissions-guide.md) - Understanding access control
