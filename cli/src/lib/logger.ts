/**
 * Logger Utilities
 *
 * Provides colored console output and progress spinners.
 */

import chalk from "chalk";
import ora, { type Ora } from "ora";

let currentSpinner: Ora | null = null;

/**
 * Log an info message
 */
export function info(message: string): void {
  console.log(chalk.blue("ℹ"), message);
}

/**
 * Log a success message
 */
export function success(message: string): void {
  console.log(chalk.green("✔"), message);
}

/**
 * Log a warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow("⚠"), message);
}

/**
 * Log an error message
 */
export function error(message: string): void {
  console.error(chalk.red("✖"), message);
}

/**
 * Log a debug message (only shown if DEBUG env var is set)
 */
export function debug(message: string): void {
  if (process.env.DEBUG) {
    console.log(chalk.gray("⊡"), chalk.gray(message));
  }
}

/**
 * Log a dimmed message (for secondary information)
 */
export function dim(message: string): void {
  console.log(chalk.dim(message));
}

/**
 * Start a progress spinner
 */
export function startSpinner(message: string): Ora {
  if (currentSpinner) {
    currentSpinner.stop();
  }
  currentSpinner = ora(message).start();
  return currentSpinner;
}

/**
 * Update the current spinner text
 */
export function updateSpinner(message: string): void {
  if (currentSpinner) {
    currentSpinner.text = message;
  }
}

/**
 * Mark the current spinner as successful
 */
export function succeedSpinner(message?: string): void {
  if (currentSpinner) {
    currentSpinner.succeed(message);
    currentSpinner = null;
  }
}

/**
 * Mark the current spinner as failed
 */
export function failSpinner(message?: string): void {
  if (currentSpinner) {
    currentSpinner.fail(message);
    currentSpinner = null;
  }
}

/**
 * Stop the current spinner without status change
 */
export function stopSpinner(): void {
  if (currentSpinner) {
    currentSpinner.stop();
    currentSpinner = null;
  }
}

/**
 * Format a URL for display
 */
export function formatUrl(url: string): string {
  return chalk.cyan.underline(url);
}

/**
 * Format a number for display
 */
export function formatNumber(num: number): string {
  return chalk.bold(num.toString());
}

/**
 * Format a token for display (masked)
 */
export function formatToken(token: string): string {
  if (token.length <= 8) {
    return chalk.dim("****");
  }
  return chalk.dim(token.substring(0, 8) + "..." + token.substring(token.length - 4));
}
