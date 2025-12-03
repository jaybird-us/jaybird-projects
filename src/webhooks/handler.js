/**
 * GitHub Webhook Handler
 *
 * Processes incoming webhooks from GitHub and triggers appropriate actions
 */

import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import {
  createInstallation,
  deleteInstallation,
  getInstallation,
  getInstallationSettings,
  createProject,
  updateSubscription,
  logAudit,
  getProjectByNodeId,
  getOAuthToken
} from '../lib/database.js';
import { ProjectFlowEngine } from '../lib/engine.js';
import { getSubscriptionStatus, PLAN_FEATURES } from '../lib/stripe.js';

/**
 * Verify webhook signature
 */
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) return false;

  const sig = Buffer.from(signature);
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(payload).digest('hex'));

  if (sig.length !== digest.length) return false;
  return crypto.timingSafeEqual(sig, digest);
}

/**
 * Create webhook handler middleware
 */
export function createWebhookHandler(logger) {
  return async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];

    logger.info({ event, deliveryId }, 'Received webhook');

    // Verify signature
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // Require webhook secret in production
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        logger.error({ deliveryId }, 'GITHUB_WEBHOOK_SECRET not configured in production');
        return res.status(500).json({ error: 'Server configuration error' });
      }
      logger.warn({ deliveryId }, 'GITHUB_WEBHOOK_SECRET not set - signature verification skipped');
    } else if (!verifySignature(req.body, signature, secret)) {
      logger.warn({ deliveryId }, 'Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(req.body.toString());
    } catch (error) {
      logger.error({ error }, 'Failed to parse webhook payload');
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Respond immediately (GitHub expects response within 10 seconds)
    res.status(200).json({ received: true });

    // Process event asynchronously
    try {
      await processWebhook(event, payload, logger);
    } catch (error) {
      logger.error({ error, event, deliveryId }, 'Failed to process webhook');
    }
  };
}

/**
 * Process webhook event
 */
async function processWebhook(event, payload, logger) {
  switch (event) {
    case 'installation':
      await handleInstallation(payload, logger);
      break;

    case 'installation_repositories':
      await handleInstallationRepositories(payload, logger);
      break;

    case 'issues':
      await handleIssues(payload, logger);
      break;

    case 'projects_v2_item':
      await handleProjectItem(payload, logger);
      break;

    default:
      logger.debug({ event }, 'Ignoring unhandled event');
  }
}

/**
 * Handle installation events
 */
async function handleInstallation(payload, logger) {
  const { action, installation } = payload;

  switch (action) {
    case 'created':
      logger.info({
        installationId: installation.id,
        account: installation.account.login
      }, 'App installed');

      createInstallation(
        installation.id,
        installation.account.login,
        installation.account.type
      );

      logAudit(installation.id, 'installation.created', {
        account: installation.account.login,
        repositories: payload.repositories?.length || 0
      });
      break;

    case 'deleted':
      logger.info({
        installationId: installation.id,
        account: installation.account.login
      }, 'App uninstalled');

      deleteInstallation(installation.id);

      logAudit(installation.id, 'installation.deleted', {
        account: installation.account.login
      });
      break;

    case 'suspend':
      logger.info({ installationId: installation.id }, 'Installation suspended');
      updateSubscription(installation.id, 'free', 'suspended', null);
      break;

    case 'unsuspend':
      logger.info({ installationId: installation.id }, 'Installation unsuspended');
      updateSubscription(installation.id, 'free', 'active', null);
      break;
  }
}

/**
 * Handle installation repository events
 */
async function handleInstallationRepositories(payload, logger) {
  const { action, installation, repositories_added, repositories_removed } = payload;

  if (action === 'added' && repositories_added) {
    logger.info({
      installationId: installation.id,
      added: repositories_added.length
    }, 'Repositories added to installation');
  }

  if (action === 'removed' && repositories_removed) {
    logger.info({
      installationId: installation.id,
      removed: repositories_removed.length
    }, 'Repositories removed from installation');
  }
}

/**
 * Handle issue events
 */
async function handleIssues(payload, logger) {
  const { action, issue, repository, installation } = payload;

  if (!installation) {
    logger.debug('Issue event without installation context');
    return;
  }

  const installationId = installation.id;
  const owner = repository.owner.login;
  const repo = repository.name;
  const issueNumber = issue.number;

  logger.info({
    action,
    installationId,
    owner,
    repo,
    issueNumber
  }, 'Issue event');

  try {
    // Get subscription to determine issue limit
    const settings = getInstallationSettings(installationId);
    const subscription = await getSubscriptionStatus(settings?.stripeCustomerId);
    const maxTrackedIssues = PLAN_FEATURES[subscription.plan].maxTrackedIssues;

    const engine = new ProjectFlowEngine(installationId, logger, { maxTrackedIssues });

    switch (action) {
      case 'closed':
        await engine.onIssueClosed(owner, repo, issueNumber);
        break;

      case 'reopened':
      case 'edited':
      case 'labeled':
      case 'unlabeled':
      case 'milestoned':
      case 'demilestoned':
        // Trigger recalculation for any significant change
        // The engine will find the right project
        const projects = (await import('../lib/database.js')).getProjectsByInstallation(installationId);
        for (const project of projects) {
          if (project.owner === owner) {
            await engine.recalculateAll(owner, project.project_number);
          }
        }
        break;
    }
  } catch (error) {
    logger.error({ error, action, issueNumber }, 'Failed to handle issue event');
  }
}

// Debounce and cooldown tracking for project recalculations
// Use LRU cache to prevent memory leaks with abandoned projects
const pendingRecalculations = new LRUCache({
  max: 500, // Max 500 pending recalculations
  ttl: 60 * 1000, // Auto-expire after 60 seconds
});

const recentlyRecalculated = new LRUCache({
  max: 500, // Track up to 500 projects in cooldown
  ttl: 10 * 1000, // Cooldown TTL (slightly longer than COOLDOWN_MS for safety)
});

const DEBOUNCE_MS = 1000; // Wait 1 second before recalculating
const COOLDOWN_MS = 5000; // Ignore webhooks for 5 seconds after recalculation

/**
 * Handle project item events with debouncing and cooldown
 */
async function handleProjectItem(payload, logger) {
  const { action, projects_v2_item, installation } = payload;

  if (!installation) {
    logger.debug('Project item event without installation context');
    return;
  }

  const projectNodeId = projects_v2_item?.project_node_id;

  // Trigger recalculation on any edit to a project item
  if (action === 'edited') {
    // Look up the project by its node ID
    const project = getProjectByNodeId(installation.id, projectNodeId);

    if (!project) {
      logger.debug({ projectNodeId }, 'Project not tracked');
      return;
    }

    const projectKey = `${installation.id}:${project.project_number}`;

    // Skip if in cooldown period (our own updates triggering webhooks)
    if (recentlyRecalculated.has(projectKey)) {
      logger.debug({ projectKey }, 'Skipping - in cooldown period');
      return;
    }

    // Clear any pending recalculation for this project
    if (pendingRecalculations.has(projectKey)) {
      clearTimeout(pendingRecalculations.get(projectKey));
    }

    // Schedule recalculation after debounce period
    const timeoutId = setTimeout(async () => {
      pendingRecalculations.delete(projectKey);

      try {
        const userToken = getOAuthToken(installation.id);

        logger.info({
          owner: project.owner,
          projectNumber: project.project_number
        }, 'Recalculating');

        const settings = getInstallationSettings(installation.id);
        const subscription = await getSubscriptionStatus(settings?.stripeCustomerId);
        const maxTrackedIssues = PLAN_FEATURES[subscription.plan].maxTrackedIssues;

        const engine = new ProjectFlowEngine(installation.id, logger, { maxTrackedIssues, userToken });
        const result = await engine.recalculateAll(project.owner, project.project_number);

        logger.info({
          updated: result.updated,
          skipped: result.skipped
        }, 'Recalculation done');

        // Set cooldown to ignore cascade webhooks from our updates
        recentlyRecalculated.set(projectKey, true);
        setTimeout(() => recentlyRecalculated.delete(projectKey), COOLDOWN_MS);

      } catch (error) {
        logger.error({ error: error.message }, 'Recalculation failed');
      }
    }, DEBOUNCE_MS);

    pendingRecalculations.set(projectKey, timeoutId);
  }
}
