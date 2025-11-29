---
sidebar_position: 18
title: Test Forecasting
---

# Test Forecasting

TestPlanIt provides time forecasting for test cases based on historical execution data. The system automatically calculates time estimates by averaging past execution results to help with planning and resource allocation.

## Overview

The forecasting system provides:

- **Historical data analysis** based on actual test execution times
- **Automatic time estimation** for manual and automated test cases
- **Milestone-level forecasting** by aggregating test run estimates
- **Background processing** for regular forecast updates
- **Real-time display** of forecasts throughout the application

## How Forecasting Works

### Data Collection

The system collects execution time data from:

**Manual Test Execution:**

- Execution times from `TestRunResults` when users manually execute test cases
- Duration tracking for each test case execution
- Historical data from all manual test runs

**Automated Test Execution:**

- Execution times from `JUnitTestResult` imports
- Duration data from automated test frameworks
- Historical data from CI/CD pipeline executions

### Forecast Calculation

**Statistical Averaging:**

- Calculates average execution time from historical data
- Separate forecasts for manual vs automated execution
- Filters out deleted or invalid results
- Only includes results with positive execution times

**Grouped Forecasting:**

- Test cases linked by `SAME_TEST_DIFFERENT_SOURCE` share forecast data
- Improves accuracy by using data from related test cases
- Reduces impact of limited historical data

**Forecast Types:**

- **Manual Forecast**: Average time for manual test execution
- **Automated Forecast**: Average time for automated test execution
- **Mixed Estimate**: Combined estimate when both types exist

### Background Processing

**Daily Updates:**

- Scheduled job runs at 3:00 AM to recalculate all forecasts
- Uses BullMQ with Valkey for reliable job processing
- Updates all active repository cases automatically

**On-Demand Updates:**

- API endpoint allows manual forecast recalculation
- Triggered when significant new execution data is available
- Cascade updates to test runs and milestones

## Accessing Forecasts

### Repository View

**Test Case Table:**

- Forecast column shows time estimates for each test case
- Cloud icon indicates manual forecasts
- Bot icon indicates automated forecasts
- Tooltips show human-readable durations

**Location:** Projects → Repository

### Test Run Management

**Test Run Creation:**

- Shows forecast totals when selecting test cases
- Helps estimate total execution time for test runs
- Updates dynamically as test cases are added/removed

**Test Run Details:**

- Individual test run forecast display
- Breakdown by manual vs automated estimates
- Progress tracking against forecasted time

**Location:** Projects → Test Runs

### Milestone Planning

**Milestone Forecasts:**

- Aggregated forecasts for all test runs in milestone
- Includes forecasts from descendant milestones
- Hierarchical time estimation for project planning

**Location:** Projects → Milestones

### Test Case Details

**Individual Forecasts:**

- Current forecast display for specific test cases
- Historical execution data visualization
- Manual vs automated forecast comparison

**Location:** Projects → Repository → Test Case Details

## Forecast Display

### Visual Indicators

**Icons:**

- Cloud Icon: Manual test execution forecast
- Bot Icon: Automated test execution forecast
- Mixed Icon: Combined manual and automated estimate

**Duration Format:**

- Human-readable time formats (e.g., "5 minutes", "2 hours")
- Tooltip details with exact values
- Color coding for different forecast types

### Information Display

**Forecast Components:**

- **Manual Estimate**: Time for manual execution
- **Automated Estimate**: Time for automated execution
- **Mixed Estimate**: Combined estimate when both exist
- **Automation Status**: Indicates if all cases are automated

## Configuration and Management

### Forecast Updates

**Automatic Updates:**

- Daily recalculation of all forecasts at 3:00 AM
- Triggered automatically when new execution data is available
- Background processing ensures minimal impact on performance

**Manual Updates:**

- Admin users can trigger forecast recalculation
- Useful after importing large amounts of historical data
- Available via API endpoints for integration

### Data Requirements

**Minimum Data:**

- At least one historical execution result
- Valid execution time (greater than 0)
- Non-deleted test results

**Data Quality:**

- More historical data improves forecast accuracy
- Consistent execution environments provide better estimates
- Regular execution provides up-to-date forecasts

## API Reference

### Get Repository Case Forecasts

```http
GET /api/repository-cases/forecast
```

Query Parameters:

- `projectId`: Project to get forecasts for
- `caseIds`: Array of specific case IDs (optional)

Response:

```json
{
  "forecasts": [
    {
      "caseId": "uuid",
      "manualEstimate": 300,
      "automatedEstimate": 60,
      "mixedEstimate": 180,
      "areAllCasesAutomated": false
    }
  ]
}
```

### Get Milestone Forecasts

```http
GET /api/milestones/{milestoneId}/forecast
```

Response:

```json
{
  "milestoneId": "uuid",
  "totalManualEstimate": 7200,
  "totalAutomatedEstimate": 1800,
  "totalMixedEstimate": 4500,
  "testRunCount": 5,
  "testCaseCount": 150
}
```

### Update Forecasts

```http
POST /api/forecast/update
Content-Type: application/json

{
  "caseIds": ["uuid1", "uuid2"],
  "updateAll": false
}
```

## Best Practices

### Data Management

**Consistent Execution:**

- Regular test execution provides better forecasts
- Maintain consistent test environments
- Clean up invalid or outlier results

**Historical Data:**

- Preserve historical execution data for accuracy
- Import existing execution data when setting up forecasts
- Regular data cleanup to remove obsolete results

### Planning Usage

**Time Estimation:**

- Use forecasts as starting estimates for planning
- Add buffer time for unforeseen issues
- Consider team experience and skill levels

**Resource Allocation:**

- Use milestone forecasts for high-level planning
- Combine with team capacity for realistic timelines
- Account for manual vs automated execution differences

### Forecast Accuracy

**Data Quality:**

- Ensure accurate time tracking during execution
- Record complete execution sessions
- Remove or adjust obvious outliers

**Regular Reviews:**

- Periodically review forecast accuracy
- Update estimates based on process changes
- Adjust for team productivity improvements

## Troubleshooting

### No Forecasts Available

**Issue:** Test cases show no forecast data

**Solutions:**

- Execute test cases to generate historical data
- Import historical execution results
- Check that execution times are being recorded correctly

### Inaccurate Forecasts

**Issue:** Forecasts don't match actual execution times

**Solutions:**

- Review historical execution data quality
- Check for execution environment changes
- Consider team skill level changes
- Trigger manual forecast recalculation

### Performance Issues

**Issue:** Forecast calculations are slow

**Solutions:**

- Check background job processing status
- Verify Valkey connectivity for job queue
- Review data volume and cleanup old results
- Monitor system resources during updates

## Limitations

### Current Scope

**Statistical Approach:**

- Simple averaging of historical execution times
- No advanced machine learning or predictive modeling
- No confidence intervals or uncertainty ranges

**Data Dependencies:**

- Requires historical execution data for accuracy
- Limited by quality and quantity of past results
- No prediction for entirely new test cases

### Future Enhancements

**Potential Improvements:**

- User-specific execution time patterns
- Environment-specific forecast adjustments
- Confidence intervals for forecast reliability
- Trend analysis for forecast accuracy improvement
