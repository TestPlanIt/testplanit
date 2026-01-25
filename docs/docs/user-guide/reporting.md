---
sidebar_position: 17
title: Reporting & Analytics
---

# Reporting & Analytics

TestPlanIt provides comprehensive reporting and analytics capabilities to help you track testing progress, analyze team performance, and make data-driven decisions about your test management processes.

## Overview

The reporting system offers:

- **Custom report builder** with drag-and-drop interface
- **Multiple chart types** for data visualization
- **Cross-project analytics** for portfolio insights
- **Real-time dashboards** with live data updates
- **Scheduled reports** with automated delivery
- **Export capabilities** in multiple formats

## Report Types

### Pre-Built Reports

TestPlanIt includes specialized pre-built reports that provide immediate insights without configuration:

#### Automation Trends

Tracks test automation coverage and adoption over time. Monitor your automation initiative progress and identify areas needing automation investment.

#### Flaky Tests

Identifies tests with inconsistent pass/fail results. Helps improve test reliability and CI/CD stability by highlighting tests that may need maintenance.

#### Test Case Health

Analyzes test case execution frequency and recency. Identifies stale or abandoned tests to help maintain a clean and effective test repository.

#### Issue Test Coverage

Shows test coverage for issues tracked in integrated systems (Jira, GitHub, Azure DevOps). Track testing progress for issues and ensure critical items have adequate test coverage.

### Custom Reports

You can build custom reports using the Report Builder for specific analytical needs beyond the pre-built reports.

## Sharing Reports

Share your reports with team members, clients, and stakeholders using Share Links - secure, customizable URLs with flexible access control.

### Quick Start

1. **Configure your report** in Report Builder
2. Click the **Share** button in the toolbar
3. Choose an **access mode** (Public, Password-Protected, or Authenticated)
4. Configure share settings (title, expiration, password, notifications)
5. **Copy the link** and share via email or other channels

### Share Modes

**Public**: No authentication required - accessible to anyone with the link

- Use for: Public dashboards, marketing reports, non-sensitive data

**Password-Protected**: Public access with password requirement

- Use for: Client reports, partner collaboration, confidential sharing

**Authenticated**: Requires login with project access

- Use for: Team members, internal reports, sensitive data

### Common Use Cases

- **Client Reporting**: Share test results with clients using password-protected links
- **Stakeholder Updates**: Distribute weekly/monthly reports with expiration dates
- **Public Dashboards**: Share metrics openly for transparency
- **Team Collaboration**: Share reports with team members who have project access

### Features

- Three access modes for different security needs
- Customizable expiration dates for time-limited access
- Password protection with rate limiting
- View notifications when links are accessed
- Access analytics with detailed logs
- Link management to revoke or modify shares
- Minimal public UI (no navigation for external viewers)
- Read-only report views optimized for sharing

[Learn more about Share Links →](./share-links.md)

### Test Execution Reports

**Test Run Progress:**

- Execution status distribution (Passed, Failed, Blocked, Skipped)
- Completion rates over time
- Average execution time trends
- Test case failure patterns

**Test Case Analytics:**

- Test case creation and modification trends
- Automation coverage analysis
- Test case complexity metrics
- Repository growth patterns

**Quality Metrics:**

- Defect detection rates
- Test effectiveness measurements
- Coverage analysis by feature/module
- Regression testing insights

### Project Management Reports

**Milestone Progress:**

- Milestone completion tracking
- Schedule adherence analysis
- Resource allocation effectiveness
- Project timeline visualization

**Team Performance:**

- Individual and team productivity metrics
- Test execution velocity
- Issue resolution rates
- Collaboration patterns

**Resource Utilization:**

- Testing effort distribution
- Capacity planning insights
- Skill utilization analysis
- Workload balancing metrics

### Business Intelligence

**Executive Dashboards:**

- High-level KPI summaries
- Cross-project comparisons
- Trend analysis and forecasting
- ROI and efficiency metrics

**Compliance Reports:**

- Audit trail documentation
- Regulatory requirement tracking
- Process adherence monitoring
- Quality assurance metrics

## Report Builder

### Accessing the Report Builder

1. Navigate to **Admin** section
2. Click **Reports** in the sidebar
3. Click **Create New Report** or **Report Builder**

### Building Custom Reports

#### 1. Data Source Selection

Choose your primary data source:

- **Test Cases**: Repository data and metadata
- **Test Runs**: Execution results and performance
- **Sessions**: Exploratory testing data
- **Issues**: Bug tracking and resolution
- **Projects**: Project-level metrics
- **Users**: Team performance data

#### 2. Dimension Configuration

Select dimensions for data analysis:

**Time Dimensions:**

- Created Date, Updated Date, Completed Date
- Week, Month, Quarter, Year groupings
- Custom date ranges and periods

**Categorical Dimensions:**

- Project, Folder, Template
- Tags, Priority, Severity
- Assigned User, Created By
- Status, State, Configuration

**Custom Dimensions:**

- Custom field values
- Calculated fields
- Derived metrics

#### 3. Metric Selection

Choose metrics to measure:

**Count Metrics:**

- Total count, Unique count
- Running totals, Cumulative sums
- Percentage distributions

**Time Metrics:**

- Average duration, Total time
- Time to completion
- Average elapsed time (test execution)
- Total elapsed time (test execution)

**Quality Metrics:**

- Pass/fail rates, Success ratios
- Defect density, Error rates
- Coverage percentages

#### 4. Visualization Options

Select appropriate chart types:

**Bar Charts:**

- Horizontal and vertical bars
- Stacked and grouped bars
- Comparison and trend analysis

**Line Charts:**

- Trend lines over time
- Multiple series comparison
- Forecast projections

**Pie Charts:**

- Distribution analysis
- Category breakdowns
- Proportion visualization

**Tables:**

- Detailed data views
- Sortable columns
- Summary statistics

**Advanced Charts:**

- Scatter plots for correlation
- Heat maps for intensity
- Gantt charts for timelines
- Funnel charts for processes

## Interactive Drill-Down

The drill-down feature transforms reports from static summaries into interactive exploration tools, allowing you to investigate the detailed records behind any metric.

### How Drill-Down Works

1. **Click Any Metric** - Click on any metric value in a report table to view the underlying records
2. **Automatic Context** - All relevant filters are automatically applied (dimensions, date ranges, project scope)
3. **View Details** - See comprehensive information about each record in a formatted table
4. **Export Data** - Download all matching records as CSV for further analysis

### What You Can Drill Into

**Test Execution Metrics:**

- Test Results count - View individual test executions with details
- Pass Rate - See pass/fail breakdown with status distribution
- Average Elapsed Time - View test executions with their durations
- Total Elapsed Time - See all executions contributing to the total

**Test Case Metrics:**

- Test Case Count - View repository cases with metadata
- Automated/Manual Counts - See breakdown by automation status
- Average Steps - View test cases with step counts
- Automation Rate - See which cases are automated vs manual

**Test Run Metrics:**

- Test Run Count - View runs with status and progress
- Milestone Test Cases - See cases included in milestone runs

**Session Metrics:**

- Session Count - View exploratory testing sessions
- Session Duration - See sessions with time spent
- Session Results - View findings and outcomes

**Other Metrics:**

- User activity metrics
- Milestone progress details
- Issue counts and details
- Cross-project aggregations

### Drill-Down Interface

When you click a metric, a drawer slides in from the right showing:

**Header:**

- Metric name being explored
- Applied filters summary (dimension values, dates)
- Total record count
- For pass rates: status breakdown with colored indicators and calculated percentage
- Export to CSV button

**Content:**

- Table with relevant columns for the metric type
- Clickable links to view individual records in detail
- Formatted dates, times, and statuses
- Color-coded status indicators
- Infinite scroll for large result sets

**Navigation:**

- Scroll to load more records (50 at a time)
- Click record links to open in new context
- Close drawer to return to report

### Tips for Using Drill-Down

1. **Investigate Anomalies** - Click unusual values to understand what's driving them
2. **Verify Data** - Confirm the records behind any metric match your expectations
3. **Export for Analysis** - Download filtered data for deeper analysis in spreadsheets
4. **Understand Trends** - Click time-series data points to see what happened on specific dates
5. **Track Individual Items** - Find specific test cases, runs, or sessions contributing to totals

### Report Configuration

#### Filters and Parameters

**Static Filters:**

- Fixed criteria applied to all report views
- Date ranges, project selections
- Status and category filters

**Dynamic Parameters:**

- User-configurable options
- Interactive filtering
- Drill-down to detailed records (see [Interactive Drill-Down](#interactive-drill-down))

**Conditional Logic:**

- IF/THEN statements for complex filtering
- Multi-condition expressions
- Dynamic field calculations

#### Formatting Options

**Visual Styling:**

- Colors and themes
- Font sizes and styles
- Layout and spacing

**Data Formatting:**

- Number formats and precision
- Date format preferences
- Currency and percentage displays

**Responsive Design:**

- Mobile-friendly layouts
- Adaptive chart sizing
- Print-optimized formatting

## Dashboards

### Pre-built Dashboards

**Executive Dashboard:**

- Key performance indicators
- Project health summaries
- Resource utilization overview
- Trend analysis widgets

**Project Manager Dashboard:**

- Project-specific metrics
- Team performance indicators
- Milestone progress tracking
- Risk and issue monitoring

**Test Manager Dashboard:**

- Test execution status
- Quality metrics overview
- Automation coverage
- Defect trend analysis

**Team Lead Dashboard:**

- Individual performance metrics
- Workload distribution
- Productivity indicators
- Skill development tracking

### Custom Dashboards

#### Creating Dashboards

1. **Layout Design**
   - Grid-based positioning
   - Responsive sizing
   - Widget arrangement

2. **Widget Selection**
   - Choose from available reports
   - Configure display options
   - Set refresh intervals

3. **Interactive Features**
   - Click-through navigation
   - Filter synchronization
   - Real-time updates

#### Dashboard Sharing

**Access Control:**

- Role-based permissions
- User-specific views
- Project-level restrictions

**Distribution:**

- Direct URL sharing
- Email subscriptions
- Embedded displays

### Real-time Updates

**Live Data Refresh:**

- Automatic data updates
- Configurable refresh intervals
- Real-time notifications

**Push Notifications:**

- Threshold-based alerts
- Significant change notifications
- Critical issue warnings

## Scheduled Reports

### Report Automation

**Schedule Configuration:**

- Daily, weekly, monthly schedules
- Custom cron expressions
- Time zone handling

**Delivery Options:**

- Email distribution lists
- Shared folder exports
- API endpoint delivery

**Format Selection:**

- PDF reports for presentations
- Excel files for analysis
- CSV data for import

### Email Reports

**Template Customization:**

- Report layout and styling
- Company branding
- Custom messaging

**Recipient Management:**

- Distribution lists
- Role-based recipients
- Conditional delivery

**Content Options:**

- Summary highlights
- Full report attachments
- Dashboard screenshots

## Analytics Features

### Trend Analysis

**Statistical Analysis:**

- Moving averages
- Regression analysis
- Correlation studies
- Variance analysis

**Forecasting:**

- Predictive modeling
- Trend extrapolation
- Confidence intervals
- Scenario planning

### Comparative Analysis

**Benchmarking:**

- Project comparisons
- Team performance analysis
- Historical comparisons
- Industry benchmarks

**Cohort Analysis:**

- User behavior tracking
- Feature adoption rates
- Performance cohorts
- Retention analysis

### Advanced Analytics

**Machine Learning Integration:**

- Anomaly detection
- Pattern recognition
- Predictive analytics
- Risk assessment

**Statistical Functions:**

- Standard deviation
- Percentile calculations
- Z-score analysis
- Confidence testing

## Export and Integration

### Export Formats

**PDF Export:**

- Print-ready layouts
- Professional formatting
- Embedded charts and images
- Multi-page reports

**Excel Export:**

- Raw data access
- Pivot table creation
- Chart preservation
- Formula compatibility

**CSV Export:**

- Data analysis integration
- Import into other tools
- Bulk data processing
- Custom formatting

**Image Export:**

- Chart and dashboard screenshots
- High-resolution images
- Multiple format options
- Sharing and presentation

### API Integration

**Report API:**

- Programmatic report generation
- Data extraction endpoints
- Custom integrations
- Automated workflows

**Webhook Integration:**

- Real-time data delivery
- Event-driven reporting
- External system updates
- Automated notifications

## Performance Optimization

### Query Optimization

**Data Indexing:**

- Optimized database queries
- Cached results
- Incremental updates
- Parallel processing

**Aggregation Strategies:**

- Pre-calculated summaries
- Materialized views
- Efficient grouping
- Memory optimization

### Caching and Storage

**Report Caching:**

- Temporary result storage
- Configurable cache duration
- Automatic cache invalidation
- Memory management

**Data Warehousing:**

- Historical data preservation
- Aggregated data storage
- ETL processes
- Data archival

## Best Practices

### Report Design

1. **Clear Objectives**: Define specific goals for each report
2. **Audience Focus**: Design for the intended users
3. **Visual Hierarchy**: Use appropriate chart types and layouts
4. **Data Accuracy**: Ensure data quality and validation
5. **Performance**: Optimize for fast loading times

### Dashboard Strategy

1. **Information Architecture**: Organize related metrics together
2. **Progressive Disclosure**: Start with high-level, drill down to details
3. **Consistent Design**: Maintain visual consistency across dashboards
4. **Mobile Consideration**: Ensure mobile-friendly layouts
5. **Regular Review**: Update dashboards based on user feedback

### Analytics Approach

1. **Data Governance**: Establish data quality standards
2. **Metric Definitions**: Clearly define calculation methods
3. **Historical Tracking**: Maintain consistent metrics over time
4. **Actionable Insights**: Focus on metrics that drive decisions
5. **Continuous Improvement**: Regularly review and refine reports

## Troubleshooting

### Common Issues

**Slow Report Performance:**

- Check data volume and complexity
- Optimize filters and queries
- Consider data aggregation
- Review database indexing

**Incorrect Data:**

- Verify data source configuration
- Check filter settings
- Validate calculation logic
- Review data refresh status

**Formatting Problems:**

- Check browser compatibility
- Verify responsive design
- Test print layouts
- Validate export formats

### Resolution Steps

1. **Performance Monitoring**: Track report execution times
2. **Error Logging**: Monitor report generation errors
3. **User Feedback**: Collect usage feedback and issues
4. **Regular Maintenance**: Update and optimize reports
5. **Documentation**: Maintain report documentation and usage guides

## API Reference

### Generate Report

```http
POST /api/reports/generate
Content-Type: application/json

{
  "reportId": "uuid",
  "parameters": {
    "projectId": "project-uuid",
    "dateRange": {
      "from": "2024-01-01",
      "to": "2024-12-31"
    }
  },
  "format": "pdf"
}
```

### Get Dashboard Data

```http
GET /api/dashboards/{dashboardId}/data?refresh=true
```

### Schedule Report

```http
POST /api/reports/{reportId}/schedule
Content-Type: application/json

{
  "schedule": "0 8 * * 1",
  "recipients": ["user1@example.com", "user2@example.com"],
  "format": "pdf",
  "parameters": {
    "projectId": "uuid"
  }
}
```