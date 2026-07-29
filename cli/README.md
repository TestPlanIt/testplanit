# @testplanit/cli

Command-line interface for TestPlanIt - import test results and manage test data.

## Supported Formats

The CLI supports importing test results from 7 different formats:

| Format | Description | File Extensions |
| -------- | ------------- | ----------------- |
| `junit` | JUnit XML | `.xml` |
| `testng` | TestNG XML | `.xml` |
| `xunit` | xUnit XML | `.xml` |
| `nunit` | NUnit XML | `.xml` |
| `mstest` | MSTest TRX | `.trx`, `.xml` |
| `mocha` | Mocha JSON | `.json` |
| `cucumber` | Cucumber JSON | `.json` |

The CLI can auto-detect the format based on file content, or you can specify it explicitly.

## Installation

### Standalone Binaries (Recommended)

Download the appropriate binary for your platform from the [CLI releases](https://github.com/testplanit/testplanit/releases?q=cli&expanded=true):

| Platform | Binary |
| ---------- | -------- |
| Linux (x64) | `testplanit-linux-x64` |
| macOS (Apple Silicon) | `testplanit-macos-arm64` |
| macOS (Intel) | `testplanit-macos-x64` |
| Windows (x64) | `testplanit-windows-x64.exe` |

**Linux / macOS:**

```bash
# Download (replace URL with actual release URL)
curl -L -o testplanit https://github.com/testplanit/testplanit/releases/latest/download/testplanit-linux-x64
chmod +x testplanit
sudo mv testplanit /usr/local/bin/
```

**Windows (PowerShell):**

```powershell
Invoke-WebRequest -Uri "https://github.com/testplanit/testplanit/releases/latest/download/testplanit-windows-x64.exe" -OutFile "testplanit.exe"
```

## Configuration

Before using the CLI, configure your TestPlanIt instance URL and API token:

```bash
# Set URL and token
testplanit config set --url https://your-testplanit-instance.com --token tpi_your_token

# View current configuration
testplanit config show

# Clear stored configuration
testplanit config clear
```

### Environment Variables

You can also use environment variables (they take precedence over stored config):

- `TESTPLANIT_URL` - TestPlanIt instance URL
- `TESTPLANIT_TOKEN` - API token (`TESTPLANIT_API_TOKEN`, the name the reporters
  use, is accepted as a fallback so a pipeline sets the token once)
- `TESTPLANIT_PROJECT_ID` - Default project for `run create`

```bash
TESTPLANIT_URL=https://testplanit.example.com TESTPLANIT_TOKEN=tpi_xxx testplanit import ...
```

## Commands

### Import Test Results

Import test results from various formats to create a test run:

```bash
testplanit import <files...> --project <id|name> --name <name> [options]
```

**Required:**

- `<files...>` - Test result files or glob patterns (e.g., `./results/*.xml`)
- `-p, --project <value>` - Project (ID or exact name)
- `-n, --name <name>` - Test run name

**Optional:**

- `-F, --format <format>` - File format: `auto`, `junit`, `testng`, `xunit`, `nunit`, `mstest`, `mocha`, `cucumber` (default: auto-detect)
- `-s, --state <value>` - Workflow state (ID or exact name)
- `-c, --config <value>` - Configuration (ID or exact name)
- `-m, --milestone <value>` - Milestone (ID or exact name)
- `-f, --folder <value>` - Parent folder for test cases (ID or exact name)
- `-t, --tags <values>` - Tags (comma-separated IDs or names; use quotes for names with commas)
- `-r, --test-run <value>` - Existing test run to append results (ID or exact name)
- `--case-matcher <mode>` - Link results to existing cases by ID: `off`, `name`, `property`, `auto` (default: `off`)
- `--case-id-format <preset>` - Case-ID pattern in the test name when matching by name: `brackets`, `c`, `tc` (default: `brackets`)

**Note:** For project, state, config, milestone, folder, and test run options, the CLI looks up entities by exact name match. If no match is found, an error is returned. For tags, if a tag name doesn't exist, it will be created automatically.

**Linking results to existing cases by ID:** By default a result is matched to a case by name and class name, so renaming a test creates a duplicate. With `--case-matcher`, a result instead links to an existing case by an ID in the test name (`--case-id-format`: `brackets` → `[123]`, `c` → `C123`, `tc` → `TC-123`) or a `test_id` / `testplanit_case_id` JUnit `<property>` (`property`/`auto`). Multiple IDs link one result to multiple cases; an ID not found in the project is skipped with a warning.

**Examples:**

```bash
# Import a single JUnit file (auto-detected)
testplanit import results.xml -p 1 -n "Build 123"

# Import with explicit format
testplanit import results.xml -p 1 -n "Build 123" -F junit

# Import TestNG results
testplanit import testng-results.xml -p 1 -n "TestNG Suite" -F testng

# Import Mocha JSON results
testplanit import mocha-report.json -p 1 -n "Mocha Tests" -F mocha

# Import Cucumber JSON results
testplanit import cucumber-report.json -p 1 -n "BDD Tests" -F cucumber

# Import multiple files with glob pattern
testplanit import "./test-results/*.xml" -p 1 -n "CI Build"

# Link results to existing cases by an ID in the test name (e.g. "[123] login")
testplanit import results.xml -p 1 -n "Build 123" --case-matcher name

# Link by a test_id property in the XML, falling back to the name pattern
testplanit import results.xml -p 1 -n "Build 123" --case-matcher auto

# Import with IDs
testplanit import results.xml \
  --project 1 \
  --name "Nightly Build" \
  --format junit \
  --state 5 \
  --config 2 \
  --milestone 3 \
  --folder 10 \
  --tags 1,2,3

# Import with names (exact match required)
testplanit import results.xml \
  --project "My Project" \
  --name "Nightly Build" \
  --state "In Progress" \
  --config "Chrome on Windows" \
  --milestone "Sprint 5" \
  --folder "API Tests" \
  --tags "regression,smoke,critical"

# Mix IDs and names
testplanit import results.xml -p 1 -n "Build 123" \
  --state "Completed" \
  --tags '1,"new tag",smoke'
```

### Pipeline-Owned Test Runs

A suite executed as several separate reporter invocations — shards across
agents or machines, or retry waves — creates one test run per invocation,
because each invocation only knows about itself. Create the run up front
instead, and every invocation attaches to it:

```bash
RUN_ID=$(testplanit run create --project "My Project" --name "Web Regression #984" --type MOCHA)
export TESTPLANIT_RUN_ID="$RUN_ID"

# Every shard, agent and retry wave reports into $TESTPLANIT_RUN_ID
npx playwright test --shard=1/5
npx playwright test --shard=2/5
# ...on other machines, plus any reruns...

testplanit run complete --id "$RUN_ID"
```

`run create` prints only the new run ID to stdout, so it is safe to capture in a
shell variable; progress messages go to stderr.

```bash
# Create with configuration, milestone and tags
testplanit run create -p 9 -n "Nightly" -T MOCHA -c "Chrome" -m "Sprint 1" -t "regression,ci"

# Complete it; the project is read from the run when --project is omitted
testplanit run complete --id 984
```

The [WebdriverIO](https://www.npmjs.com/package/@testplanit/wdio-reporter) and
[Playwright](https://www.npmjs.com/package/@testplanit/playwright-reporter)
reporters read `TESTPLANIT_RUN_ID` and attach to that run without creating or
completing it, so the pipeline owns the run's lifecycle end to end.

## CI/CD Integration

### GitHub Actions (Standalone Binary)

```yaml
- name: Download TestPlanIt CLI
  run: |
    curl -L -o testplanit https://github.com/testplanit/testplanit/releases/latest/download/testplanit-linux-x64
    chmod +x testplanit

- name: Import Test Results
  env:
    TESTPLANIT_URL: ${{ secrets.TESTPLANIT_URL }}
    TESTPLANIT_TOKEN: ${{ secrets.TESTPLANIT_TOKEN }}
  run: |
    ./testplanit import ./test-results/*.xml \
      --project-id 1 \
      --name "Build ${{ github.run_number }}"
```

### GitLab CI

```yaml
import-results:
  script:
    - curl -L -o testplanit https://github.com/testplanit/testplanit/releases/latest/download/testplanit-linux-x64
    - chmod +x testplanit
    - ./testplanit import ./test-results/*.xml -p 1 -n "Pipeline $CI_PIPELINE_ID"
  variables:
    TESTPLANIT_URL: $TESTPLANIT_URL
    TESTPLANIT_TOKEN: $TESTPLANIT_TOKEN
```

### Jenkins

```groovy
withCredentials([
  string(credentialsId: 'testplanit-url', variable: 'TESTPLANIT_URL'),
  string(credentialsId: 'testplanit-token', variable: 'TESTPLANIT_TOKEN')
]) {
  sh '''
    curl -L -o testplanit https://github.com/testplanit/testplanit/releases/latest/download/testplanit-linux-x64
    chmod +x testplanit
    ./testplanit import ./target/surefire-reports/*.xml -p 1 -n "Build ${BUILD_NUMBER}"
  '''
}
```

## Building from Source

Requires [Bun](https://bun.sh/) to build standalone binaries:

```bash
# Install dependencies
bun install

# Build for all platforms
bun run build:binaries

# Or build for specific platform
bun run build:linux
bun run build:macos-arm64
bun run build:macos-x64
bun run build:windows
```

Binaries will be output to the `releases/` directory.

## License

Apache-2.0
