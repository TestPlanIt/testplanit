---
slug: multilingual-support
title: "TestPlanIt Now Speaks 13 Languages"
description: "v0.27.0 ships full UI localization in 13 languages, including German, Italian, Japanese, Korean, Chinese, and more — with a single source of truth that makes adding new languages straightforward."
authors: [bdermanouelian]
tags: [release, announcement]
---

Test management is a global discipline. Your QA team might be spread across São Paulo, Amsterdam, Warsaw, and Tokyo, and until now they've all been working in English whether they wanted to or not. That changes today.

TestPlanIt v0.27.0 ships full UI localization in **13 languages**.

<!-- truncate -->

## The Languages

The full list, in the language picker order you'll see in your profile:

| Language | Locale |
| --- | --- |
| Deutsch (German) | de-DE |
| English (US) | en-US |
| Español (Spanish) | es-ES |
| Français (French) | fr-FR |
| Italiano (Italian) | it-IT |
| Nederlands (Dutch) | nl-NL |
| Polski (Polish) | pl-PL |
| Português (Brazilian Portuguese) | pt-BR |
| Tiếng Việt (Vietnamese) | vi-VN |
| 中文（简体）(Chinese Simplified) | zh-CN |
| 中文（繁體）(Chinese Traditional) | zh-TW |
| 日本語 (Japanese) | ja-JP |
| 한국어 (Korean) | ko-KR |

## How It Works

Switch languages under **Profile → Preferences → Locale**. The entire UI — navigation, forms, tables, and notifications — updates to match your selected language.

Date format, time format, and timezone are separate preferences you control independently, so you can use German UI with US date formatting, or any other combination that fits how you work.

Translations are managed through [Crowdin](https://crowdin.com) using machine pre-translation as a baseline. The source strings are always English, and we use a Crowdin glossary to protect brand names and technical terms from being altered during translation.

## Contributing Translations

If you spot an awkward translation or want to improve coverage in your language, we welcome contributions through our [Crowdin project](https://crowdin.com/project/testplanit). No pull request needed — join the project directly and suggest improvements in the Crowdin editor.

If you'd like to see a language that isn't listed yet, open a GitHub issue and we'll add it to the Crowdin project.

## Upgrade to v0.27.0

Pull the latest, install, and build. No database migrations are required beyond what the standard upgrade process covers. Full upgrade steps are in the [upgrade guide](/docs/installation).

## Get Involved

- Star the repo on [GitHub](https://github.com/testplanit/testplanit)
- Follow [@TestPlanItHQ](https://x.com/TestPlanItHQ) for updates
- Join our [Community Discord](https://discord.gg/kpfha4W2JH)
- Report issues and suggest features on GitHub

Thank you for using TestPlanIt!
