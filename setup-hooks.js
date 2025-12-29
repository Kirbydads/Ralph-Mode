#!/usr/bin/env node
/**
 * QA Watcher - Pre-commit Hook Setup
 *
 * Installs a git pre-commit hook that runs QA checks on staged files.
 * The hook will block commits with critical issues (hardcoded secrets, etc.)
 * but allow commits with warnings (console.log, etc.)
 *
 * Usage: npm run qa-setup-hooks
 */

const fs = require('fs');
const path = require('path');

const IS_WINDOWS = process.platform === 'win32';

// Pre-commit hook content (shell script - works with Git Bash on Windows too)
const HOOK_CONTENT = `#!/bin/sh
# QA Watcher Pre-commit Hook
# Scans staged files for production issues before commit
# Bypass with: git commit --no-verify

# Get the directory where this hook is located
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$HOOK_DIR/../.." && pwd)"

# Run QA scan on staged files
node "$PROJECT_DIR/production-qa-watcher.js" --scan-staged

# Exit with the same code as the scan
exit $?
`;

function main() {
  console.log('🔧 QA Watcher - Pre-commit Hook Setup\n');

  // Check for .git directory
  const gitDir = path.join(process.cwd(), '.git');
  if (!fs.existsSync(gitDir)) {
    console.error('❌ Error: Not a git repository');
    console.error('   Run this command from a git repository root.');
    console.error('   Initialize with: git init');
    process.exit(1);
  }

  // Ensure hooks directory exists
  const hooksDir = path.join(gitDir, 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    console.log('   Created .git/hooks directory');
  }

  const hookPath = path.join(hooksDir, 'pre-commit');

  // Backup existing hook if present
  if (fs.existsSync(hookPath)) {
    const backupPath = hookPath + '.backup';
    fs.copyFileSync(hookPath, backupPath);
    console.log(`   Backed up existing hook to: pre-commit.backup`);
  }

  // Write the hook script
  fs.writeFileSync(hookPath, HOOK_CONTENT, { mode: 0o755 });

  // Make executable on Unix systems (Windows Git Bash handles this via shebang)
  if (!IS_WINDOWS) {
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch (err) {
      console.warn('   Warning: Could not set executable permission');
      console.warn('   You may need to run: chmod +x .git/hooks/pre-commit');
    }
  }

  console.log('✓ Pre-commit hook installed!\n');
  console.log('What happens now:');
  console.log('   1. Run "git commit" as normal');
  console.log('   2. Hook scans your staged .ts/.tsx/.js/.jsx files');
  console.log('   3. Critical issues (API keys, secrets) → commit blocked');
  console.log('   4. Warnings (console.log) → commit allowed with notice');
  console.log('   5. Scan errors → commit allowed (fails open)\n');
  console.log('Commands:');
  console.log('   Bypass once:  git commit --no-verify');
  console.log('   Remove hook:  rm .git/hooks/pre-commit');
  console.log('   Restore old:  mv .git/hooks/pre-commit.backup .git/hooks/pre-commit');
}

main();
