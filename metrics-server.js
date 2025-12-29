#!/usr/bin/env node
/**
 * Standalone Metrics Server for QA Watcher
 *
 * Starts a web server to view QA metrics without running Ralph mode.
 * Usage: npm run qa-metrics
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

// Optional dependencies
let express;
try {
  express = require('express');
} catch (e) {
  console.error('❌ Express not installed. Run: npm install express');
  process.exit(1);
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_PORT = 3000;
const MAX_PORT_RETRIES = 10;

// Load config for port
let config = { dashboard: { port: DEFAULT_PORT, autoOpen: true } };
const configPath = path.join(process.cwd(), '.qawatch.json');
if (fs.existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
  } catch (e) {
    // Use defaults
  }
}

// ============================================================================
// SERVER
// ============================================================================

function startMetricsServer(port, attempt = 1) {
  const app = express();

  // Serve static files including the dashboard
  app.use(express.static(path.join(__dirname, 'public')));

  // Metrics API endpoint
  app.get('/api/metrics', (req, res) => {
    const metricsPath = path.join(process.cwd(), 'qa-reviews', 'metrics.json');
    try {
      if (fs.existsSync(metricsPath)) {
        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
        res.json(metrics);
      } else {
        res.json({
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
        });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Serve metrics page
  app.get('/metrics', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'metrics.html'));
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', mode: 'metrics-only' });
  });

  const server = http.createServer(app);

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      if (attempt < MAX_PORT_RETRIES) {
        console.log(`⚠️  Port ${port} in use, trying ${port + 1}...`);
        startMetricsServer(port + 1, attempt + 1);
      } else {
        console.error(`❌ Could not find available port after ${MAX_PORT_RETRIES} attempts`);
        process.exit(1);
      }
    } else {
      console.error('❌ Server error:', error.message);
      process.exit(1);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/metrics`;
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                 📊 QA Watcher Metrics Server               ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  Server running at: ${url.padEnd(38)}║`);
    console.log('║                                                            ║');
    console.log('║  Press Ctrl+C to stop                                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    // Auto-open browser if configured
    if (config.dashboard?.autoOpen !== false) {
      const platform = process.platform;
      let openCmd;
      if (platform === 'win32') {
        openCmd = `start "" "${url}"`;
      } else if (platform === 'darwin') {
        openCmd = `open "${url}"`;
      } else {
        openCmd = `xdg-open "${url}"`;
      }

      exec(openCmd, (err) => {
        if (err) {
          console.log(`📋 Open manually: ${url}`);
        }
      });
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down metrics server...');
    server.close(() => {
      process.exit(0);
    });
  });
}

// ============================================================================
// MAIN
// ============================================================================

console.log('🚀 Starting QA Watcher Metrics Server...');
startMetricsServer(config.dashboard?.port || DEFAULT_PORT);
