/**
 * Utility functions for email configuration
 */

/**
 * Checks if all required email server environment variables are configured
 * @returns true if email server is fully configured, false otherwise
 */
export function isEmailServerConfigured(): boolean {
  return !!(
    process.env.EMAIL_SERVER_HOST &&
    process.env.EMAIL_SERVER_PORT &&
    process.env.EMAIL_SERVER_USER &&
    process.env.EMAIL_SERVER_PASSWORD &&
    process.env.EMAIL_FROM
  );
}
