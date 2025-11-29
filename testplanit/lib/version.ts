// This file provides version information for the application
// The version.json file is generated at build time by scripts/generate-version.js

export interface VersionInfo {
  version: string;
  gitCommit: string;
  gitBranch: string;
  gitTag: string;
  buildDate: string;
  environment: string;
}

// Default version info for development
// This will be overridden by generated version data in production
const versionInfo: VersionInfo = {
  version: process.env.NEXT_PUBLIC_APP_VERSION || "0.2.0",
  gitCommit: process.env.NEXT_PUBLIC_GIT_COMMIT || "development",
  gitBranch: process.env.NEXT_PUBLIC_GIT_BRANCH || "development",
  gitTag: process.env.NEXT_PUBLIC_GIT_TAG || "",
  buildDate: process.env.NEXT_PUBLIC_BUILD_DATE || new Date().toISOString(),
  environment: process.env.NODE_ENV || "development",
};

export function getVersionInfo(): VersionInfo {
  return versionInfo;
}

export function getVersionString(): string {
  const { version, gitCommit, gitTag, environment } = versionInfo;

  // If we have a git tag that matches the version, we're on a release
  if (gitTag && gitTag === `v${version}`) {
    // For tagged releases, show clean version with short commit hash if available
    if (gitCommit && gitCommit !== "development" && gitCommit !== "unknown") {
      return `v${version} (${gitCommit})`;
    }
    return `v${version}`;
  }

  // For development or non-tagged builds
  if (environment === "development") {
    // Only show commit hash if it's a real hash
    if (gitCommit && gitCommit !== "development" && gitCommit !== "unknown") {
      return `v${version}-development (${gitCommit})`;
    }
    return `v${version}-development`;
  }

  // For production builds without matching tag (e.g., deployments from branches)
  // Only show commit hash if it's a real hash
  if (gitCommit && gitCommit !== "development" && gitCommit !== "unknown") {
    return `v${version} (${gitCommit})`;
  }
  return `v${version}`;
}

export function getFullVersionString(): string {
  const { version, gitCommit, gitBranch, buildDate } = versionInfo;
  return `v${version} (${gitBranch}@${gitCommit}) built on ${new Date(buildDate).toLocaleDateString()}`;
}
