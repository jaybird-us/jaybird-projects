/**
 * jayBird Projects - Professional scheduling for GitHub Projects
 *
 * A GitHub App by jayBird (https://jaybird.us)
 * Created by Jeremy Paxton (@jeremy-paxton)
 *
 * Features:
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
import {
  createCheckoutSession,
  createPortalSession,
  getSubscriptionStatus,
  handleWebhookEvent,
  verifyWebhookSignature,
  PRICE_ID,
  PLAN_FEATURES
} from './lib/stripe.js';

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

// Stripe webhook endpoint (raw body for signature verification)
app.post('/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['stripe-signature'];

    try {
      const event = verifyWebhookSignature(req.body, signature);
      await handleWebhookEvent(event, logger);
      res.json({ received: true });
    } catch (error) {
      logger.error({ error: error.message }, 'Stripe webhook error');
      res.status(400).json({ error: error.message });
    }
  }
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

// Admin endpoint to seed installations (for recovery after data loss)
app.post('/api/admin/seed-installation', async (req, res) => {
  // Simple shared secret auth
  const adminSecret = process.env.ADMIN_SECRET;
  const authHeader = req.headers.authorization;

  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { installationId, accountLogin, accountType } = req.body;

  if (!installationId || !accountLogin) {
    return res.status(400).json({ error: 'Missing required fields: installationId, accountLogin' });
  }

  try {
    const { createInstallation } = await import('./lib/database.js');
    createInstallation(installationId, accountLogin, accountType || 'Organization');
    logger.info({ installationId, accountLogin }, 'Installation seeded via admin endpoint');
    res.json({ success: true, installationId, accountLogin });
  } catch (error) {
    logger.error({ error }, 'Failed to seed installation');
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to seed projects (for recovery after data loss)
app.post('/api/admin/seed-project', async (req, res) => {
  // Simple shared secret auth
  const adminSecret = process.env.ADMIN_SECRET;
  const authHeader = req.headers.authorization;

  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { installationId, owner, repo, projectNumber, projectId, setupFields = true } = req.body;

  if (!installationId || !owner || !projectNumber || !projectId) {
    return res.status(400).json({ error: 'Missing required fields: installationId, owner, projectNumber, projectId' });
  }

  try {
    const { createProject, getInstallationSettings } = await import('./lib/database.js');
    createProject(installationId, owner, repo || null, projectNumber, projectId);
    logger.info({ installationId, owner, projectNumber }, 'Project seeded via admin endpoint');

    // Auto-setup fields if requested
    let fieldResult = null;
    if (setupFields) {
      const { getGitHubAuth } = await import('./lib/github-auth.js');
      const { ensureProjectFields } = await import('./lib/project-fields.js');

      const auth = getGitHubAuth();
      const octokit = await auth.getInstallationOctokit(installationId);

      // Check if Pro for additional fields
      const settings = getInstallationSettings(installationId);
      const subscription = await getSubscriptionStatus(settings?.stripeCustomerId);
      const includePro = subscription.plan === 'pro';

      fieldResult = await ensureProjectFields(octokit, projectId, logger, { includePro });
    }

    res.json({
      success: true,
      installationId,
      owner,
      projectNumber,
      fields: fieldResult
    });
  } catch (error) {
    logger.error({ error }, 'Failed to seed project');
    res.status(500).json({ error: error.message });
  }
});

// Setup project fields endpoint
app.post('/api/installations/:installationId/projects/:projectId/setup-fields', async (req, res) => {
  try {
    const { getInstallationSettings, getProject } = await import('./lib/database.js');
    const { getGitHubAuth } = await import('./lib/github-auth.js');
    const { ensureProjectFields, REQUIRED_FIELDS } = await import('./lib/project-fields.js');

    const installationId = parseInt(req.params.installationId);
    const projectId = req.params.projectId;

    // Get subscription to determine if Pro fields should be created
    const settings = getInstallationSettings(installationId);
    const subscription = await getSubscriptionStatus(settings?.stripeCustomerId);
    const includePro = subscription.plan === 'pro';

    // Get authenticated Octokit
    const auth = getGitHubAuth();
    const octokit = await auth.getInstallationOctokit(installationId);

    // Ensure fields exist
    const result = await ensureProjectFields(octokit, projectId, logger, { includePro });

    logger.info({
      installationId,
      projectId,
      created: result.createdFields,
      existing: result.existingFields
    }, 'Project fields setup complete');

    res.json({
      success: true,
      ...result,
      requiredFields: Object.keys(REQUIRED_FIELDS).filter(f => !REQUIRED_FIELDS[f].pro || includePro)
    });
  } catch (error) {
    logger.error({ error }, 'Failed to setup project fields');
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger endpoints
app.post('/api/installations/:installationId/recalculate', async (req, res) => {
  try {
    const { getInstallationSettings, getProject } = await import('./lib/database.js');
    const installationId = parseInt(req.params.installationId);
    const { owner, projectNumber, setupFields = true } = req.body;

    if (!owner || !projectNumber) {
      return res.status(400).json({ error: 'Missing required fields: owner, projectNumber' });
    }

    // Get subscription to determine issue limit and Pro features
    const settings = getInstallationSettings(installationId);
    const subscription = await getSubscriptionStatus(settings?.stripeCustomerId);
    const maxTrackedIssues = PLAN_FEATURES[subscription.plan].maxTrackedIssues;
    const includePro = subscription.plan === 'pro';

    // Auto-setup fields if requested (default true)
    let fieldResult = null;
    if (setupFields) {
      const project = getProject(installationId, owner, parseInt(projectNumber));
      if (project?.project_id) {
        const { getGitHubAuth } = await import('./lib/github-auth.js');
        const { ensureProjectFields } = await import('./lib/project-fields.js');

        const auth = getGitHubAuth();
        const octokit = await auth.getInstallationOctokit(installationId);
        fieldResult = await ensureProjectFields(octokit, project.project_id, logger, { includePro });

        if (fieldResult.createdFields.length > 0) {
          logger.info({ createdFields: fieldResult.createdFields }, 'Auto-created missing project fields');
        }
      }
    }

    const { ProjectFlowEngine } = await import('./lib/engine.js');
    const engine = new ProjectFlowEngine(installationId, logger, { maxTrackedIssues });
    await engine.recalculateAll(owner, parseInt(projectNumber));

    res.json({
      success: true,
      message: 'Recalculation complete',
      limitReached: engine.limitReached,
      totalItems: engine.totalItemsFound,
      processedItems: engine.projectItems.size,
      fieldsCreated: fieldResult?.createdFields || []
    });
  } catch (error) {
    logger.error({ error }, 'Failed to recalculate');
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/installations/:installationId/save-baseline', async (req, res) => {
  try {
    const { getInstallationSettings } = await import('./lib/database.js');
    const installationId = parseInt(req.params.installationId);

    // Check subscription - baselines require Pro
    const settings = getInstallationSettings(installationId);
    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const subscription = await getSubscriptionStatus(settings.stripeCustomerId);
    if (subscription.plan !== 'pro') {
      return res.status(403).json({
        error: 'Baseline tracking requires a Pro subscription',
        upgrade: true
      });
    }

    const { owner, projectNumber } = req.body;
    if (!owner || !projectNumber) {
      return res.status(400).json({ error: 'Missing required fields: owner, projectNumber' });
    }

    const { ProjectFlowEngine } = await import('./lib/engine.js');
    const engine = new ProjectFlowEngine(installationId, logger);
    const result = await engine.saveBaseline(owner, parseInt(projectNumber));
    res.json({ success: true, saved: result.saved });
  } catch (error) {
    logger.error({ error }, 'Failed to save baseline');
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/installations/:installationId/variance-report', async (req, res) => {
  try {
    const { getInstallationSettings } = await import('./lib/database.js');
    const installationId = parseInt(req.params.installationId);

    // Check subscription - variance reports require Pro
    const settings = getInstallationSettings(installationId);
    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const subscription = await getSubscriptionStatus(settings.stripeCustomerId);
    if (subscription.plan !== 'pro') {
      return res.status(403).json({
        error: 'Variance reports require a Pro subscription',
        upgrade: true
      });
    }

    const { owner, projectNumber } = req.query;
    if (!owner || !projectNumber) {
      return res.status(400).json({ error: 'Missing required query params: owner, projectNumber' });
    }

    const { ProjectFlowEngine } = await import('./lib/engine.js');
    const engine = new ProjectFlowEngine(installationId, logger);
    const report = await engine.generateVarianceReport(owner, parseInt(projectNumber));
    res.json(report);
  } catch (error) {
    logger.error({ error }, 'Failed to generate variance report');
    res.status(500).json({ error: error.message });
  }
});

// Billing routes
app.get('/api/billing/prices', (req, res) => {
  res.json({
    priceId: PRICE_ID,
    features: PLAN_FEATURES,
    price: 900, // $9.00 in cents
    trialDays: 14
  });
});

app.get('/api/installations/:installationId/subscription', async (req, res) => {
  try {
    const { getInstallationSettings } = await import('./lib/database.js');
    const settings = getInstallationSettings(parseInt(req.params.installationId));

    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const subscription = await getSubscriptionStatus(settings.stripeCustomerId);
    res.json({
      ...subscription,
      features: PLAN_FEATURES[subscription.plan]
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get subscription');
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/installations/:installationId/checkout', async (req, res) => {
  try {
    const installationId = parseInt(req.params.installationId);
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    const session = await createCheckoutSession({
      installationId,
      successUrl: `${baseUrl}/settings.html?checkout=success`,
      cancelUrl: `${baseUrl}/settings.html?checkout=canceled`
    });

    res.json({ url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create checkout session');
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/installations/:installationId/portal', async (req, res) => {
  try {
    const { getInstallationSettings } = await import('./lib/database.js');
    const settings = getInstallationSettings(parseInt(req.params.installationId));

    if (!settings?.stripeCustomerId) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    const session = await createPortalSession({
      customerId: settings.stripeCustomerId,
      returnUrl: baseUrl
    });

    res.json({ url: session.url });
  } catch (error) {
    logger.error({ error }, 'Failed to create portal session');
    res.status(500).json({ error: error.message });
  }
});

// Holidays API endpoints
app.get('/api/installations/:installationId/holidays', async (req, res) => {
  try {
    const { getHolidays, getInstallationSettings } = await import('./lib/database.js');
    const installationId = parseInt(req.params.installationId);

    const settings = getInstallationSettings(installationId);
    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Check subscription status
    const subscription = await getSubscriptionStatus(settings.stripeCustomerId);
    const hasActiveSubscription = subscription.plan === 'pro';

    const holidays = getHolidays(installationId);
    res.json({
      holidays,
      canEdit: hasActiveSubscription
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get holidays');
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/installations/:installationId/holidays', async (req, res) => {
  try {
    const { addHoliday, getInstallationSettings, logAudit } = await import('./lib/database.js');
    const installationId = parseInt(req.params.installationId);

    // Check subscription - custom holidays require active subscription
    const settings = getInstallationSettings(installationId);
    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Check if user has active subscription
    const subscription = await getSubscriptionStatus(settings.stripeCustomerId);
    if (subscription.plan !== 'pro') {
      return res.status(403).json({ error: 'Custom holidays require an active subscription' });
    }

    const { date, name, recurring } = req.body;
    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    addHoliday(installationId, date, name || '', recurring || false);
    logAudit(installationId, 'holiday.added', { date, name, recurring });

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to add holiday');
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/installations/:installationId/holidays/:date', async (req, res) => {
  try {
    const { removeHoliday, getInstallationSettings, logAudit } = await import('./lib/database.js');
    const installationId = parseInt(req.params.installationId);

    // Check subscription
    const settings = getInstallationSettings(installationId);
    if (!settings) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Check if user has active subscription
    const subscription = await getSubscriptionStatus(settings.stripeCustomerId);
    if (subscription.plan !== 'pro') {
      return res.status(403).json({ error: 'Custom holidays require an active subscription' });
    }

    const date = req.params.date;
    removeHoliday(installationId, date);
    logAudit(installationId, 'holiday.removed', { date });

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, 'Failed to remove holiday');
    res.status(500).json({ error: error.message });
  }
});

// GitHub App setup callback (after installation)
// New installs start on free tier - they can upgrade later
app.get('/setup', async (req, res) => {
  const { installation_id, setup_action } = req.query;

  logger.info({ installation_id, setup_action }, 'Setup callback received');

  if (setup_action === 'install' && installation_id) {
    const installationId = parseInt(installation_id);
    logger.info({ installationId }, 'New installation - starting on free tier');
    // Redirect to settings with welcome message
    res.redirect(`/settings.html?installation_id=${installationId}&welcome=true`);

  } else if (setup_action === 'update') {
    // Permissions were updated
    res.redirect('/settings.html?updated=true');
  } else {
    // Unknown action, redirect to home
    res.redirect('/');
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

    // Verify GitHub App credentials (non-fatal if fails)
    try {
      const auth = new GitHubAppAuth();
      await auth.verifyCredentials();
      logger.info({ appId: process.env.GITHUB_APP_ID }, 'GitHub App credentials verified');
    } catch (authError) {
      logger.warn({ error: authError.message }, 'GitHub App credential verification failed - webhooks may not work until credentials are fixed');
    }

    // Start server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      logger.info({ port }, 'jayBird Projects server started');
      logger.info('Webhook URL: POST /api/webhook');
      logger.info('Health check: GET /health');
    });
  } catch (error) {
    logger.fatal({ error: error.message, stack: error.stack }, 'Failed to start server');
    process.exit(1);
  }
}

start();
