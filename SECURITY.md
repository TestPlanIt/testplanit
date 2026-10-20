# Security Policy

## Supported Versions

Security fixes ship as patch releases of the latest stable minor version. They're also ported to the current beta line, so the next minor release includes them.

| Version                                                      | Supported          |
| ------------------------------------------------------------ | ------------------ |
| Latest stable minor (currently 1.1.x)                        | :white_check_mark: |
| Current beta line (currently 1.2 betas, from `release/v1.2`) | :white_check_mark: |
| Older minor versions                                         | :x:                |

Older minor versions don't receive fixes. Upgrade to the latest release to get them.

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, use [GitHub's private vulnerability reporting](https://github.com/testplanit/testplanit/security/advisories/new) or email [security@testplanit.com](mailto:security@testplanit.com).

Include:

- A description of the vulnerability
- Steps to reproduce
- The TestPlanIt version you tested, and whether it's self-hosted or testplanit.com
- Potential impact

### What to Expect

- **Initial response**: within 48 hours.
- **Fix**: confirmed vulnerabilities are fixed in a patch release of the latest stable version and ported to the current beta line.
- **Disclosure**: after the fix is released, we publish a [GitHub security advisory](https://github.com/testplanit/testplanit/security/advisories) that describes the issue and the affected and fixed versions, and we request a CVE for it.

## Staying Up to Date

Upgrades apply database migrations automatically and never drop data. Back up your database before upgrading anyway. See [Installation → Upgrading](https://docs.testplanit.com/docs/installation#upgrading).
