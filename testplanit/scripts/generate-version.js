const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get package version
const packageJson = require('../package.json');
const version = packageJson.version;

// Get git information
let gitCommit = 'unknown';
let gitBranch = 'unknown';
let gitTag = '';
let isTaggedRelease = false;
let buildDate = new Date().toISOString();

try {
  // Get short commit hash (7 characters like GitHub)
  gitCommit = execSync('git rev-parse --short=7 HEAD').toString().trim();
  gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

  // Try to get the exact tag for the current commit
  try {
    gitTag = execSync('git describe --exact-match --tags HEAD').toString().trim();
    // Check if this tag matches our version format
    isTaggedRelease = gitTag === `v${version}` || gitTag === version;
  } catch (e) {
    // Not on a tag, try to get the most recent tag for reference
    try {
      gitTag = execSync('git describe --tags --abbrev=0').toString().trim();
    } catch (e2) {
      // No tags found at all, that's okay
      gitTag = '';
    }
  }
} catch (error) {
  console.warn('Git information not available:', error.message);
}

// Determine environment based on various factors
let environment = process.env.NODE_ENV || 'development';
if (process.env.VERCEL) {
  environment = 'production';
} else if (process.env.CI) {
  environment = 'ci';
}

// Create version info object
const versionInfo = {
  version,
  gitCommit,
  gitBranch,
  gitTag,
  buildDate,
  environment,
  isTaggedRelease
};

// Write to appropriate .env file based on environment
const envContent = `# Auto-generated version information
# Generated at: ${buildDate}
NEXT_PUBLIC_APP_VERSION=${version}
NEXT_PUBLIC_GIT_COMMIT=${gitCommit}
NEXT_PUBLIC_GIT_BRANCH=${gitBranch}
NEXT_PUBLIC_GIT_TAG=${gitTag}
NEXT_PUBLIC_BUILD_DATE=${buildDate}
`;

// Determine which env file to write to
let envFileName = '.env.production.local';
if (environment === 'development') {
  envFileName = '.env.development.local';
}

const envPath = path.join(__dirname, '..', envFileName);
try {
  fs.writeFileSync(envPath, envContent);
} catch (error) {
  console.warn(`Could not write to ${envFileName}, skipping (this is normal in Docker builds):`, error.message);
}

// Also write a version.json file for reference
const versionJsonPath = path.join(__dirname, '..', 'public', 'version.json');
// Ensure public directory exists
const publicDir = path.join(__dirname, '..', 'public');
try {
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionInfo, null, 2));
} catch (error) {
  console.warn(`Could not write version.json, skipping (this is normal in Docker builds):`, error.message);
}

console.log('Version information generated:');
console.log(`  Version: ${version}`);
console.log(`  Commit: ${gitCommit}`);
console.log(`  Branch: ${gitBranch}`);
console.log(`  Tag: ${gitTag || 'none'}`);
console.log(`  Tagged Release: ${isTaggedRelease}`);
console.log(`  Environment: ${environment}`);
console.log(`  Written to: ${envFileName} and public/version.json`);
