/**
 * ProjectFlow - MS Project-style scheduling for GitHub Projects
 *
 * A GitHub App that provides:
 * - Automatic date calculations based on dependencies
 * - Estimate → working days conversion
 * - Confidence → buffer days calculation
 * - Baseline tracking and variance analysis
 * - Milestone and parent task roll-ups
 * - Past-due date adjustments
 */

import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { pino } from 'pino';
import { createWebhookHandler } from './webhooks/handler.js';
import { initDatabase } from './lib/database.js';
import { GitHubAppAuth } from './lib/github-auth.js';

// Logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
});

// Express app
const app = express();

// Security middleware
app.use(helmet());

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// GitHub webhook endpoint (raw body for signature verification)
app.post('/api/webhook',
  express.raw({ type: 'application/json' }),
  createWebhookHandler(logger)
);

// JSON parsing for other routes
app.use(express.json());

// API routes
app.get('/api/installations', async (req, res) => {
  try {
    const { getInstallations } = await import('./lib/database.js');
    const installations = getInstallations();
    res.json({ installations });
  } catch (error) {
    logger.error({ error }, 'Failed to get installations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Installation settings
app.get('/api/installations/:installationId/settings', async (req, res) => {
  try {
    const { getInstallationSettings } = await import('./lib/database.js');
    const settings = getInstallationSettings(parseInt(req.params.installationId));
    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }
    res.json(settings);
  } catch (error) {
    logger.error({ error }, 'Failed to get installation settings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/installations/:installationId/settings', async (req, res) => {
  try {
    const { updateInstallationSettings } = await import('./lib/database.js');
    updateInstallationSettings(parseInt(req.params.installationId), req.body);
    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to update installation settings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual trigger endpoints
app.post('/api/installations/:installationId/recalculate', async (req, res) => {
  try {
    const { ProjectFlowEngine } = await import('./lib/engine.js');
    const engine = new ProjectFlowEngine(parseInt(req.params.installationId), logger);
    await engine.recalculateAll();
    res.json({ success: true, message: 'Recalculation complete' });
  } catch (error) {
    logger.error({ error }, 'Failed to recalculate');
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/installations/:installationId/save-baseline', async (req, res) => {
  try {
    const { ProjectFlowEngine } = await import('./lib/engine.js');
    const engine = new ProjectFlowEngine(parseInt(req.params.installationId), logger);
    const result = await engine.saveBaseline();
    res.json({ success: true, saved: result.saved });
  } catch (error) {
    logger.error({ error }, 'Failed to save baseline');
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/installations/:installationId/variance-report', async (req, res) => {
  try {
    const { ProjectFlowEngine } = await import('./lib/engine.js');
    const engine = new ProjectFlowEngine(parseInt(req.params.installationId), logger);
    const report = await engine.generateVarianceReport();
    res.json(report);
  } catch (error) {
    logger.error({ error }, 'Failed to generate variance report');
    res.status(500).json({ error: error.message });
  }
});

// Serve static files for web UI
if (process.env.ENABLE_WEB_UI !== 'false') {
  app.use(express.static('public'));

  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile('index.html', { root: 'public' });
    }
  });
}

// Error handler
app.use((err, req, res, next) => {
  logger.error({ error: err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  try {
    // Initialize database
    await initDatabase();
    logger.info('Database initialized');

    // Verify GitHub App credentials
    const auth = new GitHubAppAuth();
    await auth.verifyCredentials();
    logger.info({ appId: process.env.GITHUB_APP_ID }, 'GitHub App credentials verified');

    // Start server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      logger.info({ port }, 'ProjectFlow server started');
      logger.info('Webhook URL: POST /api/webhook');
      logger.info('Health check: GET /health');
    });
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
