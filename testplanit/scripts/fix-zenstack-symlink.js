#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Fix ZenStack enhance function symlink for pnpm workspaces
 *
 * This script creates the necessary symlink so that @zenstackhq/runtime
 * can find the generated enhance.js file in pnpm workspace setups.
 *
 * The issue: ZenStack generates files to node_modules/.zenstack/enhance.js
 * but @zenstackhq/runtime looks for .zenstack/enhance.js relative to its own directory.
 *
 * The fix: Create a symlink from the runtime package directory to the generated files.
 */

console.log('🔧 Fixing ZenStack symlink for pnpm workspace...');

try {
  // Find the @zenstackhq/runtime directory
  const runtimePath = path.dirname(require.resolve('@zenstackhq/runtime/package.json'));
  const symlinkPath = path.join(runtimePath, '.zenstack');

  console.log(`   Runtime package found at: ${runtimePath}`);

  // Remove existing symlink if it exists
  if (fs.existsSync(symlinkPath)) {
    console.log('   Removing existing .zenstack symlink...');
    fs.unlinkSync(symlinkPath);
  }

  // Find the generated .zenstack directory
  let zenstackDir;

  // The generated files are in the same pnpm directory structure as the runtime
  // Look for a .zenstack directory at the same level as the runtime package
  const pnpmRuntimeDir = path.dirname(path.dirname(runtimePath)); // Go up two levels from @zenstackhq/runtime
  const pnpmZenstackDir = path.join(pnpmRuntimeDir, '.zenstack');

  if (fs.existsSync(pnpmZenstackDir)) {
    // Use relative path from runtime directory to the pnpm .zenstack directory
    const relativePath = path.relative(runtimePath, pnpmZenstackDir);
    zenstackDir = relativePath;
    console.log(`   Found generated files at: ${pnpmZenstackDir}`);
    console.log(`   Creating symlink with relative path: ${relativePath}`);
  } else {
    console.log('   Warning: Generated .zenstack directory not found.');
    console.log('   Expected location:', pnpmZenstackDir);
    console.log('   This might be normal if zenstack generate hasn\'t been run yet.');
    process.exit(0);
  }

  // Create the symlink
  fs.symlinkSync(zenstackDir, symlinkPath, 'dir');
  console.log(`   ✅ Successfully created symlink: ${symlinkPath} -> ${zenstackDir}`);

  // Also copy files directly for build compatibility
  const sourceZenstackDir = path.resolve(runtimePath, zenstackDir);
  const enhanceFile = path.join(symlinkPath, 'enhance.js');
  const enhanceEdgeFile = path.join(symlinkPath, 'enhance-edge.js');

  // Copy all zenstack files directly to runtime directory for build compatibility
  const filesToCopy = ['enhance.js', 'enhance-edge.js', 'policy.js', 'model-meta.js', 'models.js'];

  try {
    let copiedCount = 0;
    for (const fileName of filesToCopy) {
      const sourceFile = path.join(sourceZenstackDir, fileName);
      const targetFile = path.join(runtimePath, fileName);

      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, targetFile);
        copiedCount++;
      }
    }
    console.log(`   ✅ Copied ${copiedCount} zenstack files to runtime directory`);
  } catch (copyError) {
    console.log('   ⚠️  Warning: Could not copy zenstack files:', copyError.message);
  }

  // Verify the symlink works
  if (fs.existsSync(enhanceFile)) {
    console.log('   ✅ Symlink verified: enhance.js is accessible');
  } else {
    console.log('   ⚠️  Warning: enhance.js not found through symlink');
  }

  // Verify direct files exist
  const runtimeEnhanceFile = path.join(runtimePath, 'enhance.js');
  if (fs.existsSync(runtimeEnhanceFile)) {
    console.log('   ✅ Direct copy verified: enhance.js in runtime directory');
  }

} catch (error) {
  console.error('   ❌ Error fixing ZenStack symlink:', error.message);
  // Don't fail the install process - just warn
  console.log('   This may cause "enhance function not found" errors at runtime.');
  process.exit(0);
}

console.log('🎉 ZenStack symlink fix completed!');
