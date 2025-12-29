/**
 * Real-Time Dashboard Server for Ralph Mode
 *
 * Provides a web-based dashboard with live updates via WebSocket
 * to visualize Ralph mode's progress through detection → fixing → completed states.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

// Optional dependencies - dashboard is optional feature
let express, WebSocket;
try {
  express = require('express');
  WebSocket = require('ws');
} catch (e) {
  // Dependencies not installed - dashboard won't work
}

// ============================================================================
// STATE
// ============================================================================

let app = null;
let server = null;
let wss = null;
let clients = new Set();
let isRunning = false;
let currentPort = 3000;

// Ralph state - synced to clients on connect
let ralphState = {
  started: false,
  cycle: 0,
  maxCycles: 10,
  budgetHard: 20,
  totalCost: 0,
  startTime: null,
  issues: new Map(),      // id -> issue object
  fixing: new Set(),      // issue ids currently being fixed
  completed: new Set(),   // issue ids that are done
  logs: []                // recent log entries
};

// ============================================================================
// SERVER SETUP
// ============================================================================

/**
 * Start the dashboard server
 * @param {Object} options - Configuration options
 * @param {number} options.port - Port to listen on (default: 3000)
 * @returns {Promise<number>} - The port the server is running on
 */
async function startDashboard(options = {}) {
  if (!express || !WebSocket) {
    console.warn('[Dashboard] Dependencies not installed. Run: npm install express ws');
    return null;
  }

  if (isRunning) {
    return currentPort;
  }

  const startPort = options.port || 3000;
  const maxRetries = 5;

  // Helper to try starting on a specific port
  function tryPort(port, attempt) {
    return new Promise((resolve, reject) => {
      try {
        app = express();

        // Serve static files from public directory
        app.use(express.static(path.join(__dirname, 'public')));

        // Health check endpoint
        app.get('/health', (req, res) => {
          res.json({ status: 'ok', clients: clients.size });
        });

        // Metrics API endpoint
        app.get('/api/metrics', (req, res) => {
          const metricsPath = path.join(process.cwd(), 'qa-reviews', 'metrics.json');
          try {
            if (fs.existsSync(metricsPath)) {
              const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
              res.json(metrics);
            } else {
              // Return empty metrics structure if no data yet
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

        // Create HTTP server
        server = http.createServer(app);

        // Handle server errors BEFORE listening
        server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            if (attempt < maxRetries) {
              console.log(`[Dashboard] Port ${port} in use, trying ${port + 1}`);
              // Close this server instance and try next port
              server.close();
              resolve(tryPort(port + 1, attempt + 1));
            } else {
              reject(new Error(`All ports ${startPort}-${port} in use`));
            }
          } else {
            reject(error);
          }
        });

        server.listen(port, () => {
          currentPort = port;

          // Create WebSocket server only after HTTP server is listening
          wss = new WebSocket.Server({ server });

          wss.on('connection', (ws) => {
            clients.add(ws);
            console.log(`[Dashboard] Client connected (${clients.size} total)`);

            // Send connected acknowledgment
            ws.send(JSON.stringify({
              type: 'connected',
              timestamp: new Date().toISOString()
            }));

            // Send current Ralph state so client can catch up
            if (ralphState.started) {
              ws.send(JSON.stringify({
                type: 'state_sync',
                data: getSerializableState(),
                timestamp: new Date().toISOString()
              }));
              console.log(`[Dashboard] Sent state_sync: ${ralphState.issues.size} issues, ${ralphState.completed.size} completed`);
            }

            ws.on('close', () => {
              clients.delete(ws);
              console.log(`[Dashboard] Client disconnected (${clients.size} total)`);
            });

            ws.on('error', (error) => {
              console.error('[Dashboard] WebSocket error:', error.message);
              clients.delete(ws);
            });
          });

          isRunning = true;
          console.log(`[Dashboard] Server running at http://127.0.0.1:${port}`);
          resolve(port);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  return tryPort(startPort, 1);
}

/**
 * Stop the dashboard server gracefully
 */
async function stopDashboard() {
  if (!isRunning) return;

  return new Promise((resolve) => {
    // Close all WebSocket connections
    clients.forEach(ws => {
      try {
        ws.send(JSON.stringify({ type: 'server_shutdown' }));
        ws.close();
      } catch (e) {
        // Ignore errors on close
      }
    });
    clients.clear();

    // Close WebSocket server
    if (wss) {
      wss.close(() => {
        console.log('[Dashboard] WebSocket server closed');
      });
    }

    // Close HTTP server
    if (server) {
      server.close(() => {
        console.log('[Dashboard] HTTP server closed');
        isRunning = false;
        resolve();
      });

      // Force close after timeout
      setTimeout(() => {
        isRunning = false;
        resolve();
      }, 2000);
    } else {
      isRunning = false;
      resolve();
    }
  });
}

/**
 * Update internal state based on event
 * @param {string} eventName - Name of the event
 * @param {Object} data - Event data
 */
function updateRalphState(eventName, data) {
  switch (eventName) {
    case 'ralph_started':
      ralphState.started = true;
      ralphState.maxCycles = data.maxCycles || 10;
      ralphState.budgetHard = data.budgetHard || 20;
      ralphState.startTime = Date.now();
      ralphState.cycle = 0;
      ralphState.totalCost = 0;
      ralphState.issues.clear();
      ralphState.fixing.clear();
      ralphState.completed.clear();
      ralphState.logs = [];
      break;

    case 'cycle_started':
      ralphState.cycle = data.cycle;
      ralphState.maxCycles = data.maxCycles;
      break;

    case 'detection_complete':
      // Clear previous issues, add new ones
      ralphState.issues.clear();
      ralphState.fixing.clear();
      if (data.issues) {
        data.issues.forEach(issue => {
          const id = issue.id || `${issue.file}:${issue.line}`;
          if (!ralphState.completed.has(id)) {
            ralphState.issues.set(id, { ...issue, id, status: 'detected' });
          }
        });
      }
      if (data.cost) {
        ralphState.totalCost += data.cost;
      }
      break;

    case 'fix_started':
      if (data.issueIds) {
        data.issueIds.forEach(id => {
          ralphState.fixing.add(id);
          const issue = ralphState.issues.get(id);
          if (issue) {
            issue.status = 'fixing';
            issue.progress = 0;
          }
        });
      }
      break;

    case 'fix_progress':
      ralphState.issues.forEach((issue, id) => {
        if (issue.file === data.file && ralphState.fixing.has(id)) {
          issue.progress = data.progress;
        }
      });
      break;

    case 'fix_complete':
      if (data.fixed) {
        data.fixed.forEach(id => {
          ralphState.fixing.delete(id);
          ralphState.completed.add(id);
          ralphState.issues.delete(id);
        });
      }
      if (data.failed) {
        data.failed.forEach(id => {
          ralphState.fixing.delete(id);
          const issue = ralphState.issues.get(id);
          if (issue) issue.status = 'failed';
        });
      }
      break;

    case 'cost_update':
      ralphState.totalCost = data.totalCost || ralphState.totalCost;
      break;

    case 'cycle_complete':
      ralphState.totalCost = data.cost || ralphState.totalCost;
      break;

    case 'ralph_complete':
      ralphState.totalCost = data.totalCost || ralphState.totalCost;
      break;

    case 'log_entry':
      ralphState.logs.push({
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        message: data.message,
        level: data.level || 'info'
      });
      if (ralphState.logs.length > 100) ralphState.logs.shift();
      break;
  }
}

/**
 * Get serializable state for sending to clients
 * @returns {Object} - Serializable state object
 */
function getSerializableState() {
  return {
    started: ralphState.started,
    cycle: ralphState.cycle,
    maxCycles: ralphState.maxCycles,
    budgetHard: ralphState.budgetHard,
    totalCost: ralphState.totalCost,
    startTime: ralphState.startTime,
    issues: Array.from(ralphState.issues.values()),
    fixing: Array.from(ralphState.fixing),
    completed: Array.from(ralphState.completed),
    logs: ralphState.logs
  };
}

/**
 * Emit an event to all connected clients
 * @param {string} eventName - Name of the event
 * @param {Object} data - Event data
 */
function emitEvent(eventName, data) {
  // Update internal state first
  updateRalphState(eventName, data);

  if (!isRunning) return;

  const message = JSON.stringify({
    type: eventName,
    data: data,
    timestamp: new Date().toISOString()
  });

  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
      } catch (e) {
        console.error('[Dashboard] Error sending to client:', e.message);
        clients.delete(ws);
      }
    }
  });
}

/**
 * Open the dashboard in the default browser
 * @param {number} port - Port the server is running on
 */
function openDashboardInBrowser(port = currentPort) {
  const url = `http://127.0.0.1:${port}`;

  // Cross-platform browser open
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;

  exec(command, (error) => {
    if (error) {
      console.log(`[Dashboard] Could not open browser: ${error.message}`);
      console.log(`[Dashboard] Open manually: ${url}`);
    }
  });
}

/**
 * Check if dependencies are available
 * @returns {boolean}
 */
function isAvailable() {
  return !!(express && WebSocket);
}

/**
 * Get current server status
 * @returns {Object}
 */
function getStatus() {
  return {
    running: isRunning,
    port: currentPort,
    clients: clients.size,
    available: isAvailable()
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  startDashboard,
  stopDashboard,
  emitEvent,
  openDashboardInBrowser,
  isAvailable,
  getStatus
};
