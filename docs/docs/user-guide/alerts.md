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

The person who creates an alert is added to its audience by default and can remove themselves before saving. Nobody is ever locked into an alert: the **Notify me** switch on the Notifications & Alerts page leaves it, and turns it back on.

## Metrics

Pick the metric first; the form then shows only the fields that metric uses and reads the condition back as a sentence.

### Result and case metrics

These evaluate every time a result is recorded on a case, manual or automated. Each rule chooses which results it watches (**Manual**, **Automated**, or both). Pass and fail come from the status flags, never from a status name, so renamed or custom statuses behave correctly.

| Metric                                     | Fires when                                                                                                                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Result duration deviates from baseline** | The new result's elapsed time is more than X% above, below, or either side of the mean or median of the case's last Y results. Results with no elapsed time are ignored, and the rule waits until at least the minimum number of samples exist. |
| **Case regressed**                         | A case fails after passing every one of its last Y results.                                                                                                                                                                                     |
| **Case recovered**                         | A case passes after failing every one of its last Y results.                                                                                                                                                                                    |
| **Consecutive failures**                   | A case has failed N times in a row (skipped or blocked results do not break the streak).                                                                                                                                                        |
| **Case became flaky**                      | The outcome flipped between pass and fail at least N times across the case's last Y results. Same inputs as the [Flaky Tests](./projects/reports/flaky-tests.md) report.                                                                        |

Scope a case metric to the whole project, to the cases in a folder (subfolders included), to the cases carrying a tag, or to one test case.

### Run metrics

These evaluate when a run completes, or, if the rule says **As results arrive**, on every result as well. Two are checked on a schedule instead.

| Metric                                  | Fires when                                                                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Run pass rate below threshold**       | Passed results divided by results with a pass or fail verdict is under X%, once at least N verdicts exist.                                                                                                     |
| **Run failure count**                   | More than N results in the run have failed.                                                                                                                                                                    |
| **Run duration deviates from baseline** | A completed run's total duration is more than X% above, below, or either side of the mean or median of the last Y completed runs its scope groups together (the same tag or name fragment, or every run). |
| **Run not progressing**                 | An open run with at least one result has had no new result for more than X hours. Checked hourly.                                                                                                              |
| **Automated execution failed**          | An automated execution of a run fails, cannot be dispatched, or times out.                                                                                                                                     |
| **Run untested share**                  | More than X% of a run's cases still have no result with Y or fewer days left before the run's milestone is due. Checked daily.                                                                                 |
| **Issues opened from a run**            | More than N issues are linked to the run's results.                                                                                                                                                            |

Scope a run metric to all runs, to runs carrying a tag, or to runs whose name contains a fragment such as `Nightly`.

### Session metrics

| Metric                           | Fires when                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| **Session overran its estimate** | A session is completed with an elapsed time more than X% over its estimate.                 |

Scope a session metric to all sessions or to sessions carrying a tag.

### Milestone metrics

These are checked once a day.

| Metric                          | Fires when                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Milestone completion behind** | Fewer than X% of the run cases in the milestone's runs have a completed status with Y or fewer days left. |
| **Milestone overdue**           | The milestone's due date has passed and it is not completed.                                              |

Scope a milestone metric to all milestones in the project or to one milestone.

### Project health metrics

These are checked once a day and fire for the project itself.

| Metric                                    | Fires when                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requirement coverage below threshold**  | Fewer than X% of the project's requirements count as covered. **Count as covered** picks the basis: linked to at least one test case, or a passing latest result. |
| **Stale cases**                           | More than N cases, older than Y days, have had no result (manual or automated) in the last Y days.                                             |
| **Automation share below threshold**      | Fewer than X% of the cases in scope are automated.                                                                                             |

Stale cases and automation share can be scoped to the whole project, a folder (subfolders included), or a tag.

### Webhook metrics

| Metric                   | Fires when                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Webhook failure rate** | More than X% of an outbound webhook's last N deliveries failed, once at least M deliveries exist. Checked hourly. |

Scope it to every active outbound webhook in the project or to one webhook.

### System alerts: AI budget

A system alert belongs to no project. It watches something administered for the whole installation, so only [administrators](./permissions-guide.md) see, create and follow it: choose **System** instead of a project in **Add Alert**, and the metric list narrows to the system metrics. The Project column reads **System**, the audience can only hold administrators, and no webhook event is sent (outbound webhooks belong to projects).

| Metric             | Fires when                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI budget used** | An [AI model integration](./llm-integrations.md)'s spend for its billing period reaches X% of its **Monthly Budget**. Evaluated each time the integration records usage, and fires once per billing period for each integration. Saving the integration or using **Reset Spend** lets it fire again in the same period. |

Scope it to every AI model integration or to one integration. Integrations without a budget never fire. Installations that already had a budget when they upgraded start with three such alerts, at 80%, 90% and 100%, subscribed by every administrator; edit or delete them like any other alert.

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

Evaluation never runs in the request that records a result. Results, run completion, finished automated executions and completed sessions queue a job for the alert worker, which reads the committed data, decides which rules fire, writes a history row, and hands the notifications to the notification worker. Milestone, project health and untested-share metrics run in a daily scheduled job; stalled runs and webhook failure rates in an hourly one. AI usage queues a job for the budget alert worker, which evaluates the AI budget alerts the same way. See [Background Processes](../background-processes.md).
