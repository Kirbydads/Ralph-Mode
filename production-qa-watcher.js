#!/usr/bin/env node
/**
 * Production QA Watcher v2.5.0
 *
 * Autonomous code review system that monitors file changes and uses
 * Claude Code headless mode to detect production deployment issues.
 *
 * Usage:
 *   npm run qa-watch          # Start watching
 *   npm run qa-watch:verbose  # Verbose output
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');

// ============================================================================
// PLATFORM DETECTION & CROSS-PLATFORM UTILITIES
// ============================================================================

const IS_WINDOWS = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

/**
 * Find Claude CLI path across all platforms
 * Priority: 1) CLAUDE_CLI_PATH env var, 2) Config file, 3) Auto-detect
 */
function findClaudeCLI() {
  // 1. Check environment variable first
  if (process.env.CLAUDE_CLI_PATH) {
    if (fs.existsSync(process.env.CLAUDE_CLI_PATH)) {
      return process.env.CLAUDE_CLI_PATH;
    }
    log(`Warning: CLAUDE_CLI_PATH set but file not found: ${process.env.CLAUDE_CLI_PATH}`, 'warning');
  }

  // 2. Try to find in PATH using 'which' or 'where'
  try {
    const cmd = IS_WINDOWS ? 'where claude' : 'which claude';
    const result = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (result && fs.existsSync(result.split('\n')[0])) {
      return result.split('\n')[0];
    }
  } catch {
    // Not in PATH, continue searching
  }

  // 3. Platform-specific default locations
  const homeDir = os.homedir();
  const possiblePaths = [];

  if (IS_WINDOWS) {
    // VS Code extensions (all versions)
    const vscodeExtDir = path.join(homeDir, '.vscode', 'extensions');
    if (fs.existsSync(vscodeExtDir)) {
      try {
        const extensions = fs.readdirSync(vscodeExtDir);
        const claudeExts = extensions.filter(e => e.startsWith('anthropic.claude-code-')).sort().reverse();
        for (const ext of claudeExts) {
          possiblePaths.push(path.join(vscodeExtDir, ext, 'resources', 'native-binary', 'claude.exe'));
        }
      } catch {}
    }
    // AppData locations
    possiblePaths.push(path.join(homeDir, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'));
    possiblePaths.push(path.join(homeDir, 'AppData', 'Local', 'Claude', 'claude.exe'));
    // Scoop
    possiblePaths.push(path.join(homeDir, 'scoop', 'shims', 'claude.exe'));
  } else if (IS_MAC) {
    // VS Code extensions
    const vscodeExtDir = path.join(homeDir, '.vscode', 'extensions');
    if (fs.existsSync(vscodeExtDir)) {
      try {
        const extensions = fs.readdirSync(vscodeExtDir);
        const claudeExts = extensions.filter(e => e.startsWith('anthropic.claude-code-')).sort().reverse();
        for (const ext of claudeExts) {
          possiblePaths.push(path.join(vscodeExtDir, ext, 'resources', 'native-binary', 'claude'));
        }
      } catch {}
    }
    // Homebrew
    possiblePaths.push('/opt/homebrew/bin/claude');
    possiblePaths.push('/usr/local/bin/claude');
    // Application bundle
    possiblePaths.push('/Applications/Claude.app/Contents/MacOS/claude');
    // Home local bin
    possiblePaths.push(path.join(homeDir, '.local', 'bin', 'claude'));
  } else {
    // Linux
    const vscodeExtDir = path.join(homeDir, '.vscode', 'extensions');
    if (fs.existsSync(vscodeExtDir)) {
      try {
        const extensions = fs.readdirSync(vscodeExtDir);
        const claudeExts = extensions.filter(e => e.startsWith('anthropic.claude-code-')).sort().reverse();
        for (const ext of claudeExts) {
          possiblePaths.push(path.join(vscodeExtDir, ext, 'resources', 'native-binary', 'claude'));
        }
      } catch {}
    }
    // Standard Linux paths
    possiblePaths.push('/usr/local/bin/claude');
    possiblePaths.push('/usr/bin/claude');
    possiblePaths.push(path.join(homeDir, '.local', 'bin', 'claude'));
    // Snap
    possiblePaths.push('/snap/bin/claude');
  }

  // Try each possible path
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Get skill file path using os.homedir()
 */
function getSkillFilePath() {
  return path.join(os.homedir(), '.claude', 'production-readiness-checklist-skill.md');
}

/**
 * Execute a command using platform-appropriate shell
 * Returns: { shell: string, args: string[], options: object }
 */
function getPlatformSpawnConfig(claudePath, prompt, options = {}) {
  const { allowedTools, maxTurns } = options;

  // Escape the prompt for the shell
  let escapedPrompt;
  let shell, args;

  if (IS_WINDOWS) {
    // PowerShell - escape single quotes by doubling them
    escapedPrompt = prompt.replace(/'/g, "''");
    const psCmd = `& '${claudePath}' -p '${escapedPrompt}' --output-format json --max-turns ${maxTurns} --allowedTools ${allowedTools}`;
    shell = 'powershell';
    args = ['-Command', psCmd];
  } else {
    // Bash/sh - escape single quotes with '\''
    escapedPrompt = prompt.replace(/'/g, "'\\''");
    shell = '/bin/sh';
    args = ['-c', `'${claudePath}' -p '${escapedPrompt}' --output-format json --max-turns ${maxTurns} --allowedTools ${allowedTools}`];
  }

  const spawnOptions = {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe']
  };

  // Windows-specific: hide console window
  if (IS_WINDOWS) {
    spawnOptions.windowsHide = true;
  }

  return { shell, args, options: spawnOptions };
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Auto-detect Claude CLI path
const detectedClaudePath = findClaudeCLI();

const CONFIG = {
  // Paths (auto-detected, can be overridden by config file)
  claudePath: detectedClaudePath,
  skillFile: getSkillFilePath(),
  logDir: './qa-reviews',

  // File watching
  watchPaths: [
    './src',
    './components',
    './pages',
    './app',
    './lib',
    './utils'
  ],

  ignored: [
    '**/node_modules/**',
    '**/.git/**',
    '**/.next/**',
    '**/dist/**',
    '**/build/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/*.test.js',
    '**/*.spec.ts',
    '**/*.spec.tsx',
    '**/*.spec.js',
    '**/.env',
    '**/.env.*',
    '**/qa-reviews/**',
    '**/*.log',
    '**/*.md'
  ],

  // File extensions to review
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],

  // Timing
  debounceDelay: 1000,  // 1 second after last change

  // Claude Code configuration
  claudeConfig: {
    outputFormat: 'json',
    detection: {
      allowedTools: 'Read,Grep',
      maxTurns: 10  // Increased for multi-file reviews
    },
    fixing: {
      allowedTools: 'Read,Grep,Edit',
      maxTurns: 5
    }
  },

  // Auto-fix configuration
  autoFix: {
    enabled: process.argv.includes('--fix'),
    dryRun: !process.argv.includes('--fix'),  // Dry-run by default unless --fix flag
    backupFiles: true,
    verifyAfterFix: true,
    // Safe patterns to auto-fix (high confidence)
    safePatterns: [
      'hardcoded-localhost',  // http://localhost:* → process.env.NEXT_PUBLIC_APP_URL
      'console-log',          // console.log(...) → remove
      'debugger-statement'    // debugger; → remove
    ]
  },

  // Notifications with clickable HTML reports
  notifications: {
    enabled: true,
    criticalOnly: false,       // Now supports all notification types
    throttle: 60000,           // 1 minute between notifications
    sound: true,
    openReportOnClick: true,   // Open HTML report when notification clicked
    types: {
      detection: true,         // "Fixes Needed" after detection
      fixes: true,             // "Fixes Applied" after fixing
      remaining: true          // "Manual Review Needed" after verification
    }
  },

  // Logging
  logging: {
    verbose: process.argv.includes('--verbose'),
    debug: process.argv.includes('--debug'),  // Show stack traces and detailed errors
    timestampFormat: 'YYYY-MM-DDTHH-mm-ss'
  },

  // Ralph Mode (autonomous loop)
  ralph: {
    enabled: process.argv.includes('--ralph'),
    maxCycles: (() => {
      const idx = process.argv.indexOf('--max-ralph-cycles');
      return idx !== -1 ? parseInt(process.argv[idx + 1]) || 10 : 10;
    })(),
    scope: (() => {
      const idx = process.argv.indexOf('--ralph-scope');
      return idx !== -1 ? process.argv[idx + 1] : null;
    })(),
    budgetWarning: 5.00,   // Warn at $5
    budgetHard: 20.00      // Stop at $20
  },

  // Dashboard (real-time web UI for Ralph mode)
  dashboard: {
    enabled: !process.argv.includes('--no-dashboard'),
    port: 3000,
    autoOpen: true
  },

  // Pre-commit hook mode (scan staged files only)
  scanStaged: process.argv.includes('--scan-staged'),

  // Tech stack (for tailored reviews)
  techStack: {
    framework: '',
    database: '',
    auth: '',
    hosting: '',
    orm: '',
    ui: '',
    testing: ''
  }
};

// ============================================================================
// CONFIGURATION FILE SUPPORT
// ============================================================================

const CONFIG_FILE_NAME = '.qawatch.json';

/**
 * Get the path to the config file in the current directory
 */
function getConfigPath() {
  return path.join(process.cwd(), CONFIG_FILE_NAME);
}

/**
 * Validate the user config structure
 * @param {Object} config - User configuration object
 * @returns {string[]} - Array of validation errors (empty if valid)
 */
function validateConfig(config) {
  const errors = [];

  // Validate array fields
  if (config.watchPaths !== undefined && !Array.isArray(config.watchPaths)) {
    errors.push('watchPaths must be an array of directory paths');
  }
  if (config.ignored !== undefined && !Array.isArray(config.ignored)) {
    errors.push('ignored must be an array of glob patterns');
  }
  if (config.extensions !== undefined && !Array.isArray(config.extensions)) {
    errors.push('extensions must be an array of file extensions');
  }

  // Validate autoFix
  if (config.autoFix !== undefined) {
    if (typeof config.autoFix !== 'object') {
      errors.push('autoFix must be an object');
    } else {
      if (config.autoFix.safePatterns !== undefined && !Array.isArray(config.autoFix.safePatterns)) {
        errors.push('autoFix.safePatterns must be an array');
      }
      if (config.autoFix.backupFiles !== undefined && typeof config.autoFix.backupFiles !== 'boolean') {
        errors.push('autoFix.backupFiles must be a boolean');
      }
      if (config.autoFix.verifyAfterFix !== undefined && typeof config.autoFix.verifyAfterFix !== 'boolean') {
        errors.push('autoFix.verifyAfterFix must be a boolean');
      }
    }
  }

  // Validate ralph
  if (config.ralph !== undefined) {
    if (typeof config.ralph !== 'object') {
      errors.push('ralph must be an object');
    } else {
      if (config.ralph.maxCycles !== undefined && typeof config.ralph.maxCycles !== 'number') {
        errors.push('ralph.maxCycles must be a number');
      }
      if (config.ralph.budgetWarning !== undefined && typeof config.ralph.budgetWarning !== 'number') {
        errors.push('ralph.budgetWarning must be a number');
      }
      if (config.ralph.budgetHard !== undefined && typeof config.ralph.budgetHard !== 'number') {
        errors.push('ralph.budgetHard must be a number');
      }
    }
  }

  // Validate notifications
  if (config.notifications !== undefined) {
    if (typeof config.notifications !== 'object') {
      errors.push('notifications must be an object');
    } else {
      if (config.notifications.enabled !== undefined && typeof config.notifications.enabled !== 'boolean') {
        errors.push('notifications.enabled must be a boolean');
      }
      if (config.notifications.throttle !== undefined && typeof config.notifications.throttle !== 'number') {
        errors.push('notifications.throttle must be a number (milliseconds)');
      }
    }
  }

  // Validate dashboard
  if (config.dashboard !== undefined) {
    if (typeof config.dashboard !== 'object') {
      errors.push('dashboard must be an object');
    } else {
      if (config.dashboard.port !== undefined && typeof config.dashboard.port !== 'number') {
        errors.push('dashboard.port must be a number');
      }
    }
  }

  return errors;
}

/**
 * Generate default configuration file
 * @param {string} configPath - Path to write the config file
 */
function generateDefaultConfig(configPath) {
  const defaultConfig = {
    watchPaths: ['./src', './components', './pages', './app', './lib', './utils'],
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/qa-reviews/**',
      '**/*.log'
    ],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],

    autoFix: {
      backupFiles: true,
      verifyAfterFix: true,
      safePatterns: ['hardcoded-localhost', 'console-log', 'debugger-statement']
    },

    ralph: {
      maxCycles: 10,
      budgetWarning: 5.00,
      budgetHard: 20.00
    },

    notifications: {
      enabled: true,
      criticalOnly: false,
      sound: true
    },

    dashboard: {
      port: 3000,
      autoOpen: true
    },

    techStack: {
      framework: '',
      database: '',
      auth: '',
      hosting: '',
      orm: '',
      ui: '',
      testing: ''
    }
  };

  // Write with comment header (JSON doesn't support comments, so we use a _comment field)
  const configWithComment = {
    _comment: 'Production QA Watcher Configuration. See .qawatch.json.example for detailed documentation.',
    ...defaultConfig
  };

  fs.writeFileSync(configPath, JSON.stringify(configWithComment, null, 2));
  console.log(`\n📝 Created default configuration: ${configPath}`);
  console.log('   Edit this file to customize QA Watcher settings.\n');
}

/**
 * Deep merge user config with defaults
 * @param {Object} defaults - Default configuration
 * @param {Object} userConfig - User configuration (partial)
 * @returns {Object} - Merged configuration
 */
function mergeConfig(defaults, userConfig) {
  if (!userConfig) return defaults;

  const merged = { ...defaults };

  // Simple array/value overrides
  if (userConfig.watchPaths) merged.watchPaths = userConfig.watchPaths;
  if (userConfig.ignored) merged.ignored = userConfig.ignored;
  if (userConfig.extensions) merged.extensions = userConfig.extensions;
  if (userConfig.debounceDelay !== undefined) merged.debounceDelay = userConfig.debounceDelay;

  // Nested object merges
  if (userConfig.autoFix) {
    merged.autoFix = { ...defaults.autoFix, ...userConfig.autoFix };
  }
  if (userConfig.ralph) {
    merged.ralph = { ...defaults.ralph, ...userConfig.ralph };
  }
  if (userConfig.notifications) {
    merged.notifications = { ...defaults.notifications, ...userConfig.notifications };
    if (userConfig.notifications.types) {
      merged.notifications.types = { ...defaults.notifications.types, ...userConfig.notifications.types };
    }
  }
  if (userConfig.dashboard) {
    merged.dashboard = { ...defaults.dashboard, ...userConfig.dashboard };
  }
  if (userConfig.techStack) {
    merged.techStack = { ...defaults.techStack, ...userConfig.techStack };
  }
  if (userConfig.claudeConfig) {
    merged.claudeConfig = { ...defaults.claudeConfig, ...userConfig.claudeConfig };
    if (userConfig.claudeConfig.detection) {
      merged.claudeConfig.detection = { ...defaults.claudeConfig.detection, ...userConfig.claudeConfig.detection };
    }
    if (userConfig.claudeConfig.fixing) {
      merged.claudeConfig.fixing = { ...defaults.claudeConfig.fixing, ...userConfig.claudeConfig.fixing };
    }
  }

  return merged;
}

/**
 * Load configuration from .qawatch.json
 * @returns {Object|null} - User configuration or null if not found
 */
function loadConfigFile() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    // Generate default config on first run
    generateDefaultConfig(configPath);
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const userConfig = JSON.parse(content);

    // Remove comment field if present
    delete userConfig._comment;

    // Validate configuration
    const errors = validateConfig(userConfig);
    if (errors.length > 0) {
      console.error('\n❌ Invalid .qawatch.json configuration:');
      errors.forEach(e => console.error(`   - ${e}`));
      console.error('\n   See .qawatch.json.example for valid configuration options.\n');
      process.exit(1);
    }

    return userConfig;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`\n❌ Invalid JSON in ${CONFIG_FILE_NAME}:`);
      console.error(`   ${error.message}`);
      console.error('\n   Please fix the JSON syntax and try again.\n');
    } else {
      console.error(`\n❌ Error loading ${CONFIG_FILE_NAME}:`);
      console.error(`   ${error.message}\n`);
    }
    process.exit(1);
  }
}

/**
 * Apply user configuration to CONFIG
 */
function applyUserConfig() {
  const userConfig = loadConfigFile();
  const mergedConfig = mergeConfig(CONFIG, userConfig);

  // Apply merged values back to CONFIG
  Object.assign(CONFIG, mergedConfig);

  // CLI arguments still take precedence
  if (process.argv.includes('--fix')) {
    CONFIG.autoFix.enabled = true;
    CONFIG.autoFix.dryRun = false;
  }
  if (process.argv.includes('--verbose')) {
    CONFIG.logging.verbose = true;
  }

  // Ralph mode CLI overrides
  const maxCyclesIdx = process.argv.indexOf('--max-ralph-cycles');
  if (maxCyclesIdx !== -1 && process.argv[maxCyclesIdx + 1]) {
    CONFIG.ralph.maxCycles = parseInt(process.argv[maxCyclesIdx + 1]) || CONFIG.ralph.maxCycles;
  }

  const scopeIdx = process.argv.indexOf('--ralph-scope');
  if (scopeIdx !== -1 && process.argv[scopeIdx + 1]) {
    CONFIG.ralph.scope = process.argv[scopeIdx + 1];
  }

  if (process.argv.includes('--no-dashboard')) {
    CONFIG.dashboard.enabled = false;
  }
}

/**
 * Print current configuration and exit
 */
function showConfig() {
  console.log('\n📋 Current QA Watcher Configuration:\n');
  console.log(JSON.stringify(CONFIG, null, 2));
  console.log('\n   Config file:', getConfigPath());
  console.log('   CLI overrides applied: --fix, --verbose, --ralph, etc.\n');
  process.exit(0);
}

// ============================================================================
// CUSTOM RULES
// ============================================================================

const RULES_DIR = path.join(process.cwd(), '.qawatch', 'rules');
let loadedCustomRules = [];

/**
 * Get the path to the custom rules directory
 */
function getRulesDir() {
  return RULES_DIR;
}

/**
 * Ensure the rules directory exists, create with example if not
 */
function ensureRulesDir() {
  if (!fs.existsSync(RULES_DIR)) {
    fs.mkdirSync(RULES_DIR, { recursive: true });
    // Create example rule on first run
    createExampleRule();
    log('Created custom rules directory at .qawatch/rules/', 'info');
  }
}

/**
 * Create an example rule file with documentation
 */
function createExampleRule() {
  const exampleRule = {
    "_comment": "Example custom rule. Copy and modify for your own patterns. Set enabled:true to activate.",
    "name": "example-todo-comment",
    "enabled": false,
    "pattern": "// TODO:",
    "severity": "low",
    "type": "quality",
    "message": "TODO comment found - consider creating a GitHub issue",
    "fix": "Create a GitHub issue to track this TODO",
    "autoFixable": false,
    "files": ["*.ts", "*.tsx", "*.js", "*.jsx"],
    "ignoreFiles": ["*.test.*", "*.spec.*"]
  };
  const examplePath = path.join(RULES_DIR, 'example-rule.json');
  fs.writeFileSync(examplePath, JSON.stringify(exampleRule, null, 2));
}

/**
 * Validate a single rule object
 * @param {Object} rule - Rule configuration object
 * @param {string} filename - Source filename for error messages
 * @returns {string[]} - Array of validation errors (empty if valid)
 */
function validateRule(rule, filename) {
  const errors = [];

  // Required fields
  if (!rule.name) errors.push('Missing required field: name');
  if (!rule.pattern) errors.push('Missing required field: pattern');
  if (!rule.severity) errors.push('Missing required field: severity');
  if (!rule.message) errors.push('Missing required field: message');

  // Valid severity
  const validSeverities = ['critical', 'high', 'medium', 'low'];
  if (rule.severity && !validSeverities.includes(rule.severity)) {
    errors.push(`Invalid severity "${rule.severity}". Must be: ${validSeverities.join(', ')}`);
  }

  // Valid pattern (string or regex wrapped in /)
  if (rule.pattern) {
    if (rule.pattern.startsWith('/') && rule.pattern.endsWith('/')) {
      try {
        new RegExp(rule.pattern.slice(1, -1));
      } catch (e) {
        errors.push(`Invalid regex pattern: ${e.message}`);
      }
    }
  }

  // Validate optional array fields
  if (rule.files !== undefined && !Array.isArray(rule.files)) {
    errors.push('files must be an array of glob patterns');
  }
  if (rule.ignoreFiles !== undefined && !Array.isArray(rule.ignoreFiles)) {
    errors.push('ignoreFiles must be an array of glob patterns');
  }

  return errors;
}

/**
 * Load all custom rules from the rules directory
 * @returns {Object[]} - Array of valid, enabled rules
 */
function loadCustomRules() {
  const rules = [];

  if (!fs.existsSync(RULES_DIR)) {
    return rules;
  }

  const files = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.json'));
  const seenNames = new Set();

  for (const file of files) {
    const filepath = path.join(RULES_DIR, file);
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const rule = JSON.parse(content);

      // Validate
      const errors = validateRule(rule, file);
      if (errors.length > 0) {
        log(`Skipping invalid rule ${file}: ${errors.join(', ')}`, 'warning');
        continue;
      }

      // Skip disabled rules
      if (rule.enabled === false) {
        logVerbose(`Skipping disabled rule: ${rule.name}`);
        continue;
      }

      // Warn on duplicate names (use last one)
      if (seenNames.has(rule.name)) {
        log(`Duplicate rule name "${rule.name}" in ${file} - using this version`, 'warning');
      }
      seenNames.add(rule.name);

      rules.push({ ...rule, _file: file });
    } catch (e) {
      if (e instanceof SyntaxError) {
        log(`Invalid JSON in ${file}: ${e.message}`, 'warning');
      } else {
        log(`Error loading ${file}: ${e.message}`, 'warning');
      }
    }
  }

  loadedCustomRules = rules;
  return rules;
}

/**
 * Format custom rules for inclusion in the Claude detection prompt
 * @param {Object[]} rules - Array of validated rules
 * @returns {string} - Formatted prompt section for custom rules
 */
function formatRulesForPrompt(rules) {
  if (rules.length === 0) return '';

  const ruleDescriptions = rules.map(r => {
    const patternDesc = r.pattern.startsWith('/')
      ? `regex pattern ${r.pattern}`
      : `literal text "${r.pattern}"`;
    return `- ${r.name} (${r.severity}): Look for ${patternDesc}. ${r.message}`;
  }).join('\n');

  return `

Also check for these user-defined patterns:
${ruleDescriptions}

For custom rules, use the rule name as the "type" field in your response.`;
}

/**
 * List all rules (built-in + custom) to console
 */
function listRules() {
  console.log('\n📋 QA Watcher Rules\n');

  // Built-in patterns
  console.log('Built-in Patterns:');
  console.log('  - hardcoded-localhost (critical) - Hardcoded localhost URLs');
  console.log('  - api-key (critical) - Exposed API keys');
  console.log('  - database-credentials (critical) - Database credentials in code');
  console.log('  - console-log (medium) - console.log statements');
  console.log('  - debugger-statement (medium) - debugger statements');
  console.log('  - security-disabled (high) - Disabled security settings');

  // Custom rules
  ensureRulesDir();
  const customRules = loadCustomRules();
  console.log(`\nCustom Rules (${customRules.length} enabled):`);

  // Also show disabled rules
  const allFiles = fs.existsSync(RULES_DIR)
    ? fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.json'))
    : [];

  if (allFiles.length === 0) {
    console.log('  No custom rules found. Create rules in .qawatch/rules/');
  } else {
    for (const file of allFiles) {
      try {
        const content = fs.readFileSync(path.join(RULES_DIR, file), 'utf8');
        const rule = JSON.parse(content);
        const status = rule.enabled === false ? ' [disabled]' : '';
        const errors = validateRule(rule, file);
        const invalid = errors.length > 0 ? ' [invalid]' : '';
        console.log(`  - ${rule.name || file} (${rule.severity || 'unknown'})${status}${invalid} - ${rule.message || 'No description'}`);
      } catch (e) {
        console.log(`  - ${file} [error: ${e.message}]`);
      }
    }
  }

  console.log('\nRules directory:', RULES_DIR);
  console.log('');
}

/**
 * Validate all custom rules and report errors
 */
function validateAllRules() {
  console.log('\n🔍 Validating Custom Rules\n');

  if (!fs.existsSync(RULES_DIR)) {
    console.log('No rules directory found at .qawatch/rules/');
    console.log('Run any qa-watch command to create it with an example rule.\n');
    return;
  }

  const files = fs.readdirSync(RULES_DIR).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('No rule files found in .qawatch/rules/\n');
    return;
  }

  let valid = 0;
  let invalid = 0;

  for (const file of files) {
    const filepath = path.join(RULES_DIR, file);
    try {
      const content = fs.readFileSync(filepath, 'utf8');
      const rule = JSON.parse(content);
      const errors = validateRule(rule, file);

      if (errors.length > 0) {
        console.log(`❌ ${file}:`);
        errors.forEach(e => console.log(`   - ${e}`));
        invalid++;
      } else {
        const status = rule.enabled === false ? ' (disabled)' : '';
        console.log(`✅ ${file}${status} - valid`);
        valid++;
      }
    } catch (e) {
      console.log(`❌ ${file}: ${e.message}`);
      invalid++;
    }
  }

  console.log(`\nSummary: ${valid} valid, ${invalid} invalid\n`);
}

// ============================================================================
// QA IGNORE SUPPORT
// ============================================================================

const QAIGNORE_FILE = '.qaignore';
let loadedIgnorePatterns = [];

/**
 * Load and parse .qaignore file
 * Supports gitignore-style patterns with negation
 * @returns {Array} Array of parsed patterns
 */
function loadQaIgnore() {
  const ignorePath = path.join(process.cwd(), QAIGNORE_FILE);
  const patterns = [];

  if (!fs.existsSync(ignorePath)) {
    loadedIgnorePatterns = patterns;
    return patterns;
  }

  try {
    const content = fs.readFileSync(ignorePath, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Handle negation patterns
      const isNegation = trimmed.startsWith('!');
      const pattern = isNegation ? trimmed.slice(1) : trimmed;

      try {
        patterns.push({
          pattern: pattern,
          negation: isNegation,
          regex: patternToRegex(pattern)
        });
      } catch (e) {
        log(`Invalid pattern in .qaignore: ${pattern} - ${e.message}`, 'warning');
      }
    }

    loadedIgnorePatterns = patterns;
    if (patterns.length > 0) {
      logVerbose(`Loaded ${patterns.length} patterns from .qaignore`);
    }
  } catch (e) {
    log(`Error reading .qaignore: ${e.message}`, 'warning');
  }

  return patterns;
}

/**
 * Convert gitignore-style pattern to regex
 * @param {string} pattern - Glob pattern
 * @returns {RegExp} Compiled regex
 */
function patternToRegex(pattern) {
  // Remove trailing slash (directory marker - we treat files and dirs the same)
  let p = pattern.replace(/\/$/, '');

  // Handle leading slash (root anchor)
  const isRootAnchored = p.startsWith('/');
  if (isRootAnchored) {
    p = p.slice(1);
  }

  // Escape regex special chars except * and ?
  p = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // Convert glob patterns to regex
  // Use placeholder to avoid double-replacement
  p = p.replace(/\*\*/g, '{{GLOBSTAR}}');
  p = p.replace(/\*/g, '[^/]*');
  p = p.replace(/{{GLOBSTAR}}/g, '.*');
  p = p.replace(/\?/g, '.');

  // Anchor pattern appropriately
  if (isRootAnchored) {
    p = '^' + p;
  } else {
    // Match anywhere in path
    p = '(^|/)' + p;
  }

  // Match end of string or followed by path separator
  p = p + '($|/)';

  return new RegExp(p);
}

/**
 * Check if a file should be ignored based on .qaignore patterns
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file should be ignored
 */
function isFileIgnored(filePath) {
  if (loadedIgnorePatterns.length === 0) {
    return false;
  }

  // Normalize path separators for consistent matching
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Process patterns in order - later patterns can override earlier ones
  let ignored = false;

  for (const { negation, regex } of loadedIgnorePatterns) {
    if (regex.test(normalizedPath)) {
      // If negation pattern matches, UN-ignore the file
      // Otherwise, ignore it
      ignored = !negation;
    }
  }

  return ignored;
}

/**
 * Get inline ignore instructions for Claude prompt
 * @returns {string} Instruction text to add to prompt
 */
function getIgnoreInstructionForPrompt() {
  return `

IMPORTANT: If you encounter these inline comments in the code, skip checking that code:
- // qa-ignore-next-line - skip checking the next line
- // qa-ignore - skip checking this line (at end of line)
- /* qa-ignore-start */ ... /* qa-ignore-end */ - skip the entire block
- // qa-ignore: rule-name - skip only the specified rule on next line
- // qa-ignore: rule1, rule2 - skip multiple specific rules on next line

Do NOT report issues on lines that have these ignore comments.`;
}

// ============================================================================
// STATE
// ============================================================================

let chokidar = null;
let notifier = null;
let dashboard = null;
let watcher = null;
let changedFiles = new Set();
let debounceTimer = null;
let reviewInProgress = false;
let reviewCount = 0;
let lastNotificationTime = 0;
let skillContent = '';

// Ralph Mode state
let ralphState = {
  cycle: 0,
  totalCost: 0,
  totalFixed: 0,
  totalIssuesFound: 0,
  startTime: null,
  stopped: false
};

// ============================================================================
// HELPERS
// ============================================================================

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const icons = {
    info: 'ℹ',
    success: '✓',
    warning: '⚠',
    error: '✗',
    review: '🔍'
  };
  const icon = icons[type] || 'ℹ';
  console.log(`[${timestamp}] ${icon} ${message}`);
}

function logVerbose(message) {
  if (CONFIG.logging.verbose) {
    log(message, 'info');
  }
}

function formatTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function ensureLogDir() {
  if (!fs.existsSync(CONFIG.logDir)) {
    fs.mkdirSync(CONFIG.logDir, { recursive: true });
    log(`Created log directory: ${CONFIG.logDir}`, 'success');
  }
}

// ============================================================================
// ERROR HANDLING & RETRY LOGIC
// ============================================================================

const ERROR_LOG_FILE = 'errors.log';

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is non-retryable
 * @param {Error} error - The error to check
 * @returns {boolean} - True if should not retry
 */
function isNonRetryableError(error) {
  const msg = error.message?.toLowerCase() || '';
  // Don't retry on auth errors, file not found, or validation errors
  return msg.includes('not found') ||
         msg.includes('permission denied') ||
         msg.includes('invalid') ||
         msg.includes('authentication') ||
         msg.includes('401') ||
         msg.includes('403');
}

/**
 * Execute async function with exponential backoff retry
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Retry options
 * @returns {Promise} - Result or throws after all retries exhausted
 */
async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 1000,  // 1s, 2s, 4s exponential backoff
    name = 'operation'
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on certain errors
      if (isNonRetryableError(error)) {
        throw error;
      }

      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        log(`⚠️ ${name} failed, retrying in ${delay/1000}s... (attempt ${attempt}/${maxAttempts})`, 'warning');
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Format error into user-friendly message with help text
 * @param {Error} error - The error to format
 * @returns {Object} - { message, help }
 */
function formatUserError(error) {
  const msg = error.message?.toLowerCase() || '';

  // Claude CLI errors
  if (msg.includes('enoent') || msg.includes('spawn')) {
    return {
      message: `Claude CLI not found at: ${CONFIG.claudePath}`,
      help: 'Install Claude Code from: https://claude.ai/download'
    };
  }

  // Rate limiting
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
    return {
      message: 'Claude API rate limit exceeded',
      help: 'Wait a few minutes before retrying, or reduce review frequency'
    };
  }

  // Authentication
  if (msg.includes('auth') || msg.includes('401') || msg.includes('403') || msg.includes('unauthorized')) {
    return {
      message: 'Claude API authentication failed',
      help: 'Check your API key or re-authenticate with: claude auth'
    };
  }

  // Network errors
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('etimedout')) {
    return {
      message: 'Network error connecting to Claude API',
      help: 'Check your internet connection and try again'
    };
  }

  // Timeout
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      message: 'Claude API request timed out',
      help: 'The request took too long. Try again or reduce file count'
    };
  }

  // File permission errors
  if (msg.includes('eacces') || msg.includes('permission') || msg.includes('eperm')) {
    return {
      message: `Permission denied: ${error.path || 'file operation'}`,
      help: 'Check file/directory permissions'
    };
  }

  // Default - return original message
  return {
    message: error.message,
    help: null
  };
}

/**
 * Log an error to console and errors.log file
 * @param {Error} error - The error to log
 * @param {Object} context - Additional context (file, action, etc.)
 */
function logError(error, context = {}) {
  const formatted = formatUserError(error);

  // Build log entry
  const entry = {
    timestamp: new Date().toISOString(),
    message: formatted.message,
    originalError: error.message,
    context,
    ...(CONFIG.logging.debug && { stack: error.stack })
  };

  // Log to console with user-friendly message
  log(`❌ ${formatted.message}`, 'error');
  if (formatted.help) {
    console.error(`   → ${formatted.help}`);
  }
  if (CONFIG.logging.debug && error.stack) {
    console.error('\n' + error.stack + '\n');
  }

  // Append to error log file
  try {
    ensureLogDir();
    const logPath = path.join(CONFIG.logDir, ERROR_LOG_FILE);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line);
  } catch (e) {
    // Can't log to file, just continue
    if (CONFIG.logging.debug) {
      console.error(`   (Could not write to ${ERROR_LOG_FILE}: ${e.message})`);
    }
  }
}

/**
 * Validate startup requirements
 * @returns {Promise<void>} - Resolves if valid, exits process if not
 */
async function validateStartup() {
  const errors = [];
  const warnings = [];

  // 1. Check Claude CLI exists
  if (!fs.existsSync(CONFIG.claudePath)) {
    errors.push({
      check: 'Claude CLI',
      message: `Not found at: ${CONFIG.claudePath}`,
      help: 'Install Claude Code from: https://claude.ai/download'
    });
  } else {
    // Try to execute --version to verify it works
    try {
      const { execSync } = require('child_process');
      execSync(`"${CONFIG.claudePath}" --version`, {
        timeout: 10000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      // Only warn, don't fail - the CLI might still work
      warnings.push({
        check: 'Claude CLI',
        message: 'Found but version check failed (may still work)',
        help: null
      });
    }
  }

  // 2. Check skill file exists (optional, just warn)
  if (!fs.existsSync(CONFIG.skillFile)) {
    warnings.push({
      check: 'Skill file',
      message: `Not found at: ${CONFIG.skillFile}`,
      help: 'Using inline prompt instead (this is fine)'
    });
  }

  // 3. Check log directory is writable
  try {
    ensureLogDir();
    const testFile = path.join(CONFIG.logDir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
  } catch (e) {
    errors.push({
      check: 'Log directory',
      message: `Cannot write to: ${CONFIG.logDir}`,
      help: 'Check directory permissions or change logDir in config'
    });
  }

  // 4. Warn about missing watch directories (non-fatal)
  for (const watchPath of CONFIG.watchPaths) {
    if (!fs.existsSync(watchPath)) {
      warnings.push({
        check: 'Watch path',
        message: `Directory not found: ${watchPath}`,
        help: 'Create directory or remove from watchPaths in .qawatch.json'
      });
    }
  }

  // Report warnings
  if (warnings.length > 0) {
    console.log('\n⚠️  Startup warnings:');
    warnings.forEach(w => {
      console.log(`   ${w.check}: ${w.message}`);
      if (w.help) console.log(`      → ${w.help}`);
    });
    console.log('');
  }

  // Report errors and exit if any
  if (errors.length > 0) {
    console.error('\n❌ Startup validation failed:');
    errors.forEach(e => {
      console.error(`   ${e.check}: ${e.message}`);
      if (e.help) console.error(`      → ${e.help}`);
    });
    console.error('');
    process.exit(1);
  }
}

function shouldReviewFile(filePath) {
  const ext = path.extname(filePath);
  if (!CONFIG.extensions.includes(ext)) {
    return false;
  }

  // Check ignored patterns from CONFIG
  for (const pattern of CONFIG.ignored) {
    const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
    if (regex.test(filePath.replace(/\\/g, '/'))) {
      return false;
    }
  }

  // Check .qaignore patterns
  if (isFileIgnored(filePath)) {
    logVerbose(`Ignoring ${filePath} (matched .qaignore pattern)`);
    return false;
  }

  return true;
}

function collectFilesForRalph() {
  const files = [];

  // Directories to always skip
  const skipDirs = ['node_modules', '.git', '.next', 'dist', 'build', 'qa-reviews'];

  function walkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(process.cwd(), fullPath);

        if (entry.isDirectory()) {
          // Skip common ignored directories explicitly
          if (skipDirs.includes(entry.name)) {
            continue;
          }
          walkDir(fullPath);
        } else if (entry.isFile()) {
          if (shouldReviewFile(relativePath)) {
            // Check scope filter if provided
            if (CONFIG.ralph.scope) {
              const scopeRegex = new RegExp(
                CONFIG.ralph.scope
                  .replace(/\*\*/g, '.*')
                  .replace(/\*/g, '[^/\\\\]*')
              );
              if (!scopeRegex.test(relativePath.replace(/\\/g, '/'))) {
                continue;
              }
            }
            files.push(relativePath);
          }
        }
      }
    } catch (error) {
      logVerbose(`Could not read directory ${dir}: ${error.message}`);
    }
  }

  // Walk all watch paths
  for (const watchPath of CONFIG.watchPaths) {
    if (fs.existsSync(watchPath)) {
      walkDir(watchPath);
    }
  }

  // If no files found in watch paths, try test-cases directory
  if (files.length === 0) {
    if (fs.existsSync('./test-cases')) {
      walkDir('./test-cases');
    } else {
      walkDir('.');
    }
  }

  return files;
}

/**
 * Get list of staged files from git (for pre-commit hook)
 * @returns {string[]} List of staged file paths that should be reviewed
 */
function getStagedFiles() {
  try {
    const output = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const files = output.trim().split('\n')
      .filter(f => f && shouldReviewFile(f));

    return files;
  } catch (error) {
    if (error.message.includes('not a git repository')) {
      console.error('❌ Not a git repository');
    } else {
      console.error(`❌ Git error: ${error.message}`);
    }
    return [];
  }
}

// ============================================================================
// METRICS TRACKING
// ============================================================================

/**
 * Get the path to the metrics file
 */
function getMetricsPath() {
  return path.join(CONFIG.logDir, 'metrics.json');
}

/**
 * Load existing metrics from file
 * @returns {Object} Metrics object with sessions, aggregates, topFiles, issueTypeBreakdown
 */
function loadMetrics() {
  const metricsPath = getMetricsPath();
  try {
    if (fs.existsSync(metricsPath)) {
      return JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    }
  } catch (error) {
    logVerbose(`Could not load metrics: ${error.message}`);
  }
  return {
    sessions: [],
    aggregates: {
      totalReviews: 0,
      totalIssuesFound: 0,
      totalIssuesFixed: 0,
      totalCost: 0,
      totalDuration: 0,
      estimatedTimeSaved: 0
    },
    topFiles: {},
    issueTypeBreakdown: {}
  };
}

/**
 * Save metrics to file
 * @param {Object} metrics - Metrics object to save
 */
function saveMetrics(metrics) {
  const metricsPath = getMetricsPath();
  try {
    // Ensure log directory exists
    if (!fs.existsSync(CONFIG.logDir)) {
      fs.mkdirSync(CONFIG.logDir, { recursive: true });
    }
    fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
    logVerbose('Metrics saved successfully');
  } catch (error) {
    logVerbose(`Could not save metrics: ${error.message}`);
  }
}

/**
 * Update metrics with new session data
 * @param {Object} sessionData - Data from the completed session
 * @returns {Object} The created session object
 */
function updateMetrics(sessionData) {
  const metrics = loadMetrics();

  // Create new session entry
  const session = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    mode: sessionData.mode || 'watch',
    filesReviewed: sessionData.filesReviewed || 0,
    issuesFound: sessionData.issuesFound || { critical: 0, high: 0, medium: 0 },
    issuesFixed: sessionData.issuesFixed || 0,
    cost: sessionData.cost || 0,
    duration: sessionData.duration || 0,
    issueTypes: sessionData.issueTypes || {}
  };

  metrics.sessions.push(session);

  // Keep only last 1000 sessions to prevent unbounded growth
  if (metrics.sessions.length > 1000) {
    metrics.sessions = metrics.sessions.slice(-1000);
  }

  // Update aggregate statistics
  const totalIssues = (session.issuesFound.critical || 0) +
                      (session.issuesFound.high || 0) +
                      (session.issuesFound.medium || 0);

  metrics.aggregates.totalReviews++;
  metrics.aggregates.totalIssuesFound += totalIssues;
  metrics.aggregates.totalIssuesFixed += session.issuesFixed;
  metrics.aggregates.totalCost = parseFloat((metrics.aggregates.totalCost + session.cost).toFixed(4));
  metrics.aggregates.totalDuration += session.duration;
  metrics.aggregates.estimatedTimeSaved += session.issuesFixed * 5; // 5 min per issue fixed

  // Update issue type breakdown
  for (const [type, count] of Object.entries(session.issueTypes)) {
    metrics.issueTypeBreakdown[type] = (metrics.issueTypeBreakdown[type] || 0) + count;
  }

  // Update top files (files with issues)
  if (sessionData.filesWithIssues) {
    for (const file of sessionData.filesWithIssues) {
      metrics.topFiles[file] = (metrics.topFiles[file] || 0) + 1;
    }
  }

  saveMetrics(metrics);
  logVerbose(`Metrics updated: session ${session.id}`);
  return session;
}

/**
 * Build issue type counts from an issues array
 * @param {Array} issues - Array of issue objects
 * @returns {Object} Map of issue type to count
 */
function buildIssueTypeCounts(issues) {
  const counts = {};
  if (!issues || !Array.isArray(issues)) return counts;

  for (const issue of issues) {
    if (issue.type) {
      counts[issue.type] = (counts[issue.type] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Build severity counts from an issues array
 * @param {Array} issues - Array of issue objects
 * @returns {Object} { critical, high, medium }
 */
function buildSeverityCounts(issues) {
  const counts = { critical: 0, high: 0, medium: 0 };
  if (!issues || !Array.isArray(issues)) return counts;

  for (const issue of issues) {
    const severity = (issue.severity || 'medium').toLowerCase();
    if (severity in counts) {
      counts[severity]++;
    } else {
      counts.medium++; // Default to medium for unknown severities
    }
  }
  return counts;
}

/**
 * Get unique files from issues array
 * @param {Array} issues - Array of issue objects
 * @returns {Array} Unique file paths
 */
function getFilesWithIssues(issues) {
  if (!issues || !Array.isArray(issues)) return [];
  return [...new Set(issues.map(i => i.file).filter(Boolean))];
}

function countAutoFixable(issues) {
  if (!issues || !Array.isArray(issues)) return 0;
  return issues.filter(i => {
    if (i.autoFixable !== undefined) return i.autoFixable;
    return CONFIG.autoFix.safePatterns.includes(i.type);
  }).length;
}

function getAutoFixableForFile(issues, file) {
  if (!issues || !Array.isArray(issues)) return [];
  return issues.filter(i => {
    const matchesFile = i.file === file ||
      i.file.endsWith(file) ||
      file.endsWith(i.file) ||
      i.file.replace(/\\/g, '/') === file.replace(/\\/g, '/');
    if (!matchesFile) return false;

    if (i.autoFixable !== undefined) return i.autoFixable;
    return CONFIG.autoFix.safePatterns.includes(i.type);
  });
}

// ============================================================================
// CLAUDE CODE INTEGRATION
// ============================================================================

function loadSkillFile() {
  // Skill file is now optional - we use a condensed inline prompt instead
  // to avoid Windows command-line length limits
  if (fs.existsSync(CONFIG.skillFile)) {
    log(`Skill reference file exists: ${CONFIG.skillFile}`, 'info');
  } else {
    log(`Note: Skill reference file not found (using inline prompt)`, 'info');
  }
  log('Using condensed inline prompt for reviews', 'success');
  return true;
}

async function executeClaudeReview(files) {
  return new Promise((resolve, reject) => {
    const fileList = files.join(', ');

    // Load custom rules and format for prompt
    const customRules = loadCustomRules();
    const customRulesPrompt = formatRulesForPrompt(customRules);

    // Get inline ignore instructions
    const ignoreInstruction = getIgnoreInstructionForPrompt();

    // Enhanced detection prompt with autoFixable flags
    const prompt = `Review file ${fileList} for production issues:
- Hardcoded localhost URLs (http://localhost:*, http://127.0.0.1:*)
- API keys (sk_, pk_, whsec_, ghp_, aws secret keys)
- Database credentials in connection strings
- console.log statements
- debugger statements
- Disabled security settings (csrf:false, secure:false)${customRulesPrompt}${ignoreInstruction}

Return JSON only (no markdown):
{
  "issues": [{
    "file": "path.tsx",
    "line": 42,
    "severity": "critical|high|medium|low",
    "type": "hardcoded-localhost|api-key|console-log|debugger-statement|security-disabled|<custom-rule-name>",
    "message": "description of issue",
    "current": "the problematic code",
    "fix": "the replacement code or 'remove'",
    "autoFixable": true or false
  }],
  "totalIssues": N,
  "criticalIssues": N,
  "autoFixableCount": N
}

Mark as autoFixable=true ONLY for:
- hardcoded-localhost (replace with process.env.NEXT_PUBLIC_APP_URL)
- console-log (remove the line)
- debugger-statement (remove the line)

Mark as autoFixable=false for API keys, credentials, security configs, and custom rules (need user review).`;

    // Get platform-appropriate spawn configuration
    const spawnConfig = getPlatformSpawnConfig(CONFIG.claudePath, prompt, {
      allowedTools: CONFIG.claudeConfig.detection.allowedTools,
      maxTurns: CONFIG.claudeConfig.detection.maxTurns
    });

    logVerbose(`Executing via ${IS_WINDOWS ? 'PowerShell' : 'shell'}...`);
    logVerbose(`Prompt: ${prompt.slice(0, 100)}...`);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const child = spawn(spawnConfig.shell, spawnConfig.args, spawnConfig.options);

    // CRITICAL: Immediately close stdin to send EOF signal
    // This fixes a known Windows bug where Claude CLI hangs waiting for stdin
    // See: https://github.com/anthropics/claude-code/issues/771
    child.stdin.end();

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (code !== 0) {
        log(`Claude exited with code ${code}`, 'error');
        if (stderr) {
          log(`Stderr: ${stderr.slice(0, 200)}`, 'error');
        }
        reject(new Error(`Process exited with code ${code}`));
        return;
      }

      logVerbose(`Claude output: ${stdout.slice(0, 200)}...`);

      try {
        // Parse the outer JSON wrapper from --output-format json
        const outerResult = JSON.parse(stdout.trim());

        // The actual review is in the 'result' field, possibly wrapped in markdown
        let innerContent = outerResult.result || '';

        // Strip markdown code blocks if present
        if (innerContent.startsWith('```json')) {
          innerContent = innerContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (innerContent.startsWith('```')) {
          innerContent = innerContent.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        // Parse the inner JSON (the actual review)
        let result;
        try {
          result = JSON.parse(innerContent);
        } catch {
          // If inner parsing fails, use the outer result structure
          result = { issues: [], totalIssues: 0, criticalIssues: 0 };
        }

        result._duration = duration;
        result._filesReviewed = files;
        result._cost = outerResult.total_cost_usd;
        resolve(result);
      } catch (parseError) {
        log(`Failed to parse Claude response: ${parseError.message}`, 'error');
        logVerbose(`Raw output: ${stdout.slice(0, 500)}`);
        reject(parseError);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      log(`Spawn error: ${err.message}`, 'error');
      reject(err);
    });

    // Timeout handler - 60 seconds max
    const timeout = setTimeout(() => {
      log('Review timed out after 60 seconds', 'error');
      child.kill('SIGTERM');
      reject(new Error('Review timed out'));
    }, 60000);
  });
}

// ============================================================================
// BACKUP & FIX FUNCTIONS
// ============================================================================

function backupFile(filePath) {
  const timestamp = Date.now();
  const backupPath = `${filePath}.backup-${timestamp}`;
  try {
    fs.copyFileSync(filePath, backupPath);
    logVerbose(`Backed up: ${filePath} → ${backupPath}`);
    return backupPath;
  } catch (error) {
    log(`Failed to backup ${filePath}: ${error.message}`, 'error');
    return null;
  }
}

function restoreFromBackup(originalPath, backupPath) {
  try {
    fs.copyFileSync(backupPath, originalPath);
    fs.unlinkSync(backupPath);
    log(`Restored ${originalPath} from backup`, 'warning');
    return true;
  } catch (error) {
    log(`Failed to restore ${originalPath}: ${error.message}`, 'error');
    return false;
  }
}

function cleanupBackup(backupPath) {
  try {
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
      logVerbose(`Cleaned up backup: ${backupPath}`);
    }
  } catch (error) {
    logVerbose(`Failed to cleanup backup: ${error.message}`);
  }
}

async function executeClaudeFix(file, issues) {
  return new Promise((resolve, reject) => {
    // Infer auto-fixable from type if flag not set
    const autoFixableIssues = issues.filter(i => {
      if (i.autoFixable !== undefined) return i.autoFixable;
      return CONFIG.autoFix.safePatterns.includes(i.type);
    });

    if (autoFixableIssues.length === 0) {
      resolve({ file, fixed: false, reason: 'No auto-fixable issues' });
      return;
    }

    // Build issue descriptions with defaults for missing fields
    const issueDescriptions = autoFixableIssues.map(i => {
      const current = i.current || `hardcoded value on line ${i.line}`;
      const fix = i.fix || 'process.env.NEXT_PUBLIC_APP_URL';
      return `Line ${i.line}: ${i.type} - Replace "${current}" with "${fix}"`;
    }).join('\n');

    const prompt = `Fix these issues in file ${file}:
${issueDescriptions}

Instructions:
1. Read the file first
2. For each issue, use the Edit tool to apply the fix
3. For "remove" fixes, delete the entire line
4. For replacement fixes, replace the exact string

Return JSON only (no markdown):
{
  "file": "${file}",
  "fixed": true,
  "linesModified": [list of line numbers],
  "changes": [{"line": N, "before": "old", "after": "new"}],
  "envVarsNeeded": ["ENV_VAR_NAME"]
}`;

    // Get platform-appropriate spawn configuration
    const spawnConfig = getPlatformSpawnConfig(CONFIG.claudePath, prompt, {
      allowedTools: CONFIG.claudeConfig.fixing.allowedTools,
      maxTurns: CONFIG.claudeConfig.fixing.maxTurns
    });

    log(`Applying fixes to ${file}...`, 'info');
    logVerbose(`Fix prompt: ${prompt.slice(0, 100)}...`);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    const child = spawn(spawnConfig.shell, spawnConfig.args, spawnConfig.options);

    child.stdin.end();

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (code !== 0) {
        log(`Fix failed with code ${code}`, 'error');
        reject(new Error(`Fix process exited with code ${code}`));
        return;
      }

      try {
        const outerResult = JSON.parse(stdout.trim());
        let innerContent = outerResult.result || '';

        if (innerContent.startsWith('```json')) {
          innerContent = innerContent.replace(/^```json\n?/, '').replace(/\n?```$/, '');
        } else if (innerContent.startsWith('```')) {
          innerContent = innerContent.replace(/^```\n?/, '').replace(/\n?```$/, '');
        }

        let result;
        try {
          result = JSON.parse(innerContent);
        } catch {
          result = { file, fixed: true, linesModified: [], changes: [] };
        }

        result._duration = duration;
        result._cost = outerResult.total_cost_usd;
        resolve(result);
      } catch (parseError) {
        log(`Failed to parse fix response: ${parseError.message}`, 'error');
        reject(parseError);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    const timeout = setTimeout(() => {
      log('Fix timed out after 90 seconds', 'error');
      child.kill('SIGTERM');
      reject(new Error('Fix timed out'));
    }, 90000);
  });
}

/**
 * Execute Claude review with retry logic
 * @param {string[]} files - Files to review
 * @returns {Promise} - Review result
 */
async function executeClaudeReviewWithRetry(files) {
  return withRetry(
    () => executeClaudeReview(files),
    { maxAttempts: 3, baseDelay: 1000, name: 'Claude review' }
  );
}

/**
 * Execute Claude fix with retry logic
 * @param {string} file - File to fix
 * @param {Array} issues - Issues to fix
 * @returns {Promise} - Fix result
 */
async function executeClaudeFixWithRetry(file, issues) {
  return withRetry(
    () => executeClaudeFix(file, issues),
    { maxAttempts: 3, baseDelay: 1000, name: 'Claude fix' }
  );
}

async function verifyFix(file) {
  log(`Verifying fix for ${file}...`, 'info');

  // Re-run detection on the fixed file
  try {
    const result = await executeClaudeReviewWithRetry([file]);
    const autoFixableRemaining = (result.issues || []).filter(i => i.autoFixable).length;

    return {
      file,
      verified: autoFixableRemaining === 0,
      remainingIssues: result.totalIssues || 0,
      autoFixableRemaining,
      _duration: result._duration
    };
  } catch (error) {
    return {
      file,
      verified: false,
      error: error.message
    };
  }
}

// ============================================================================
// REVIEW ORCHESTRATION
// ============================================================================

async function runReview() {
  if (reviewInProgress) {
    logVerbose('Review already in progress, skipping');
    return;
  }

  if (changedFiles.size === 0) {
    logVerbose('No files to review');
    return;
  }

  reviewInProgress = true;
  reviewCount++;
  const reviewStartTime = Date.now();

  const files = Array.from(changedFiles);
  changedFiles.clear();

  log(`Review #${reviewCount} - ${files.length} file(s)`, 'review');
  files.forEach(f => logVerbose(`  - ${f}`));

  try {
    // PASS 1: Detection
    const detection = await executeClaudeReviewWithRetry(files);
    handleReviewResult(detection, files);

    // Generate detection report and notify
    const issueList = detection.issues || [];
    let totalFixed = 0;  // Track fixes for metrics

    if (issueList.length > 0) {
      const detectionReport = generateHtmlReport('detection', {
        files,
        issues: issueList,
        timestamp: new Date().toISOString()
      });
      notifyDetection(detection, detectionReport);
    }

    // Check if we should attempt fixes
    // Determine auto-fixable based on type if autoFixable flag not present
    const autoFixableIssues = issueList.filter(i => {
      if (i.autoFixable !== undefined) return i.autoFixable;
      // Infer from type if flag not set
      return CONFIG.autoFix.safePatterns.includes(i.type);
    });
    const autoFixableCount = detection.autoFixableCount || autoFixableIssues.length;

    if (autoFixableCount === 0) {
      log('No auto-fixable issues found', 'info');
      // Update metrics even when no fixes needed
      const reviewDuration = Math.round((Date.now() - reviewStartTime) / 1000);
      updateMetrics({
        mode: 'watch',
        filesReviewed: files.length,
        issuesFound: buildSeverityCounts(issueList),
        issuesFixed: 0,
        cost: detection._cost || 0,
        duration: reviewDuration,
        issueTypes: buildIssueTypeCounts(issueList),
        filesWithIssues: getFilesWithIssues(issueList)
      });
      return;
    }

    if (!CONFIG.autoFix.enabled) {
      log(`${autoFixableCount} auto-fixable issue(s) found. Run with --fix to apply.`, 'info');
      // Update metrics for watch mode (no fixes applied)
      const reviewDuration = Math.round((Date.now() - reviewStartTime) / 1000);
      updateMetrics({
        mode: 'watch',
        filesReviewed: files.length,
        issuesFound: buildSeverityCounts(issueList),
        issuesFixed: 0,
        cost: detection._cost || 0,
        duration: reviewDuration,
        issueTypes: buildIssueTypeCounts(issueList),
        filesWithIssues: getFilesWithIssues(issueList)
      });
      return;
    }

    // DRY-RUN MODE: Show what would be fixed
    if (CONFIG.autoFix.dryRun) {
      displayDryRunResults(detection);
      // Update metrics for dry-run mode
      const reviewDuration = Math.round((Date.now() - reviewStartTime) / 1000);
      updateMetrics({
        mode: 'watch',
        filesReviewed: files.length,
        issuesFound: buildSeverityCounts(issueList),
        issuesFixed: 0,
        cost: detection._cost || 0,
        duration: reviewDuration,
        issueTypes: buildIssueTypeCounts(issueList),
        filesWithIssues: getFilesWithIssues(issueList)
      });
      return;
    }

    // PASS 2: Apply fixes (only when --fix flag is used)
    log('Auto-fix enabled, applying fixes...', 'info');
    const fixedIssues = [];

    for (const file of files) {
      const fileIssues = (detection.issues || []).filter(
        i => i.file === file || i.file.endsWith(file)
      );
      // Infer auto-fixable from type if flag not set
      const autoFixable = fileIssues.filter(i => {
        if (i.autoFixable !== undefined) return i.autoFixable;
        return CONFIG.autoFix.safePatterns.includes(i.type);
      });

      if (autoFixable.length === 0) continue;

      // Backup file before fixing
      let backupPath = null;
      if (CONFIG.autoFix.backupFiles) {
        backupPath = backupFile(file);
        if (!backupPath) {
          log(`Skipping ${file} - backup failed`, 'error');
          continue;
        }
      }

      try {
        // Apply fixes
        const fixResult = await executeClaudeFixWithRetry(file, fileIssues);

        if (fixResult.fixed) {
          log(`Fixed ${file}: ${fixResult.linesModified?.length || 0} line(s) modified`, 'success');
          totalFixed += autoFixable.length;

          // Track fixed issues for reporting
          autoFixable.forEach(issue => {
            fixedIssues.push({
              ...issue,
              fixed: true,
              before: issue.current,
              after: issue.fix
            });
          });

          // PASS 3: Verify fix worked
          if (CONFIG.autoFix.verifyAfterFix) {
            const verification = await verifyFix(file);

            if (verification.verified) {
              log(`Verified: ${file} - all auto-fixable issues resolved`, 'success');
              if (backupPath) cleanupBackup(backupPath);
            } else {
              log(`Verification failed: ${verification.autoFixableRemaining} issues remain`, 'warning');
              if (backupPath) {
                restoreFromBackup(file, backupPath);
              }
            }

            displayFixResults(fixResult, verification);
          } else {
            displayFixResults(fixResult, null);
            if (backupPath) cleanupBackup(backupPath);
          }

          // Show env vars needed
          if (fixResult.envVarsNeeded?.length > 0) {
            console.log('\n   Environment variables needed:');
            fixResult.envVarsNeeded.forEach(v => console.log(`   • ${v}`));
          }
        }
      } catch (fixError) {
        logError(fixError, { action: 'fix', file });
        log(`Skipping ${file} due to error, continuing with other files`, 'warning');
        if (backupPath) {
          restoreFromBackup(file, backupPath);
        }
        // Continue with other files - don't rethrow
      }
    }

    // After all fixes, generate reports and notify
    if (totalFixed > 0) {
      const fixesReport = generateHtmlReport('fixes', {
        files,
        issues: fixedIssues,
        fixedCount: totalFixed,
        totalAutoFixable: autoFixableCount
      });
      notifyFixes(totalFixed, autoFixableCount, fixesReport);
    }

    // Check for remaining non-auto-fixable issues
    const remainingIssues = issueList.filter(i => {
      const isAutoFixable = i.autoFixable !== undefined
        ? i.autoFixable
        : CONFIG.autoFix.safePatterns.includes(i.type);
      return !isAutoFixable;
    });

    if (remainingIssues.length > 0) {
      const remainingReport = generateHtmlReport('remaining', {
        issues: remainingIssues.map(i => ({
          ...i,
          reason: getNotFixableReason(i)
        }))
      });
      notifyRemaining(remainingIssues.length, remainingReport);
    }

    // Update metrics for this review
    const reviewDuration = Math.round((Date.now() - reviewStartTime) / 1000);
    updateMetrics({
      mode: CONFIG.autoFix.enabled ? 'fix' : 'watch',
      filesReviewed: files.length,
      issuesFound: buildSeverityCounts(issueList),
      issuesFixed: totalFixed,
      cost: detection._cost || 0,
      duration: reviewDuration,
      issueTypes: buildIssueTypeCounts(issueList),
      filesWithIssues: getFilesWithIssues(issueList)
    });
  } catch (error) {
    handleReviewError(error, files);
  } finally {
    reviewInProgress = false;
  }
}

function getNotFixableReason(issue) {
  if (issue.type === 'api-key') return 'API keys require manual replacement with environment variables';
  if (issue.type === 'database-credentials') return 'Database credentials require secure secret management';
  if (issue.type === 'security-disabled') return 'Security settings require careful review before enabling';
  if (issue.type === 'sql-injection') return 'SQL injection fixes require code restructuring';
  if (issue.type === 'xss-vulnerability') return 'XSS fixes require input sanitization review';
  return 'This issue type requires manual review and cannot be auto-fixed';
}

function handleReviewResult(result, files) {
  const timestamp = formatTimestamp();

  // Save individual review log
  const logFile = path.join(CONFIG.logDir, `review-${timestamp}.json`);
  const logEntry = {
    timestamp: new Date().toISOString(),
    reviewNumber: reviewCount,
    filesReviewed: files,
    duration: result._duration + 's',
    claudeResponse: result,
    success: true
  };

  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2));

  // Append to master log
  const masterLogFile = path.join(CONFIG.logDir, 'master-log.jsonl');
  fs.appendFileSync(masterLogFile, JSON.stringify({
    timestamp: logEntry.timestamp,
    reviewNumber: reviewCount,
    files: files.length,
    issues: result.totalIssues || 0,
    critical: result.criticalIssues || 0,
    duration: result._duration
  }) + '\n');

  // Display results
  displayResults(result);

  // Check for notifications
  checkNotification(result);
}

function handleReviewError(error, files) {
  const timestamp = formatTimestamp();

  // Save error log
  const logFile = path.join(CONFIG.logDir, `review-${timestamp}-error.json`);
  const logEntry = {
    timestamp: new Date().toISOString(),
    reviewNumber: reviewCount,
    filesReviewed: files,
    error: error.message,
    success: false
  };

  fs.writeFileSync(logFile, JSON.stringify(logEntry, null, 2));
  log(`Review failed: ${error.message}`, 'error');
}

function displayResults(result) {
  // Calculate counts from issues array if not provided
  const issueList = result.issues || [];
  const issues = result.totalIssues || issueList.length;
  const critical = result.criticalIssues || issueList.filter(i => i.severity === 'critical').length;
  const high = result.highIssues || issueList.filter(i => i.severity === 'high').length;
  const medium = result.mediumIssues || issueList.filter(i => i.severity === 'medium').length;
  const low = result.lowIssues || issueList.filter(i => i.severity === 'low').length;
  // Infer auto-fixable from type if flag not set
  const autoFixable = result.autoFixableCount || issueList.filter(i => {
    if (i.autoFixable !== undefined) return i.autoFixable;
    return CONFIG.autoFix.safePatterns.includes(i.type);
  }).length;

  if (issues === 0) {
    log('No production issues found!', 'success');
    if (result.readyForProduction) {
      log('Ready for deployment', 'success');
    }
  } else {
    log(`Found ${issues} issue(s):`, 'warning');
    if (critical > 0) console.log(`   Critical: ${critical}`);
    if (high > 0) console.log(`   High: ${high}`);
    if (medium > 0) console.log(`   Medium: ${medium}`);
    if (low > 0) console.log(`   Low: ${low}`);
    if (autoFixable > 0) console.log(`   Auto-fixable: ${autoFixable}`);

    // Show critical issues in detail
    if (issueList.length > 0 && critical > 0) {
      console.log('\n   Critical Issues:');
      issueList
        .filter(i => i.severity === 'critical')
        .forEach(issue => {
          console.log(`   • ${issue.file}:${issue.line || '?'}`);
          console.log(`     ${issue.message}`);
          if (issue.current) console.log(`     Current: ${issue.current}`);
          if (issue.fix) console.log(`     Fix: ${issue.fix}`);
          if (issue.autoFixable !== undefined) console.log(`     Auto-fixable: ${issue.autoFixable ? 'Yes' : 'No'}`);
        });
    }
  }

  // Show quality score if present
  if (result.qualityScore !== undefined) {
    const score = (result.qualityScore * 100).toFixed(0);
    console.log(`\n   Quality Score: ${score}%`);
  }

  console.log(`\n   Duration: ${result._duration}s`);
  console.log(`   Log: ${CONFIG.logDir}/review-${formatTimestamp()}.json\n`);
}

function displayDryRunResults(detection) {
  const autoFixable = (detection.issues || []).filter(i => i.autoFixable);

  if (autoFixable.length === 0) {
    log('No auto-fixable issues to display', 'info');
    return;
  }

  console.log('\n   ╔══════════════════════════════════════════════════════════╗');
  console.log('   ║  DRY-RUN MODE - No changes made                          ║');
  console.log('   ╚══════════════════════════════════════════════════════════╝\n');

  console.log(`   Would fix ${autoFixable.length} issue(s):\n`);

  autoFixable.forEach((issue, idx) => {
    console.log(`   ${idx + 1}. ${issue.file}:${issue.line}`);
    console.log(`      Type: ${issue.type}`);
    console.log(`      Current: ${issue.current}`);
    console.log(`      Fix: ${issue.fix}`);
    console.log('');
  });

  console.log('   To apply these fixes, run with --fix flag:');
  console.log('   npm run qa-watch:fix\n');
}

function displayFixResults(fixResult, verification) {
  console.log('\n   ╔══════════════════════════════════════════════════════════╗');
  console.log('   ║  AUTO-FIX RESULTS                                        ║');
  console.log('   ╚══════════════════════════════════════════════════════════╝\n');

  console.log(`   File: ${fixResult.file}`);
  console.log(`   Fixed: ${fixResult.fixed ? 'Yes' : 'No'}`);

  if (fixResult.linesModified?.length > 0) {
    console.log(`   Lines modified: ${fixResult.linesModified.join(', ')}`);
  }

  if (fixResult.changes?.length > 0) {
    console.log('\n   Changes:');
    fixResult.changes.forEach(change => {
      console.log(`   Line ${change.line}:`);
      console.log(`     - ${change.before}`);
      console.log(`     + ${change.after}`);
    });
  }

  if (verification) {
    console.log(`\n   Verification: ${verification.verified ? '✓ Passed' : '✗ Failed'}`);
    if (!verification.verified && verification.autoFixableRemaining > 0) {
      console.log(`   Remaining auto-fixable issues: ${verification.autoFixableRemaining}`);
    }
  }

  console.log(`\n   Duration: ${fixResult._duration}s`);
  if (fixResult._cost) {
    console.log(`   Cost: $${fixResult._cost.toFixed(4)}`);
  }
  console.log('');
}

function checkNotification(result) {
  if (!CONFIG.notifications.enabled) return;
  if (!notifier) return;

  const critical = result.criticalIssues || 0;

  if (CONFIG.notifications.criticalOnly && critical === 0) {
    return;
  }

  // Throttle check
  const now = Date.now();
  if (now - lastNotificationTime < CONFIG.notifications.throttle) {
    logVerbose('Notification throttled');
    return;
  }

  lastNotificationTime = now;

  notifier.notify({
    title: '🚨 Production Issues Found',
    message: `${critical} critical issue${critical !== 1 ? 's' : ''} detected`,
    sound: CONFIG.notifications.sound,
    wait: false
  });
}

// ============================================================================
// HTML REPORT GENERATION
// ============================================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getReportStyles() {
  return `
    :root {
      --critical: #dc2626;
      --high: #ea580c;
      --medium: #ca8a04;
      --low: #65a30d;
      --bg: #0d1117;
      --card: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --link: #58a6ff;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }

    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      margin-bottom: 2rem;
    }

    h1 { font-size: 2rem; margin-bottom: 0.5rem; }

    .meta span {
      display: inline-block;
      margin-right: 2rem;
      color: #8b949e;
    }

    .summary {
      display: flex;
      gap: 1rem;
      margin: 1rem 0;
      flex-wrap: wrap;
    }

    .summary-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem 1.5rem;
      min-width: 120px;
    }

    .summary-card .count {
      font-size: 2rem;
      font-weight: bold;
    }

    .summary-card .label {
      font-size: 0.85rem;
      color: #8b949e;
    }

    .summary-card.critical { border-left: 4px solid var(--critical); }
    .summary-card.high { border-left: 4px solid var(--high); }
    .summary-card.fixed { border-left: 4px solid var(--low); }

    nav.file-nav {
      position: fixed;
      top: 2rem;
      right: 2rem;
      width: 250px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      max-height: 80vh;
      overflow-y: auto;
    }

    nav h2 { font-size: 1rem; margin-bottom: 0.5rem; }

    nav a {
      display: block;
      color: var(--link);
      text-decoration: none;
      padding: 0.25rem 0;
      font-size: 0.85rem;
    }

    nav a:hover { text-decoration: underline; }

    main { max-width: calc(100% - 300px); }

    .file-section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin-bottom: 1.5rem;
      overflow: hidden;
    }

    .file-header {
      background: rgba(255,255,255,0.05);
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .file-header a {
      color: var(--link);
      text-decoration: none;
      font-family: monospace;
    }

    .file-header a:hover { text-decoration: underline; }

    .issue {
      padding: 1rem;
      border-bottom: 1px solid var(--border);
    }

    .issue:last-child { border-bottom: none; }

    .issue-header {
      display: flex;
      gap: 1rem;
      align-items: center;
      margin-bottom: 0.5rem;
      flex-wrap: wrap;
    }

    .severity {
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .severity.critical { background: var(--critical); color: white; }
    .severity.high { background: var(--high); color: white; }
    .severity.medium { background: var(--medium); color: black; }
    .severity.low { background: var(--low); color: black; }

    .line-num {
      color: #8b949e;
      font-family: monospace;
    }

    .issue-type {
      color: #8b949e;
      font-size: 0.85rem;
    }

    .message { margin: 0.5rem 0; }

    .code-block {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 1rem;
      overflow-x: auto;
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.85rem;
      margin: 0.5rem 0;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .code-block.before { border-left: 3px solid var(--critical); }
    .code-block.after { border-left: 3px solid var(--low); }

    .diff-label {
      font-size: 0.75rem;
      color: #8b949e;
      margin-bottom: 0.25rem;
      margin-top: 0.5rem;
    }

    .auto-fixable {
      color: var(--low);
      font-size: 0.85rem;
    }

    .not-fixable {
      color: var(--critical);
      font-size: 0.85rem;
    }

    footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
      color: #8b949e;
      font-size: 0.85rem;
    }

    @media (max-width: 900px) {
      nav.file-nav { display: none; }
      main { max-width: 100%; }
    }
  `;
}

function buildFileNav(issues) {
  if (!issues || !Array.isArray(issues) || issues.length === 0) return '<p>No files</p>';

  const files = [...new Set(issues.map(i => i.file).filter(Boolean))];
  return files.map(f =>
    `<a href="#file-${encodeURIComponent(f)}">${path.basename(f)}</a>`
  ).join('');
}

function buildIssueCard(type, issue) {
  const isAutoFixable = issue.autoFixable !== undefined
    ? issue.autoFixable
    : CONFIG.autoFix.safePatterns.includes(issue.type);

  const fixableLabel = isAutoFixable
    ? '<span class="auto-fixable">✓ Auto-fixable</span>'
    : '<span class="not-fixable">✗ Manual review needed</span>';

  let codeSection = '';

  if (type === 'fixes' && issue.before && issue.after) {
    codeSection = `
      <div class="diff-label">Before:</div>
      <pre class="code-block before">${escapeHtml(issue.before)}</pre>
      <div class="diff-label">After:</div>
      <pre class="code-block after">${escapeHtml(issue.after)}</pre>
    `;
  } else if (issue.current) {
    codeSection = `
      <pre class="code-block">${escapeHtml(issue.current)}</pre>
    `;
  }

  const lineLink = issue.line
    ? `<a href="vscode://file/${encodeURIComponent(path.resolve(issue.file))}:${issue.line}" class="line-num">Line ${issue.line}</a>`
    : '<span class="line-num">Line ?</span>';

  return `
    <div class="issue">
      <div class="issue-header">
        <span class="severity ${issue.severity || 'medium'}">${issue.severity || 'medium'}</span>
        ${lineLink}
        <span class="issue-type">${escapeHtml(issue.type || 'unknown')}</span>
        ${type === 'remaining' ? '' : fixableLabel}
      </div>
      <p class="message">${escapeHtml(issue.message || 'No description')}</p>
      ${codeSection}
      ${type === 'remaining' && issue.reason ? `<p class="not-fixable">Reason: ${escapeHtml(issue.reason)}</p>` : ''}
    </div>
  `;
}

function buildIssuesSections(type, data) {
  const issues = data.issues || [];
  if (issues.length === 0) {
    return '<p style="padding: 2rem; color: #8b949e;">No issues to display.</p>';
  }

  const fileGroups = {};
  issues.forEach(issue => {
    const file = issue.file || 'Unknown';
    if (!fileGroups[file]) fileGroups[file] = [];
    fileGroups[file].push(issue);
  });

  return Object.entries(fileGroups).map(([file, fileIssues]) => `
    <section class="file-section" id="file-${encodeURIComponent(file)}">
      <div class="file-header">
        <a href="vscode://file/${encodeURIComponent(path.resolve(file))}">${escapeHtml(file)}</a>
        <span>${fileIssues.length} issue(s)</span>
      </div>
      ${fileIssues.map(issue => buildIssueCard(type, issue)).join('')}
    </section>
  `).join('');
}

function buildSummaryCards(type, data) {
  const issues = data.issues || [];
  const critical = issues.filter(i => i.severity === 'critical').length;
  const high = issues.filter(i => i.severity === 'high').length;
  const autoFixable = countAutoFixable(issues);

  let cards = '';

  if (type === 'detection') {
    cards = `
      <div class="summary-card critical">
        <div class="count">${critical}</div>
        <div class="label">Critical</div>
      </div>
      <div class="summary-card high">
        <div class="count">${high}</div>
        <div class="label">High</div>
      </div>
      <div class="summary-card">
        <div class="count">${issues.length}</div>
        <div class="label">Total Issues</div>
      </div>
      <div class="summary-card fixed">
        <div class="count">${autoFixable}</div>
        <div class="label">Auto-fixable</div>
      </div>
    `;
  } else if (type === 'fixes') {
    const fixed = data.fixedCount || issues.length;
    cards = `
      <div class="summary-card fixed">
        <div class="count">${fixed}</div>
        <div class="label">Fixed</div>
      </div>
      <div class="summary-card">
        <div class="count">${data.totalAutoFixable || fixed}</div>
        <div class="label">Total Auto-fixable</div>
      </div>
    `;
  } else if (type === 'remaining') {
    cards = `
      <div class="summary-card critical">
        <div class="count">${issues.length}</div>
        <div class="label">Remaining</div>
      </div>
      <div class="summary-card">
        <div class="count">${critical}</div>
        <div class="label">Critical</div>
      </div>
    `;
  }

  return `<div class="summary">${cards}</div>`;
}

function buildReportHtml(type, data, timestamp) {
  const titles = {
    detection: '🔍 QA Issues Detected',
    fixes: '✅ Issues Fixed',
    remaining: '⚠️ Manual Review Required'
  };

  const fileCount = data.files?.length || [...new Set((data.issues || []).map(i => i.file))].length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titles[type]} - ${timestamp}</title>
  <style>
    ${getReportStyles()}
  </style>
</head>
<body>
  <header>
    <h1>${titles[type]}</h1>
    <div class="meta">
      <span>Generated: ${new Date().toLocaleString()}</span>
      <span>Files: ${fileCount}</span>
      <span>Issues: ${data.issues?.length || 0}</span>
    </div>
    ${buildSummaryCards(type, data)}
  </header>

  <nav class="file-nav">
    <h2>Files</h2>
    ${buildFileNav(data.issues)}
  </nav>

  <main>
    ${buildIssuesSections(type, data)}
  </main>

  <footer>
    <p>Production QA Watcher v2.5.0 | Report generated at ${timestamp}</p>
  </footer>
</body>
</html>`;
}

function generateHtmlReport(type, data) {
  const timestamp = formatTimestamp();
  const reportDir = path.join(CONFIG.logDir, 'reports');

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const filename = `${type}-${timestamp}.html`;
  const reportPath = path.join(reportDir, filename);

  const html = buildReportHtml(type, data, timestamp);
  fs.writeFileSync(reportPath, html);

  logVerbose(`Generated report: ${reportPath}`);
  return reportPath;
}

function openReportInBrowser(reportPath) {
  const { exec } = require('child_process');
  const absolutePath = path.resolve(reportPath);

  // Cross-platform browser open
  const command = process.platform === 'win32'
    ? `start "" "${absolutePath}"`
    : process.platform === 'darwin'
    ? `open "${absolutePath}"`
    : `xdg-open "${absolutePath}"`;

  exec(command, (error) => {
    if (error) {
      logVerbose(`Could not open report: ${error.message}`);
    }
  });
}

// ============================================================================
// ENHANCED NOTIFICATIONS
// ============================================================================

function createNotificationCallback(reportPath) {
  return (err, response, metadata) => {
    if (err) {
      logVerbose(`Notification error: ${err.message}`);
      return;
    }
    // Handle click - different notifiers have different callback signatures
    if (CONFIG.notifications.openReportOnClick && reportPath) {
      if (response === 'clicked' || metadata?.activationType === 'clicked' || response === 'activate') {
        openReportInBrowser(reportPath);
      }
    }
  };
}

/**
 * Safely send a notification (never throws)
 * @param {Object} options - Notification options
 * @param {string} reportPath - Path to report file for click handling
 */
function safeNotify(options, reportPath) {
  if (!CONFIG.notifications.enabled || !notifier) return;

  try {
    notifier.notify(options, createNotificationCallback(reportPath));
  } catch (error) {
    logVerbose(`Notification failed (continuing): ${error.message}`);
    // Non-critical - continue without throwing
  }
}

function notifyDetection(result, reportPath) {
  if (!CONFIG.notifications.types?.detection) return;

  const issues = result.issues || [];
  const autoFixable = countAutoFixable(issues);
  const critical = issues.filter(i => i.severity === 'critical').length;

  if (autoFixable === 0 && critical === 0 && CONFIG.notifications.criticalOnly) return;

  // Throttle check
  const now = Date.now();
  if (now - lastNotificationTime < CONFIG.notifications.throttle) {
    logVerbose('Detection notification throttled');
    return;
  }
  lastNotificationTime = now;

  safeNotify({
    title: '🔍 QA Issues Found',
    message: `Found ${issues.length} issue(s), ${autoFixable} auto-fixable`,
    sound: CONFIG.notifications.sound,
    wait: true
  }, reportPath);
}

function notifyFixes(fixed, total, reportPath) {
  if (!CONFIG.notifications.types?.fixes) return;

  safeNotify({
    title: '✅ Issues Fixed',
    message: `Fixed ${fixed}/${total} issue(s) successfully`,
    sound: CONFIG.notifications.sound,
    wait: true
  }, reportPath);
}

function notifyRemaining(remaining, reportPath) {
  if (!CONFIG.notifications.types?.remaining) return;
  if (remaining === 0) return;

  safeNotify({
    title: '⚠️ Manual Review Needed',
    message: `${remaining} issue(s) need manual attention`,
    sound: CONFIG.notifications.sound,
    wait: true
  }, reportPath);
}

function notifyRalphCycle(cycle, maxCycles, fixed, remaining, reportPath) {
  safeNotify({
    title: `🤖 Ralph Cycle ${cycle}/${maxCycles}`,
    message: `Fixed ${fixed}, ${remaining} remaining`,
    sound: false,  // No sound for intermediate cycles
    wait: true
  }, reportPath);
}

function notifyRalphComplete(totalFixed, totalCost, status, reportPath) {
  const title = status === 'complete' ? '🎉 Ralph Complete!' : '⚠️ Ralph Stopped';
  const message = status === 'complete'
    ? `Fixed ${totalFixed} issue(s) - $${totalCost.toFixed(2)}`
    : `Stopped after ${totalFixed} fix(es) - $${totalCost.toFixed(2)}`;

  safeNotify({
    title,
    message,
    sound: CONFIG.notifications.sound,
    wait: true
  }, reportPath);
}

// ============================================================================
// RALPH MODE (Autonomous Loop)
// ============================================================================

async function runRalphCycle(files) {
  const cycleStartTime = Date.now();
  ralphState.cycle++;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🤖 Ralph Mode: Cycle ${ralphState.cycle}/${CONFIG.ralph.maxCycles}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`   Files to scan: ${files.length}`);

  // Emit cycle_started
  dashboard?.emitEvent('cycle_started', {
    cycle: ralphState.cycle,
    maxCycles: CONFIG.ralph.maxCycles
  });

  // PASS 1: Detect all issues
  log('PASS 1: Detecting issues...', 'review');

  // Emit detection_started
  dashboard?.emitEvent('detection_started', { fileCount: files.length });
  let detection;
  try {
    detection = await executeClaudeReviewWithRetry(files);
    ralphState.totalCost += detection._cost || 0;
  } catch (error) {
    logError(error, { action: 'ralph_detection', files });
    return { complete: false, error: error.message };
  }

  const issues = detection.issues || [];
  const autoFixable = countAutoFixable(issues);
  ralphState.totalIssuesFound += issues.length;

  console.log(`   Issues found: ${issues.length}`);
  console.log(`   Auto-fixable: ${autoFixable}`);
  console.log(`   Cost this cycle: $${(detection._cost || 0).toFixed(4)}`);

  // Emit detection_complete
  dashboard?.emitEvent('detection_complete', {
    issues: issues.map(i => ({
      id: `${i.file}:${i.line}`,
      file: i.file,
      line: i.line,
      severity: i.severity,
      type: i.type,
      message: i.message,
      autoFixable: i.autoFixable !== undefined ? i.autoFixable : CONFIG.autoFix.safePatterns.includes(i.type)
    })),
    autoFixable,
    cost: detection._cost || 0
  });

  // Emit cost_update
  dashboard?.emitEvent('cost_update', {
    totalCost: ralphState.totalCost,
    cyclesCost: detection._cost || 0
  });

  // No auto-fixable issues = we're done!
  if (autoFixable === 0) {
    if (issues.length === 0) {
      return { complete: true, reason: 'No issues found' };
    } else {
      return { complete: true, reason: 'No auto-fixable issues remaining', remainingIssues: issues };
    }
  }

  // PASS 2: Fix each file with auto-fixable issues
  log('PASS 2: Applying fixes...', 'review');
  let fixedCount = 0;

  // Group issues by file
  const fileSet = new Set(issues.map(i => i.file));

  for (const file of fileSet) {
    const fileIssues = getAutoFixableForFile(issues, file);
    if (fileIssues.length === 0) continue;

    console.log(`   Fixing ${file} (${fileIssues.length} issue(s))...`);

    // Emit fix_started
    const issueIds = fileIssues.map(i => `${i.file}:${i.line}`);
    dashboard?.emitEvent('fix_started', {
      file,
      issueCount: fileIssues.length,
      issueIds
    });

    // Backup file before fixing
    let backupPath = null;
    if (CONFIG.autoFix.backupFiles) {
      backupPath = backupFile(file);
      if (!backupPath) {
        log(`Skipping ${file} - backup failed`, 'error');
        continue;
      }
    }

    try {
      const fixResult = await executeClaudeFixWithRetry(file, fileIssues);
      ralphState.totalCost += fixResult._cost || 0;

      if (fixResult.fixed) {
        // PASS 3: Verify fix worked
        if (CONFIG.autoFix.verifyAfterFix) {
          log(`PASS 3: Verifying ${file}...`, 'review');
          const verification = await verifyFix(file);
          ralphState.totalCost += 0.02; // Estimate verification cost

          if (verification.verified) {
            fixedCount += fileIssues.length;
            ralphState.totalFixed += fileIssues.length;
            log(`Verified: ${file} - fixed ${fileIssues.length} issue(s)`, 'success');
            if (backupPath) cleanupBackup(backupPath);

            // Emit verification success
            dashboard?.emitEvent('verification_result', { file, verified: true, restored: false });
            dashboard?.emitEvent('fix_complete', { file, success: true, fixed: issueIds, failed: [] });
          } else {
            log(`Verification failed for ${file}, restoring...`, 'warning');
            if (backupPath) restoreFromBackup(file, backupPath);

            // Emit verification failure
            dashboard?.emitEvent('verification_result', { file, verified: false, restored: true });
            dashboard?.emitEvent('fix_complete', { file, success: false, fixed: [], failed: issueIds });
          }
        } else {
          fixedCount += fileIssues.length;
          ralphState.totalFixed += fileIssues.length;
          log(`Fixed: ${file} - ${fileIssues.length} issue(s)`, 'success');
          if (backupPath) cleanupBackup(backupPath);

          // Emit fix success (no verification)
          dashboard?.emitEvent('fix_complete', { file, success: true, fixed: issueIds, failed: [] });
        }
      } else {
        log(`No changes made to ${file}`, 'warning');
        if (backupPath) cleanupBackup(backupPath);

        // Emit fix with no changes
        dashboard?.emitEvent('fix_complete', { file, success: false, fixed: [], failed: issueIds });
      }
    } catch (fixError) {
      log(`Fix failed for ${file}: ${fixError.message}`, 'error');
      if (backupPath) restoreFromBackup(file, backupPath);

      // Emit fix failure
      dashboard?.emitEvent('fix_complete', { file, success: false, fixed: [], failed: issueIds });
    }

    // Check if stopped mid-cycle
    if (ralphState.stopped) {
      log('Stopping mid-cycle...', 'warning');
      break;
    }
  }

  console.log(`\n   ✓ Fixed ${fixedCount} issue(s) this cycle`);
  console.log(`   Running total: ${ralphState.totalFixed} fixed, $${ralphState.totalCost.toFixed(2)} spent`);

  // Generate cycle report and notify
  const remaining = autoFixable - fixedCount;
  const cycleReport = generateHtmlReport('detection', {
    files: [...fileSet],
    issues: issues,
    timestamp: new Date().toISOString()
  });
  notifyRalphCycle(ralphState.cycle, CONFIG.ralph.maxCycles, fixedCount, remaining, cycleReport);

  // Emit cycle_complete
  dashboard?.emitEvent('cycle_complete', {
    cycle: ralphState.cycle,
    fixedThisCycle: fixedCount,
    totalFixed: ralphState.totalFixed,
    remaining,
    cost: ralphState.totalCost
  });

  // Update metrics for this cycle
  const cycleDuration = Math.round((Date.now() - cycleStartTime) / 1000);
  updateMetrics({
    mode: 'ralph',
    filesReviewed: files.length,
    issuesFound: buildSeverityCounts(issues),
    issuesFixed: fixedCount,
    cost: detection._cost || 0,
    duration: cycleDuration,
    issueTypes: buildIssueTypeCounts(issues),
    filesWithIssues: getFilesWithIssues(issues)
  });

  return { complete: false, fixedThisCycle: fixedCount, issues };
}

async function runRalphMode() {
  ralphState.startTime = Date.now();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  🤖 RALPH MODE ACTIVATED                                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('   Autonomous fix loop engaged');
  console.log(`   Max cycles: ${CONFIG.ralph.maxCycles}`);
  console.log(`   Budget warning: $${CONFIG.ralph.budgetWarning}`);
  console.log(`   Budget limit: $${CONFIG.ralph.budgetHard}`);
  if (CONFIG.ralph.scope) {
    console.log(`   Scope: ${CONFIG.ralph.scope}`);
  }
  console.log('   Press Ctrl+C to stop gracefully\n');

  // Start dashboard server if available
  if (dashboard && CONFIG.dashboard.enabled) {
    try {
      const port = await dashboard.startDashboard({ port: CONFIG.dashboard.port });
      if (port && CONFIG.dashboard.autoOpen) {
        dashboard.openDashboardInBrowser(port);
      }
    } catch (e) {
      logVerbose(`Dashboard failed to start: ${e.message}`);
    }
  }

  // Collect files to process
  const files = collectFilesForRalph();

  if (files.length === 0) {
    console.log('   ⚠️  No files to process!');
    console.log('   Check your watch paths and file extensions.\n');
    return;
  }

  console.log(`   Found ${files.length} file(s) to scan`);
  if (CONFIG.logging.verbose) {
    files.forEach(f => console.log(`   - ${f}`));
  }

  // Emit ralph_started event
  dashboard?.emitEvent('ralph_started', {
    maxCycles: CONFIG.ralph.maxCycles,
    files: files.length,
    budgetHard: CONFIG.ralph.budgetHard
  });

  // Main loop
  while (ralphState.cycle < CONFIG.ralph.maxCycles && !ralphState.stopped) {
    // Budget checks
    if (ralphState.totalCost >= CONFIG.ralph.budgetHard) {
      console.log(`\n🛑 BUDGET LIMIT REACHED: $${ralphState.totalCost.toFixed(2)}`);
      console.log('   Stopping to prevent excessive costs.\n');
      break;
    }

    if (ralphState.totalCost >= CONFIG.ralph.budgetWarning &&
        ralphState.cycle > 1) {
      console.log(`\n⚠️  BUDGET WARNING: $${ralphState.totalCost.toFixed(2)} spent`);
      dashboard?.emitEvent('budget_warning', {
        currentCost: ralphState.totalCost,
        warningThreshold: CONFIG.ralph.budgetWarning
      });
    }

    // Run one cycle
    const result = await runRalphCycle(files);

    if (result.complete) {
      const duration = ((Date.now() - ralphState.startTime) / 1000).toFixed(1);

      console.log('\n╔══════════════════════════════════════════════════════════╗');
      console.log('║  🎉 ALL CLEAR!                                           ║');
      console.log('╚══════════════════════════════════════════════════════════╝');
      console.log(`   Reason: ${result.reason}`);
      console.log(`   Cycles completed: ${ralphState.cycle}`);
      console.log(`   Total issues fixed: ${ralphState.totalFixed}`);
      console.log(`   Total cost: $${ralphState.totalCost.toFixed(2)}`);
      console.log(`   Duration: ${duration}s`);

      // Generate final report
      let finalReport;
      if (result.remainingIssues?.length > 0) {
        console.log(`\n   ⚠️  ${result.remainingIssues.length} non-auto-fixable issue(s) remain:`);
        result.remainingIssues.slice(0, 5).forEach(i => {
          console.log(`   • ${i.file}:${i.line} - ${i.type}: ${i.message}`);
        });
        if (result.remainingIssues.length > 5) {
          console.log(`   ... and ${result.remainingIssues.length - 5} more`);
        }

        finalReport = generateHtmlReport('remaining', {
          issues: result.remainingIssues.map(i => ({
            ...i,
            reason: getNotFixableReason(i)
          }))
        });
      } else {
        finalReport = generateHtmlReport('fixes', {
          files,
          issues: [],
          fixedCount: ralphState.totalFixed,
          totalAutoFixable: ralphState.totalFixed
        });
      }

      notifyRalphComplete(ralphState.totalFixed, ralphState.totalCost, 'complete', finalReport);

      // Emit completion event and stop dashboard
      dashboard?.emitEvent('ralph_complete', {
        status: 'complete',
        totalFixed: ralphState.totalFixed,
        totalCost: ralphState.totalCost,
        duration: Date.now() - ralphState.startTime,
        reason: result.reason
      });

      // Keep dashboard open briefly so user can view metrics
      console.log('   📊 Dashboard will close in 30s. Use "npm run qa-metrics" to view metrics anytime.\n');
      setTimeout(() => dashboard?.stopDashboard(), 30000);

      console.log('');
      return;
    }

    if (result.error) {
      log(`Cycle ${ralphState.cycle} had an error: ${result.error}`, 'warning');
    }

    // Brief pause between cycles
    if (!ralphState.stopped && ralphState.cycle < CONFIG.ralph.maxCycles) {
      console.log('   Continuing to next cycle in 2s...\n');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Stopped or max cycles reached
  const duration = ((Date.now() - ralphState.startTime) / 1000).toFixed(1);

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  ⚠️  RALPH MODE STOPPED                                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`   Reason: ${ralphState.stopped ? 'User interrupted (Ctrl+C)' : 'Max cycles reached'}`);
  console.log(`   Cycles completed: ${ralphState.cycle}`);
  console.log(`   Total issues fixed: ${ralphState.totalFixed}`);
  console.log(`   Total cost: $${ralphState.totalCost.toFixed(2)}`);
  console.log(`   Duration: ${duration}s\n`);

  // Generate stopped report
  const stoppedReport = generateHtmlReport('fixes', {
    files,
    issues: [],
    fixedCount: ralphState.totalFixed,
    totalAutoFixable: ralphState.totalFixed
  });
  notifyRalphComplete(ralphState.totalFixed, ralphState.totalCost, 'stopped', stoppedReport);

  // Emit stopped event and stop dashboard
  dashboard?.emitEvent('ralph_complete', {
    status: 'stopped',
    totalFixed: ralphState.totalFixed,
    totalCost: ralphState.totalCost,
    duration: Date.now() - ralphState.startTime,
    reason: ralphState.stopped ? 'User interrupted' : 'Max cycles reached'
  });

  // Keep dashboard open briefly so user can view metrics
  console.log('   📊 Dashboard will close in 30s. Use "npm run qa-metrics" to view metrics anytime.\n');
  setTimeout(() => dashboard?.stopDashboard(), 30000);
}

// ============================================================================
// FILE WATCHER
// ============================================================================

function onFileChange(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);

  if (!shouldReviewFile(relativePath)) {
    logVerbose(`Ignored: ${relativePath}`);
    return;
  }

  log(`File changed: ${relativePath}`, 'info');
  changedFiles.add(relativePath);

  // Debounce
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    runReview();
  }, CONFIG.debounceDelay);
}

function setupWatcher() {
  // Filter to only existing directories
  const existingPaths = CONFIG.watchPaths.filter(p => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

  if (existingPaths.length === 0) {
    log('No watch directories found. Will watch current directory.', 'warning');
    existingPaths.push('.');
  }

  log(`Watching: ${existingPaths.join(', ')}`, 'info');

  watcher = chokidar.watch(existingPaths, {
    ignored: CONFIG.ignored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  watcher.on('change', onFileChange);
  watcher.on('add', onFileChange);

  watcher.on('ready', () => {
    log('QA Watcher active', 'success');
    log('Waiting for file changes...', 'info');
  });

  watcher.on('error', (error) => {
    log(`Watcher error: ${error.message}`, 'error');
  });
}

// ============================================================================
// SHUTDOWN
// ============================================================================

function gracefulShutdown() {
  // In Ralph mode, set flag to stop after current cycle
  if (CONFIG.ralph.enabled && !ralphState.stopped) {
    ralphState.stopped = true;
    log('Ralph mode stopping after current operation...', 'info');
    log('Press Ctrl+C again to force quit', 'info');
    return;
  }

  log('Shutting down QA Watcher...', 'info');

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  if (watcher) {
    watcher.close();
  }

  log('QA Watcher stopped', 'success');
  log(`Total reviews: ${reviewCount}`, 'info');

  process.exit(0);
}

// ============================================================================
// PRE-COMMIT HOOK MODE (SCAN STAGED FILES)
// ============================================================================

/**
 * Run a quick scan of staged files for pre-commit hook
 * @returns {Object} { success: boolean, issues: array, error?: string }
 */
async function runStagedScan() {
  console.log('🔍 Scanning staged files for production issues...\n');

  const stagedFiles = getStagedFiles();

  if (stagedFiles.length === 0) {
    console.log('✓ No staged files to review');
    return { success: true, issues: [] };
  }

  console.log(`   Scanning ${stagedFiles.length} file(s):`);
  stagedFiles.forEach(f => console.log(`   - ${f}`));
  console.log('');

  try {
    const result = await executeClaudeReviewWithRetry(stagedFiles);
    const allIssues = result.issues || [];
    const criticalIssues = allIssues.filter(i => i.severity === 'critical');

    if (criticalIssues.length > 0) {
      console.log('\n❌ COMMIT BLOCKED - Critical issues found:\n');
      criticalIssues.forEach(issue => {
        console.log(`   ${issue.file}:${issue.line}`);
        console.log(`   └─ ${issue.type}: ${issue.message}`);
      });
      console.log('\n   Fix these issues or use: git commit --no-verify');
      return { success: false, issues: criticalIssues };
    }

    // Show warnings for non-critical issues
    const warnings = allIssues.filter(i => i.severity !== 'critical');
    if (warnings.length > 0) {
      console.log(`⚠️  ${warnings.length} warning(s) found (not blocking):`);
      warnings.slice(0, 5).forEach(issue => {
        console.log(`   - ${issue.file}:${issue.line} - ${issue.type}`);
      });
      if (warnings.length > 5) {
        console.log(`   ... and ${warnings.length - 5} more`);
      }
    }

    console.log('\n✓ No critical issues - commit allowed');
    return { success: true, issues: warnings };

  } catch (error) {
    console.log(`\n⚠️  QA scan failed: ${error.message}`);
    console.log('   Allowing commit (scan error is not blocking)');
    return { success: true, issues: [], error: error.message };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const version = '2.8.0';  // Bumped for .qaignore support (PMV-111)

  // Load and apply user configuration first
  applyUserConfig();

  // Ensure custom rules directory exists
  ensureRulesDir();

  // Load .qaignore patterns
  loadQaIgnore();

  // Handle --list-rules flag
  if (process.argv.includes('--list-rules')) {
    listRules();
    return;
  }

  // Handle --validate-rules flag
  if (process.argv.includes('--validate-rules')) {
    validateAllRules();
    return;
  }

  // Handle --show-config flag
  if (process.argv.includes('--show-config')) {
    showConfig();
    return;
  }

  // Handle --scan-staged mode (for pre-commit hooks)
  if (CONFIG.scanStaged) {
    const result = await runStagedScan();
    process.exit(result.success ? 0 : 1);
  }

  // Debug mode implies verbose
  if (CONFIG.logging.debug) {
    CONFIG.logging.verbose = true;
  }

  // Determine mode
  let mode;
  if (CONFIG.ralph.enabled) {
    mode = 'RALPH';
  } else if (CONFIG.autoFix.enabled) {
    mode = 'AUTO-FIX';
  } else {
    mode = 'WATCH';
  }

  console.log(`\n🤖 Production QA Watcher v${version}`);
  console.log(`   Mode: ${mode}`);

  if (CONFIG.ralph.enabled) {
    console.log('   🔄 Autonomous loop mode - will fix until clean');
    console.log(`   Max cycles: ${CONFIG.ralph.maxCycles}`);
  } else if (CONFIG.autoFix.enabled) {
    console.log('   ⚠️  Auto-fix enabled - files will be modified!');
  } else {
    console.log('   Run with --fix to enable auto-fixing');
    console.log('   Run with --ralph for autonomous loop mode');
  }

  if (CONFIG.logging.debug) {
    console.log('   🐛 Debug mode enabled - detailed error output');
  }
  console.log('');

  // Load dependencies (chokidar only needed for watch mode)
  if (!CONFIG.ralph.enabled) {
    try {
      chokidar = require('chokidar');
    } catch (error) {
      log('Failed to load chokidar. Run: npm install', 'error');
      process.exit(1);
    }
  }

  try {
    notifier = require('node-notifier');
  } catch (error) {
    logVerbose('node-notifier not available (notifications disabled)');
    CONFIG.notifications.enabled = false;
  }

  // Load dashboard module (optional - for Ralph mode)
  if (CONFIG.ralph.enabled && CONFIG.dashboard.enabled) {
    try {
      dashboard = require('./dashboard-server');
      if (!dashboard.isAvailable()) {
        logVerbose('Dashboard dependencies not installed (express, ws)');
        dashboard = null;
      }
    } catch (error) {
      logVerbose('Dashboard module not available');
      dashboard = null;
    }
  }

  // Validate startup requirements (Claude CLI, skill file, log dir, watch paths)
  await validateStartup();

  // Load skill file (non-fatal, just logs info)
  loadSkillFile();

  // Handle shutdown
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);

  // Run Ralph Mode or Watcher Mode
  if (CONFIG.ralph.enabled) {
    await runRalphMode();
    process.exit(0);
  } else {
    setupWatcher();
  }
}

// Run
main().catch((error) => {
  logError(error, { action: 'main', fatal: true });
  process.exit(1);
});
