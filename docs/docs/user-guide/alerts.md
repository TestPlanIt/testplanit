---
title: Alerts
sidebar_position: 12
description: Rules that watch a testing metric and notify their subscribers when it crosses a line you set
---

# Alerts

An alert watches one testing metric and tells its subscribers when the metric crosses a line you set, for example when a result takes 50% longer than the case usually does, when a case fails three times in a row, when a run's pass rate drops under 90%, or when a milestone is behind with three days to go.

Your alerts live in one place: the **Alerts** tab of the **Notifications & Alerts** page (in the user menu, in the bell panel's footer, and linked from your [profile](./user-profile.md)'s Preferences section). It is one table of every alert in your projects: an **Enabled** switch (live on the alerts you manage), a **Notify me** switch to follow or leave the alert, the project, the rule, its condition as a sentence, the scope, a subscriber count that opens the member list, and when it last fired. A **Description** column is available from the **Columns** control. The text filter matches rule, description, project, metric and scope; the **Enabled** and **Notify me** selects narrow the list to on or off; every column sorts and resizes. **Add Alert** creates your own, picking the project first. The page opens on the **Notifications** tab, which holds your notification mode and the per-type switches.

Alerts deliver through the ordinary [notification](./notifications.md) pipeline, so each subscriber receives them in the bell, by immediate email, or in the daily digest according to their own preference, and can switch the whole type off under **Alerts** on their profile.

## Who can do what

| Action                                            | Who                                                                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| See the alerts in a project                       | Anyone who can open the project                                                                            |
| Follow or leave an alert (**Notify me**)          | Anyone who can open the project                                                                            |
| Create alerts, and edit, pause or delete your own | Any role with **Add/Edit** on the **Alerts** [application area](./roles.md) (on for the default user role) |
| Edit, pause or delete anyone's alert              | [Project admins](./permissions-guide.md#project-admins)                                                    |
| Subscribe or unsubscribe _other_ members          | Project admins                                                                                             |

The person who creates an alert is subscribed to it automatically. Nobody is ever locked into an alert: the **Notify me** switch on the Notifications & Alerts page leaves it, and turns it back on.

## Metrics

Pick the metric first; the form then shows only the fields that metric uses and reads the condition back as a sentence.

### Result and case metrics

These evaluate every time a result is recorded on a case, manual or automated. Each rule chooses which results it watches (**Manual**, **Automated**, or both). Pass and fail come from the status flags, never from a status name, so renamed or custom statuses behave correctly.

| Metric                                     | Fires when                                                                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Result duration deviates from baseline** | The new result's elapsed time is more than X% above, below, or either side of the mean or median of the case's last Y results. Results with no elapsed time are ignored, and the rule waits until at least the minimum number of samples exist. |
| **Case regressed**                         | A case fails after passing every one of its last Y results.                                                                                                                                                                                     |
| **Consecutive failures**                   | A case has failed N times in a row (skipped or blocked results do not break the streak).                                                                                                                                                        |
| **Case became flaky**                      | The outcome flipped between pass and fail at least N times across the case's last Y results. Same inputs as the [Flaky Tests](./projects/reports/flaky-tests.md) report.                                                                        |

Scope a case metric to the whole project, to the cases in a folder (subfolders included), to the cases carrying a tag, or to one test case.

### Run metrics

These evaluate when a run completes, or, if the rule says **As results arrive**, on every result as well.

| Metric                            | Fires when                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Run pass rate below threshold** | Passed results divided by results with a pass or fail verdict is under X%, once at least N verdicts exist. |
| **Run failure count**             | More than N results in the run have failed.                                                                |

Scope a run metric to all runs, to runs carrying a tag, or to runs whose name contains a fragment such as `Nightly`.

### Milestone metrics

These are checked once a day.

| Metric                          | Fires when                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Milestone completion behind** | Fewer than X% of the run cases in the milestone's runs have a completed status with Y or fewer days left. |
| **Milestone overdue**           | The milestone's due date has passed and it is not completed.                                              |

Scope a milestone metric to all milestones in the project or to one milestone.

## Keeping rules quiet

- **Cooldown.** Once a rule fires for a subject (a case, a run, a milestone), it stays silent for that subject until the cooldown passes. The default is one day; set it to 0 to fire on every evaluation.
- **Minimum results.** Baseline metrics stay silent until the case has enough history.
- **Pause.** The **Enabled** switch on a rule stops evaluation without losing the rule or its audience. Pausing silences the rule for every subscriber, not just you, so the switch asks before it does; to stop your own notifications only, turn off **Notify me** instead.
- **Mute the type.** A user who wants none of them can switch **Alerts** off on their profile.

## History

Each rule's **History** lists its firings, newest first and loading more as you scroll: when, the subject with a link, the observed value against the threshold, who was notified (a count that opens the member list, recorded at the moment it fired), and whether a webhook event went out.

## Webhooks

Switch on **Send an alert.triggered webhook event** on a rule, then subscribe an outbound webhook to **Alerts** on the project's [Webhooks](./webhooks.md) page. The event carries the rule, the metric, the subject with a link, and the observed, baseline and threshold values, so Slack or any other endpoint can post it.

## How it works

Evaluation never runs in the request that records a result. Results and run changes queue a job for the alert worker, which reads the committed data, decides which rules fire, writes a history row, and hands the notifications to the notification worker. The daily milestone pass is a scheduled job. See [Background Processes](../background-processes.md).
