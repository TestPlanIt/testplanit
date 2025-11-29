#!/usr/bin/env node
import { writeFileSync } from 'fs';

// Generate a large CSV file for ImportCasesWizard stress testing
const generateLargeCSV = () => {
  const folders = [
    'Authentication/Login/Basic',
    'Authentication/Login/Advanced', 
    'Authentication/Login/Social',
    'Authentication/Logout',
    'Authentication/Password/Reset',
    'Authentication/Password/Change',
    'Authentication/2FA/Setup',
    'Authentication/2FA/Verification',
    'User Management/Profile/Basic',
    'User Management/Profile/Advanced',
    'User Management/Profile/Settings',
    'User Management/Account/Creation',
    'User Management/Account/Deletion',
    'User Management/Account/Suspension',
    'User Management/Permissions/Roles',
    'User Management/Permissions/Access',
    'Project Management/Projects/Creation',
    'Project Management/Projects/Editing',
    'Project Management/Projects/Deletion',
    'Project Management/Projects/Settings',
    'Project Management/Templates/Creation',
    'Project Management/Templates/Editing',
    'Team Management/Members/Addition',
    'Team Management/Members/Removal',
    'Team Management/Members/Roles',
    'Team Management/Invitations/Sending',
    'Team Management/Invitations/Accepting',
    'Test Management/Cases/Creation',
    'Test Management/Cases/Editing',
    'Test Management/Cases/Deletion',
    'Test Management/Cases/Copying',
    'Test Management/Cases/Versioning',
    'Test Management/Folders/Creation',
    'Test Management/Folders/Organization',
    'Test Management/Folders/Navigation',
    'Test Management/Import/CSV',
    'Test Management/Import/Excel',
    'Test Management/Export/CSV',
    'Test Management/Export/PDF',
    'Test Execution/Runs/Creation',
    'Test Execution/Runs/Management',
    'Test Execution/Results/Recording',
    'Test Execution/Results/Analysis',
    'Test Execution/Reports/Generation',
    'Test Execution/Reports/Sharing',
    'API Testing/Authentication/Basic',
    'API Testing/Authentication/OAuth',
    'API Testing/Endpoints/GET',
    'API Testing/Endpoints/POST',
    'API Testing/Endpoints/PUT',
    'API Testing/Endpoints/DELETE',
    'API Testing/Data/Validation',
    'API Testing/Performance/Load',
    'UI Testing/Navigation/Menus',
    'UI Testing/Navigation/Breadcrumbs',
    'UI Testing/Forms/Validation',
    'UI Testing/Forms/Submission',
    'UI Testing/Tables/Sorting',
    'UI Testing/Tables/Filtering',
    'UI Testing/Tables/Pagination',
    'Mobile Testing/iOS/iPhone',
    'Mobile Testing/iOS/iPad',
    'Mobile Testing/Android/Phone',
    'Mobile Testing/Android/Tablet',
    'Mobile Testing/Responsive/Design',
    'Browser Testing/Chrome/Latest',
    'Browser Testing/Chrome/Previous',
    'Browser Testing/Firefox/Latest',
    'Browser Testing/Firefox/Previous',
    'Browser Testing/Safari/Latest',
    'Browser Testing/Edge/Latest',
    'Performance Testing/Load/Concurrent',
    'Performance Testing/Load/Stress',
    'Performance Testing/Memory/Usage',
    'Performance Testing/Memory/Leaks',
    'Performance Testing/Database/Queries',
    'Performance Testing/Database/Connections',
    'Security Testing/Authentication/Bypass',
    'Security Testing/Authorization/Escalation',
    'Security Testing/Input/Validation',
    'Security Testing/Input/Injection',
    'Security Testing/Session/Management',
    'Security Testing/Data/Encryption',
    'Integration Testing/External/APIs',
    'Integration Testing/External/Services',
    'Integration Testing/Internal/Modules',
    'Integration Testing/Database/Connections',
    'Integration Testing/File/Systems',
    'Accessibility Testing/Screen/Readers',
    'Accessibility Testing/Keyboard/Navigation',
    'Accessibility Testing/Color/Contrast',
    'Accessibility Testing/WCAG/Compliance',
    'Localization Testing/Languages/Spanish',
    'Localization Testing/Languages/French',
    'Localization Testing/Languages/German',
    'Localization Testing/Languages/Chinese',
    'Localization Testing/Formats/Dates',
    'Localization Testing/Formats/Numbers',
    'Database Testing/CRUD/Operations',
    'Database Testing/Transactions/ACID',
    'Database Testing/Performance/Optimization',
    'Database Testing/Backup/Recovery',
    'Infrastructure Testing/Servers/Linux',
    'Infrastructure Testing/Servers/Windows',
    'Infrastructure Testing/Networks/Connectivity',
    'Infrastructure Testing/Networks/Security',
    'Infrastructure Testing/Cloud/AWS',
    'Infrastructure Testing/Cloud/Azure',
    'Infrastructure Testing/Containers/Docker',
    'Infrastructure Testing/Containers/Kubernetes'
  ];

  const testTypes = [
    'Functional Testing',
    'Integration Testing', 
    'Performance Testing',
    'Security Testing',
    'Usability Testing',
    'Compatibility Testing',
    'Regression Testing',
    'Smoke Testing',
    'Sanity Testing',
    'User Acceptance Testing'
  ];

  const priorities = ['Critical', 'High', 'Medium', 'Low'];
  const automationStatus = [true, false];
  
  const tagSets = [
    'smoke,regression,critical',
    'functional,integration,high-priority',
    'performance,load,stress',
    'security,authentication,authorization',
    'ui,frontend,user-experience',
    'api,backend,integration',
    'mobile,responsive,cross-platform',
    'browser,compatibility,cross-browser',
    'database,data,persistence',
    'infrastructure,deployment,devops'
  ];

  const stepTemplates = [
    "1. Navigate to target page|2. Verify page loads correctly|3. Perform required action|4. Verify expected result|5. Clean up test data",
    "1. Set up test environment|2. Execute test scenario|3. Capture test results|4. Verify against expected outcome|5. Document findings",
    "1. Prepare test data|2. Launch application|3. Execute test steps|4. Validate functionality|5. Reset environment",
    "1. Access test interface|2. Input test data|3. Trigger functionality|4. Observe system behavior|5. Confirm test completion",
    "1. Initialize test conditions|2. Execute primary workflow|3. Verify intermediate states|4. Complete test scenario|5. Validate final state"
  ];

  // Generate CSV content
  let csvContent = 'Name,Folder,Estimate,Forecast,Automated,Tags,Steps\n';
  
  for (let i = 1; i <= 5000; i++) {
    const folder = folders[Math.floor(Math.random() * folders.length)];
    const testType = testTypes[Math.floor(Math.random() * testTypes.length)];
    const priority = priorities[Math.floor(Math.random() * priorities.length)];
    const automated = automationStatus[Math.floor(Math.random() * automationStatus.length)];
    const tags = tagSets[Math.floor(Math.random() * tagSets.length)];
    const steps = stepTemplates[Math.floor(Math.random() * stepTemplates.length)];
    
    const estimate = Math.floor(Math.random() * 1800) + 120; // 2-32 minutes
    const forecast = Math.floor(estimate * (0.7 + Math.random() * 0.6)); // 70-130% of estimate
    
    const name = `${testType} - ${priority} Priority Test Case ${i.toString().padStart(4, '0')}`;
    
    csvContent += `"${name}","${folder}",${estimate},${forecast},${automated},"${tags}","${steps}"\n`;
  }

  // Write to file
  const outputPath = '/Users/bdermanouelian/git/testplanit/testplanit/test/large_import_test_cases.csv';
  writeFileSync(outputPath, csvContent);
  
  console.log(`✅ Generated large CSV file with 5,000 test cases at: ${outputPath}`);
  console.log(`📊 File size: ${(csvContent.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📁 Folders: ${folders.length} unique folder paths`);
  console.log(`🏷️  Tags: ${tagSets.length} different tag combinations`);
  console.log(`🤖 Automation: Mixed automated and manual test cases`);
};

generateLargeCSV();