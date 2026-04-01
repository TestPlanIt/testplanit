---
slug: gitea-support-ssrf-hardening
title: "Self-Hosted Git Support with Gitea, Forgejo, and Gogs"
description: "TestPlanIt v0.19.0 adds Gitea as a code repository provider for QuickScript, bringing self-hosted Git server support alongside security hardening for all providers."
authors: [bdermanouelian]
tags: [release, announcement]
---

TestPlanIt v0.19.0 adds support for self-hosted Git servers — connecting your own Gitea, Forgejo, or Gogs instance as a code repository for AI-powered QuickScript generation.

<!-- truncate -->

## Why Self-Hosted Git Matters

Not every team uses GitHub or GitLab. Many organizations run self-hosted Git servers for compliance, data sovereignty, or simply because they prefer the control. Until now, QuickScript's code context feature — which reads your actual project code to generate automation scripts that follow your real patterns — only worked with cloud-hosted providers.

This change is part of our [Privacy First](https://www.testplanit.com/privacy-first) initiative. TestPlanIt already supports self-hosted LLMs via Ollama and local deployments — adding self-hosted Git support means you can now run the full AI pipeline (code context, test generation, QuickScript) without a single request leaving your network.

v0.19.0 closes the last gap.

## Gitea, Forgejo, and Gogs

The new **Gitea** provider works with any Git server that implements the Gitea-compatible `/api/v1/` REST API. That includes:

- **[Gitea](https://gitea.io)** — Lightweight, self-hosted Git service
- **[Forgejo](https://forgejo.org)** — Community-driven Gitea fork
- **[Gogs](https://gogs.io)** — Minimal self-hosted Git service

All three share the same API surface, so a single provider covers them all. Other servers with a Gitea-compatible API will work on a best-effort basis.

### Setup

Connect your server from **Admin > Code Repositories**:

1. Select **Gitea** as the provider
2. Enter your server URL (e.g., `https://git.yourcompany.com`)
3. Add a Personal Access Token with read access to the repository
4. Specify the repository owner and name

Once connected, QuickScript will pull your project's file tree and source code to generate context-aware automation scripts — the same experience you get with GitHub, GitLab, Bitbucket, or Azure DevOps.

## SSRF Security Hardening

Alongside the new provider, v0.19.0 hardens Server-Side Request Forgery (SSRF) protections across **all** code repository providers — not just Gitea.

**DNS resolution validation** — Before every outbound request, TestPlanIt resolves the target hostname and verifies the IP address is not in a private range. This closes the DNS rebinding attack vector where a public hostname resolves to an internal IP (e.g., a domain pointing to `169.254.169.254` to reach cloud metadata services).

**Redirect protection** — All provider requests now use manual redirect handling. When a server returns a redirect, TestPlanIt validates the `Location` URL through the same SSRF checks before following it. No more open redirect chains into internal networks.

**Expanded blocked ranges** — IPv6 link-local addresses (`fe80::`) are now blocked alongside existing IPv4 private ranges.

**HTTP warning** — The admin UI shows a warning when a provider URL uses `http://` instead of `https://`, encouraging encrypted connections for token-bearing requests.

These protections apply to GitHub, GitLab, Bitbucket, Azure DevOps, and Gitea equally.

## Try It Out

If you run a self-hosted Git server, connect it from Admin > Code Repositories and let QuickScript read your real code. [Let us know how it works](https://github.com/testplanit/testplanit/discussions).
