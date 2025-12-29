# 🤖 Production QA Watcher (Ralph Mode)

> Autonomous AI-powered code quality tool that finds and fixes production issues while you sleep

[![Version](https://img.shields.io/badge/version-2.8.0-blue.svg)](https://github.com/JamesMo14/Ralph-Mode/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/JamesMo14/Ralph-Mode/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/JamesMo14/Ralph-Mode?style=social)](https://github.com/JamesMo14/Ralph-Mode)

**[Star this repo](https://github.com/JamesMo14/Ralph-Mode)** if you find it useful!

---

## Quick Start

```bash
npm install
npm run qa-ralph
# Dashboard opens at localhost:3000 - watch it work!
```

---

## What It Does

| Feature | Description |
|---------|-------------|
| 🔍 **Detection** | Finds hardcoded localhost URLs, API keys, console.log statements, and more |
| 🔧 **Auto-Fix** | Automatically fixes safe patterns like localhost and console.log |
| 🤖 **Ralph Mode** | Autonomous cleanup that runs until your codebase is clean |
| 📊 **Live Dashboard** | Real-time progress tracking with Kanban-style issue board |
| 💰 **Cost Controls** | Configurable budget limits to prevent runaway costs |

---

## Why Use This?

- **Catch bugs before production** - Find hardcoded values, debug code, and secrets before they ship
- **Save hours of manual review** - Let AI handle repetitive code quality checks
- **Works with any codebase** - JavaScript, TypeScript, React, Next.js, Node.js, and more
- **Real results** - "Fixed 142 issues overnight for $4.30"

---

## Installation

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Claude Code CLI** - VS Code extension or standalone

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/JamesMo14/Ralph-Mode.git
cd Ralph-Mode

# 2. Install dependencies
npm install

# 3. Run for first time (generates .qawatch.json config)
npm run qa-watch

# 4. Customize config if needed
# Edit .qawatch.json to match your project structure
```

### Installing Claude Code CLI

Claude Code CLI is required for QA Watcher to work. Install it via:

1. **VS Code Extension** (recommended): Install "Claude Code" from VS Code marketplace
2. **Standalone**: Download from [claude.ai/download](https://claude.ai/download)

The CLI path is auto-detected on first run. If needed, update the path in `.qawatch.json`.

---

## Usage Modes

### Watch Mode (Default)

Monitor file changes in real-time. Issues are detected but not auto-fixed.

```bash
npm run qa-watch
```

Best for: Active development, learning what issues exist

### Fix Mode

Automatically fix safe patterns when issues are detected.

```bash
npm run qa-watch:fix
# or
npm run qa-watch -- --fix
```

Best for: Quick cleanup while coding

### Ralph Mode

Autonomous cleanup mode. Scans your entire codebase and fixes issues in a loop until clean or budget is reached.

```bash
npm run qa-ralph
```

Best for: Overnight cleanup, initial codebase scan, CI/CD integration

**Ralph Mode features:**
- Live dashboard at `localhost:3000`
- Automatic retry on failures
- Budget controls ($5 warning, $20 hard stop by default)
- Progress tracking with issue counts

---

## Configuration

QA Watcher uses `.qawatch.json` in your project root. A default config is generated on first run.

### Quick Config

```json
{
  "watchPaths": ["./src", "./app", "./components"],
  "ralph": {
    "maxCycles": 10,
    "budgetHard": 20.00
  }
}
```

### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `watchPaths` | `["./src", ...]` | Directories to monitor |
| `extensions` | `[".ts", ".tsx", ".js", ".jsx"]` | File types to review |
| `ralph.maxCycles` | `10` | Max fix iterations |
| `ralph.budgetHard` | `20.00` | Stop at this cost ($) |
| `dashboard.port` | `3000` | Dashboard server port |
| `dashboard.autoOpen` | `true` | Auto-open browser |

### Example: Next.js Project

```json
{
  "watchPaths": ["./src", "./app", "./components", "./lib"],
  "ignored": ["**/node_modules/**", "**/.next/**"],
  "techStack": {
    "framework": "nextjs",
    "database": "postgres",
    "auth": "clerk",
    "orm": "prisma"
  }
}
```

### Example: React + Vite Project

```json
{
  "watchPaths": ["./src"],
  "ignored": ["**/node_modules/**", "**/dist/**"],
  "techStack": {
    "framework": "react",
    "ui": "tailwind"
  }
}
```

See `.qawatch.json.example` for all available options with documentation.

---

## Features

### Detection Patterns

QA Watcher detects these production issues:

| Pattern | Severity | Example |
|---------|----------|---------|
| Hardcoded localhost | Critical | `http://localhost:3000/api` |
| API keys | Critical | `sk_live_xxx`, `ghp_xxx` |
| Database credentials | Critical | `postgres://user:pass@host` |
| console.log | Medium | `console.log("debug")` |
| debugger statements | Medium | `debugger;` |
| Disabled security | High | `csrf: false` |

### Auto-Fix Capabilities

Safe patterns are automatically fixed:

| Issue | Fix |
|-------|-----|
| `http://localhost:3000` | `process.env.NEXT_PUBLIC_API_URL` |
| `console.log(...)` | Line removed |
| `debugger;` | Line removed |

Unsafe patterns (API keys, credentials) are flagged for manual review.

### Dashboard Features

The Ralph Mode dashboard provides:

- **Real-time progress** - Watch issues get detected and fixed
- **Kanban board** - Issues organized by status (Detected → Fixing → Done)
- **Cost tracking** - Live cost counter with budget warnings
- **Activity log** - Timestamped log of all actions

### Notifications

Desktop notifications alert you to:
- Issues detected (with auto-fix count)
- Fixes applied
- Manual review needed
- Ralph Mode completion

---

## Cost Estimates

QA Watcher uses Claude API calls. Typical costs:

| Usage | Estimated Cost |
|-------|---------------|
| Single file review | $0.02 - $0.05 |
| File review + fix | $0.04 - $0.10 |
| Daily watch mode | $0.50 - $1.50 |
| Full codebase scan (100 files) | $2 - $10 |
| Ralph Mode cleanup | $2 - $15 |

### ROI Example

A 4-hour manual code review session costs ~$200+ in developer time.
Ralph Mode can achieve similar results overnight for $5-10.

### Budget Controls

```json
{
  "ralph": {
    "budgetWarning": 5.00,
    "budgetHard": 20.00
  }
}
```

- **Warning**: Console notification at $5
- **Hard stop**: Ralph Mode stops at $20

---

## CLI Reference

```bash
# Watch mode (default)
npm run qa-watch

# Verbose output
npm run qa-watch -- --verbose

# Debug mode (stack traces)
npm run qa-watch -- --debug

# Auto-fix mode
npm run qa-watch -- --fix

# Ralph mode (autonomous)
npm run qa-ralph

# Ralph with custom cycles
npm run qa-watch -- --ralph --max-ralph-cycles 5

# Ralph without dashboard
npm run qa-watch -- --ralph --no-dashboard

# Show current config
npm run qa-watch -- --show-config

# Scan staged files (for pre-commit)
npm run qa-scan-staged
```

---

## Pre-commit Hooks

Automatically check staged files before each commit.

### Setup

```bash
npm run qa-setup-hooks
```

This installs a git pre-commit hook that:
- Scans only staged `.ts`, `.tsx`, `.js`, `.jsx` files (fast)
- Blocks commits with critical issues (API keys, secrets)
- Shows warnings for non-critical issues (console.log)
- Allows commit if scan fails (fails open - won't block you)

### How It Works

1. You run `git commit`
2. Hook scans your staged files with Claude
3. If critical issues found → commit blocked with details
4. If only warnings → commit allowed with warning list
5. If scan fails → commit allowed (errors don't block)

### Bypass

To skip the check for a single commit:

```bash
git commit --no-verify
```

### Remove Hook

```bash
# Delete the hook
rm .git/hooks/pre-commit

# Or restore your original hook
mv .git/hooks/pre-commit.backup .git/hooks/pre-commit
```

---

## Metrics & Analytics

Track historical QA data, trends, and ROI across all your review sessions.

### View Metrics

When running Ralph Mode, the dashboard opens automatically. Click **"QA Metrics"** in the header to access analytics.

Or access directly at: `http://localhost:3000/metrics`

### What's Tracked

| Metric | Description |
|--------|-------------|
| **Per Session** | Files reviewed, issues found/fixed, cost, duration |
| **Aggregates** | Total reviews, total issues, total cost, time saved estimate |
| **Trends** | Issues over time, cost over time (charts) |
| **Breakdown** | Issues by severity, issues by type |
| **Top Files** | Files with the most recurring issues |

### Charts & Visualizations

The metrics dashboard includes:
- **Issues Over Time** - Line chart showing found vs fixed issues
- **Issues by Severity** - Doughnut chart (critical/high/medium)
- **Cost Over Time** - Cumulative cost tracking
- **Issues by Type** - Bar chart of issue categories

### Export Data

Click **"Export JSON"** on the metrics page to download the raw metrics data for external analysis or reporting.

### Data Storage

Metrics are stored in `qa-reviews/metrics.json` and persist across sessions. The file is append-only (up to 1000 sessions) to prevent data loss.

---

## Custom Rules

Define your own detection patterns without modifying QA Watcher code.

### Creating a Custom Rule

1. Rules live in `.qawatch/rules/` directory (auto-created on first run)
2. Each rule is a JSON file with the pattern definition
3. Rules are loaded automatically on each scan

### Rule Format

```json
{
  "name": "my-custom-rule",
  "enabled": true,
  "pattern": "// HACK:",
  "severity": "medium",
  "type": "quality",
  "message": "HACK comment found - technical debt should be tracked",
  "fix": "Create issue to address technical debt",
  "autoFixable": false,
  "files": ["*.ts", "*.tsx"],
  "ignoreFiles": ["*.test.*"]
}
```

### Rule Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier (used as issue type) |
| `pattern` | Yes | String literal or `/regex/` |
| `severity` | Yes | `critical`, `high`, `medium`, `low` |
| `message` | Yes | Description shown in reports |
| `enabled` | No | Set to `false` to disable (default: true) |
| `type` | No | Category for grouping |
| `fix` | No | Suggested fix description |
| `autoFixable` | No | Default: false |
| `files` | No | Glob patterns to include |
| `ignoreFiles` | No | Glob patterns to exclude |

### Pattern Types

**Literal string:**
```json
{ "pattern": "// TODO:" }
```

**Regular expression** (wrap in forward slashes):
```json
{ "pattern": "/console\\.(log|warn|error)/" }
```

### CLI Commands

```bash
# List all rules (built-in + custom)
npm run qa-rules:list

# Validate custom rules
npm run qa-rules:validate
```

### Example Rules

QA Watcher includes example rules in `.qawatch/rules/`:
- `example-rule.json` - Documented template (disabled by default)
- `no-hardcoded-colors.json` - Detect hex colors in code
- `no-direct-dom.json` - Detect DOM manipulation in React

---

## Ignoring Files and Code

QA Watcher supports both file-level and line-level ignores.

### .qaignore File

Create a `.qaignore` file in your project root to exclude files from QA review:

```
# Ignore all test files
**/*.test.ts
**/*.spec.ts

# Ignore directories
node_modules/
dist/

# Ignore specific files
legacy-code.js

# Negate (include despite previous rules)
!src/critical.test.ts
```

**Pattern Syntax:**

| Pattern | Description |
|---------|-------------|
| `*` | Match any characters except `/` |
| `**` | Match any characters including `/` |
| `?` | Match single character |
| `!pattern` | Negate (include despite previous rules) |
| `/pattern` | Match from project root only |
| `pattern/` | Match directories |
| `#` | Comment |

### Inline Ignore Comments

Add comments in your source code to skip specific lines or blocks:

```javascript
// Skip the next line
// qa-ignore-next-line
const API_KEY = 'sk_test_123';

// Skip this line
const url = 'http://localhost:3000'; // qa-ignore

// Skip a block
/* qa-ignore-start */
const debug = true;
console.log('debug mode');
/* qa-ignore-end */

// Skip specific rule
// qa-ignore: hardcoded-localhost
const devUrl = 'http://localhost:8080';

// Skip multiple rules
// qa-ignore: console-log, debugger-statement
console.log('intentional');
```

**Inline Ignore Reference:**

| Comment | Effect |
|---------|--------|
| `// qa-ignore-next-line` | Skip the next line |
| `// qa-ignore` | Skip this line (at end of line) |
| `/* qa-ignore-start */` | Start ignoring block |
| `/* qa-ignore-end */` | End ignoring block |
| `// qa-ignore: rule-name` | Skip specific rule on next line |
| `// qa-ignore: rule1, rule2` | Skip multiple rules on next line |

### Getting Started

1. Copy the example file: `cp .qaignore.example .qaignore`
2. Edit `.qaignore` to match your project needs
3. Use inline comments for intentional exceptions

---

## Troubleshooting

### Claude CLI Not Found

```
❌ Claude CLI not found at: C:\...\claude.exe
   → Install Claude Code from: https://claude.ai/download
```

**Solution**: Install Claude Code CLI or update the path in config.

### API Rate Limit

```
❌ Claude API rate limit exceeded
   → Wait a few minutes before retrying
```

**Solution**: Wait 2-5 minutes. QA Watcher auto-retries with exponential backoff.

### No Files Being Watched

```
⚠️ Watch path: Directory not found: ./src
```

**Solution**: Update `watchPaths` in `.qawatch.json` to match your project structure.

### Debug Mode

For detailed error information:

```bash
npm run qa-watch -- --debug
```

Debug mode shows:
- Full stack traces
- Detailed error context
- Verbose logging

### Log Files

- **Review logs**: `./qa-reviews/review-*.json`
- **Error log**: `./qa-reviews/errors.log`
- **Master log**: `./qa-reviews/master-log.jsonl`

---

## Project Structure

```
production-qa-watcher/
├── production-qa-watcher.js   # Main watcher script
├── dashboard-server.js        # Ralph Mode dashboard server
├── public/
│   └── index.html            # Dashboard UI
├── qa-reviews/               # Generated logs and reports
├── test-cases/               # Example files for testing
├── .qawatch.json             # Your config (generated)
├── .qawatch.json.example     # Config documentation
└── package.json
```

---

## Contributing

Contributions welcome! Areas for improvement:

- Additional detection patterns
- New auto-fix capabilities
- Dashboard enhancements
- Documentation improvements

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

Built with:
- [Claude Code](https://claude.ai) - AI-powered code analysis
- [Chokidar](https://github.com/paulmillr/chokidar) - File watching
- [Express](https://expressjs.com/) - Dashboard server
- [node-notifier](https://github.com/mikaelbr/node-notifier) - Desktop notifications
