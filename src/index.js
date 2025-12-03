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
import cookieSession from 'cookie-session';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { pino } from 'pino';
import { createWebhookHandler } from './webhooks/handler.js';
import {
  initDatabase,
  createDocument,
  getDocument,
  getDocumentFile,
  getDocumentsByInstallation,
  updateDocument,
  deleteDocument,
  getDocumentVersions,
  toggleDocumentPinned,
  getDocumentCounts,
  getInstallation,
  getProjectsByInstallation,
  DOCUMENT_TYPES,
  createRisk,
  getRisk,
  getRisksByProject,
  updateRisk,
  deleteRisk,
  getRiskSummary,
  RISK_SEVERITIES,
  RISK_STATUSES
} from './lib/database.js';

// Configure multer for memory storage (files stored in SQLite blob)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
});
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
import authRoutes from './routes/auth.js';
import { ProjectFlowEngine } from './lib/engine.js';

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
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));

// Validate required secrets in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is required in production');
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    logger.warn('TOKEN_ENCRYPTION_KEY not set - using derived key from SESSION_SECRET');
  }
}

// Rate limiting (relaxed in development)
const isDev = process.env.NODE_ENV !== 'production';
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 1000 : 100, // 1000 in dev, 100 in production
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 webhook requests per minute per IP
  message: { error: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 auth attempts per 15 minutes
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Session middleware (for user auth)
app.use(cookieSession({
  name: 'jaybird_session',
  keys: [process.env.SESSION_SECRET || 'dev-session-secret-change-in-production'],
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
}));

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// GitHub webhook endpoint (raw body for signature verification)
app.post('/api/webhook',
  webhookLimiter,
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
      // Return generic error to client, log details server-side
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  }
);

// JSON parsing for other routes
app.use(express.json());

// Auth routes (with rate limiting)
app.use('/auth', authLimiter, authRoutes);

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// Input validation helpers
function validateInstallationId(req, res, next) {
  const id = parseInt(req.params.installationId);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid installation ID' });
  }
  req.installationId = id;
  next();
}

function validateProjectNumber(req, res, next) {
  const num = parseInt(req.params.projectNumber);
  if (isNaN(num) || num < 1) {
    return res.status(400).json({ error: 'Invalid project number' });
  }
  req.projectNumber = num;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session?.user || !req.session?.accessToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// Fetch with timeout helper
const FETCH_TIMEOUT_MS = 10000; // 10 seconds

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// API routes

// Get installations for the authenticated user
app.get('/api/installations', async (req, res) => {
  // If user is authenticated, return their installations
  if (req.session.user && req.session.accessToken) {
    try {
      // Get user's GitHub app installations
      const installationsResponse = await fetchWithTimeout('https://api.github.com/user/installations', {
        headers: {
          'Authorization': `Bearer ${req.session.accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!installationsResponse.ok) {
        throw new Error('Failed to fetch GitHub installations');
      }

      const { installations } = await installationsResponse.json();

      // Format for frontend
      const formatted = installations.map(inst => ({
        id: inst.id,
        account: {
          login: inst.account.login,
          type: inst.account.type,
          avatar_url: inst.account.avatar_url,
        },
        target_type: inst.target_type,
      }));

      return res.json(formatted);
    } catch (error) {
      logger.error({ error }, 'Failed to fetch user installations');
      return res.status(500).json({ error: 'Failed to fetch installations' });
    }
  }

  // Fallback for unauthenticated requests (for backwards compatibility)
  try {
    const { getInstallations } = await import('./lib/database.js');
    const installations = getInstallations();
    res.json({ installations });
  } catch (error) {
    logger.error({ error }, 'Failed to get installations');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Legacy: Get all installations (for backwards compatibility)
app.get('/api/installations/all', async (req, res) => {
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

// Get all GitHub Projects for an installation with tracking status
app.get('/api/installations/:installationId/projects', async (req, res) => {
  try {
    const { Octokit } = await import('@octokit/rest');
    const { getProjectsByInstallation, getInstallation } = await import('./lib/database.js');

    const installationId = parseInt(req.params.installationId);
    const installation = getInstallation(installationId);

    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Use the user's OAuth token (has project access) instead of GitHub App token
    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const octokit = new Octokit({ auth: userToken });

    // Fetch all ProjectsV2 from GitHub via GraphQL
    const accountType = installation.account_type;
    const accountLogin = installation.account_login;

    let projects = [];

    if (accountType === 'Organization') {
      // Fetch organization projects
      const query = `
        query($login: String!, $cursor: String) {
          organization(login: $login) {
            projectsV2(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                number
                title
                shortDescription
                url
                closed
                updatedAt
                items {
                  totalCount
                }
              }
            }
          }
        }
      `;

      let hasNextPage = true;
      let cursor = null;

      while (hasNextPage) {
        const result = await octokit.graphql(query, { login: accountLogin, cursor });
        const orgProjects = result.organization?.projectsV2;

        if (orgProjects?.nodes) {
          projects.push(...orgProjects.nodes.map(p => ({
            id: p.id,
            number: p.number,
            title: p.title,
            description: p.shortDescription,
            url: p.url,
            closed: p.closed,
            updatedAt: p.updatedAt,
            itemCount: p.items?.totalCount || 0,
            owner: accountLogin,
            ownerType: 'Organization'
          })));
        }

        hasNextPage = orgProjects?.pageInfo?.hasNextPage || false;
        cursor = orgProjects?.pageInfo?.endCursor;
      }
    } else {
      // Fetch user projects
      const query = `
        query($login: String!, $cursor: String) {
          user(login: $login) {
            projectsV2(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                number
                title
                shortDescription
                url
                closed
                updatedAt
                items {
                  totalCount
                }
              }
            }
          }
        }
      `;

      let hasNextPage = true;
      let cursor = null;

      while (hasNextPage) {
        const result = await octokit.graphql(query, { login: accountLogin, cursor });
        const userProjects = result.user?.projectsV2;

        if (userProjects?.nodes) {
          projects.push(...userProjects.nodes.map(p => ({
            id: p.id,
            number: p.number,
            title: p.title,
            description: p.shortDescription,
            url: p.url,
            closed: p.closed,
            updatedAt: p.updatedAt,
            itemCount: p.items?.totalCount || 0,
            owner: accountLogin,
            ownerType: 'User'
          })));
        }

        hasNextPage = userProjects?.pageInfo?.hasNextPage || false;
        cursor = userProjects?.pageInfo?.endCursor;
      }
    }

    // Get tracked projects from our database
    const trackedProjects = getProjectsByInstallation(installationId);
    const trackedProjectNumbers = new Set(trackedProjects.map(p => p.project_number));

    // Mark which projects are tracked
    const projectsWithStatus = projects.map(p => ({
      ...p,
      tracked: trackedProjectNumbers.has(p.number),
      trackedIssues: trackedProjects.find(tp => tp.project_number === p.number)?.tracked_issues || 0
    }));

    // Sort: tracked first, then by updated date
    projectsWithStatus.sort((a, b) => {
      if (a.tracked !== b.tracked) return b.tracked ? 1 : -1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    res.json(projectsWithStatus);
  } catch (error) {
    logger.error({ error }, 'Failed to fetch projects');
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Track a GitHub Project (add to database)
app.post('/api/installations/:installationId/projects/:projectNumber/track', async (req, res) => {
  try {
    const { Octokit } = await import('@octokit/rest');
    const { createProject, getInstallation } = await import('./lib/database.js');

    const installationId = parseInt(req.params.installationId);
    const projectNumber = parseInt(req.params.projectNumber);
    const installation = getInstallation(installationId);

    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Use the user's OAuth token for project access
    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const octokit = new Octokit({ auth: userToken });
    const accountLogin = installation.account_login;
    const accountType = installation.account_type;

    // Fetch project details from GitHub to get the project ID
    const ownerType = accountType === 'Organization' ? 'organization' : 'user';
    const query = `
      query($login: String!, $number: Int!) {
        ${ownerType}(login: $login) {
          projectV2(number: $number) {
            id
            title
          }
        }
      }
    `;

    const result = await octokit.graphql(query, { login: accountLogin, number: projectNumber });
    const project = result[ownerType]?.projectV2;

    if (!project) {
      return res.status(404).json({ error: 'Project not found on GitHub' });
    }

    // Save to database
    createProject(installationId, accountLogin, null, projectNumber, project.id);

    logger.info({ installationId, projectNumber, projectId: project.id }, 'Project tracked');

    res.json({
      success: true,
      project: {
        id: project.id,
        number: projectNumber,
        title: project.title,
        owner: accountLogin,
        tracked: true
      }
    });
  } catch (error) {
    logger.error({ error }, 'Failed to track project');
    res.status(500).json({ error: 'Failed to track project' });
  }
});

// Get project status updates (GitHub ProjectV2StatusUpdate)
app.get('/api/installations/:installationId/projects/:projectNumber/status-updates', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const { Octokit } = await import('@octokit/rest');

    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Use user's OAuth token for reading their projects
    const octokit = new Octokit({ auth: userToken });
    const accountLogin = installation.account_login;
    const accountType = installation.account_type;
    const ownerType = accountType === 'Organization' ? 'organization' : 'user';

    // GraphQL query for status updates
    // The creator field is an Actor interface, so we use inline fragments
    const query = `
      query($login: String!, $number: Int!) {
        ${ownerType}(login: $login) {
          projectV2(number: $number) {
            id
            statusUpdates(first: 10) {
              nodes {
                id
                body
                bodyHTML
                status
                createdAt
                startDate
                targetDate
                creator {
                  ... on User {
                    login
                    avatarUrl
                  }
                  ... on Bot {
                    login
                    avatarUrl
                  }
                }
              }
            }
          }
        }
      }
    `;

    logger.info({
      accountLogin,
      ownerType,
      projectNumber: parseInt(projectNumber)
    }, 'Fetching status updates');

    const result = await octokit.graphql(query, {
      login: accountLogin,
      number: parseInt(projectNumber)
    });

    logger.info({ result: JSON.stringify(result).substring(0, 200) }, 'GraphQL result received');

    const project = result[ownerType]?.projectV2;
    if (!project) {
      logger.warn({ result }, 'Project not found in response');
      return res.status(404).json({ error: 'Project not found' });
    }

    const statusUpdates = project.statusUpdates?.nodes || [];
    logger.info({ count: statusUpdates.length }, 'Status updates fetched');
    res.json(statusUpdates);
  } catch (error) {
    // GraphQL errors from Octokit have specific structure
    const errorDetails = {
      message: error.message,
      name: error.name,
      errors: error.errors, // GraphQL errors array
      data: error.data, // Partial data if any
      status: error.status,
      headers: error.headers
    };
    logger.error({
      error: errorDetails,
      installationId,
      projectNumber
    }, 'Failed to fetch status updates');
    // Return empty array instead of error to gracefully handle missing feature
    res.json([]);
  }
});

// Create a project status update (GitHub ProjectV2StatusUpdate)
app.post('/api/installations/:installationId/projects/:projectNumber/status-updates', async (req, res) => {
  const { installationId, projectNumber } = req.params;
  const { body, status, startDate, targetDate } = req.body;

  try {
    const { Octokit } = await import('@octokit/rest');

    // Validate required fields
    if (!body || !status) {
      return res.status(400).json({ error: 'Body and status are required' });
    }

    // Validate status value
    const validStatuses = ['INACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const octokit = new Octokit({ auth: userToken });
    const accountLogin = installation.account_login;
    const accountType = installation.account_type;
    const ownerType = accountType === 'Organization' ? 'organization' : 'user';

    // First, get the project ID
    const projectQuery = `
      query($login: String!, $number: Int!) {
        ${ownerType}(login: $login) {
          projectV2(number: $number) {
            id
          }
        }
      }
    `;

    const projectResult = await octokit.graphql(projectQuery, {
      login: accountLogin,
      number: parseInt(projectNumber)
    });

    const projectId = projectResult[ownerType]?.projectV2?.id;
    if (!projectId) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Create the status update
    const mutation = `
      mutation($input: CreateProjectV2StatusUpdateInput!) {
        createProjectV2StatusUpdate(input: $input) {
          statusUpdate {
            id
            body
            bodyHTML
            status
            createdAt
            startDate
            targetDate
            creator {
              ... on User {
                login
                avatarUrl
              }
            }
          }
        }
      }
    `;

    const input = {
      projectId,
      body,
      status
    };

    // Add optional date fields if provided
    if (startDate) input.startDate = startDate;
    if (targetDate) input.targetDate = targetDate;

    const result = await octokit.graphql(mutation, { input });

    const statusUpdate = result.createProjectV2StatusUpdate?.statusUpdate;
    if (!statusUpdate) {
      return res.status(500).json({ error: 'Failed to create status update' });
    }

    logger.info({
      installationId,
      projectNumber,
      statusUpdateId: statusUpdate.id
    }, 'Status update created');

    res.status(201).json(statusUpdate);
  } catch (error) {
    const errorDetails = {
      message: error.message,
      name: error.name,
      errors: error.errors,
      data: error.data
    };
    logger.error({
      error: errorDetails,
      installationId,
      projectNumber
    }, 'Failed to create status update');
    res.status(500).json({ error: error.message || 'Failed to create status update' });
  }
});

// Get commits since last status update for a project
app.get('/api/installations/:installationId/projects/:projectNumber/commits', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const { Octokit } = await import('@octokit/rest');
    const { getGitHubAuth } = await import('./lib/github-auth.js');

    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Use user token for GraphQL (projects API)
    const userOctokit = new Octokit({ auth: userToken });

    // Use installation token for commits API (requires Contents: Read permission on App)
    const auth = getGitHubAuth();
    const installationOctokit = await auth.getInstallationOctokit(parseInt(installationId));

    const accountLogin = installation.account_login;
    const accountType = installation.account_type;
    const ownerType = accountType === 'Organization' ? 'organization' : 'user';

    // First, get the last status update date and project items with their repositories
    const query = `
      query($login: String!, $number: Int!, $cursor: String) {
        ${ownerType}(login: $login) {
          projectV2(number: $number) {
            id
            statusUpdates(first: 1) {
              nodes {
                createdAt
              }
            }
            items(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                content {
                  ... on Issue {
                    repository {
                      owner { login }
                      name
                    }
                  }
                  ... on PullRequest {
                    repository {
                      owner { login }
                      name
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    // Fetch all items with pagination to get all unique repos
    const repos = new Set();
    let lastStatusUpdateDate = null;
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const result = await userOctokit.graphql(query, {
        login: accountLogin,
        number: parseInt(projectNumber),
        cursor
      });

      const projectData = result[ownerType]?.projectV2;
      if (!projectData) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Get the last status update date (only on first iteration)
      if (!lastStatusUpdateDate && projectData.statusUpdates?.nodes?.[0]) {
        lastStatusUpdateDate = projectData.statusUpdates.nodes[0].createdAt;
      }

      // Extract unique repositories
      for (const item of projectData.items?.nodes || []) {
        const repo = item.content?.repository;
        if (repo?.owner?.login && repo?.name) {
          repos.add(`${repo.owner.login}/${repo.name}`);
        }
      }

      hasNextPage = projectData.items?.pageInfo?.hasNextPage || false;
      cursor = projectData.items?.pageInfo?.endCursor;
    }

    // If no status update, use 7 days ago as default
    const sinceDate = lastStatusUpdateDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get the list of repos the installation actually has access to
    const accessibleRepos = new Set();
    try {
      const { data: installationRepos } = await installationOctokit.request('GET /installation/repositories', {
        per_page: 100
      });
      for (const repo of installationRepos.repositories || []) {
        accessibleRepos.add(repo.full_name);
      }
    } catch (error) {
      logger.warn({ error: error.message }, 'Failed to get installation repositories');
    }

    // Filter to only repos the installation can access
    const reposToFetch = Array.from(repos).filter(repo => accessibleRepos.has(repo));

    logger.info({
      installationId,
      projectNumber,
      projectRepos: Array.from(repos),
      accessibleRepos: Array.from(accessibleRepos),
      reposToFetch,
      sinceDate
    }, 'Fetching commits since last status update');

    // Fetch commits from each accessible repository
    const allCommits = [];

    for (const repoFullName of reposToFetch) {
      const [owner, repo] = repoFullName.split('/');
      try {
        // Use installation token (App permissions) to get commits
        const { data: commits } = await installationOctokit.request('GET /repos/{owner}/{repo}/commits', {
          owner,
          repo,
          since: sinceDate,
          per_page: 50
        });

        for (const commit of commits) {
          allCommits.push({
            sha: commit.sha,
            shortSha: commit.sha.substring(0, 7),
            message: commit.commit.message.split('\n')[0], // First line only
            author: {
              login: commit.author?.login || commit.commit.author?.name || 'Unknown',
              name: commit.commit.author?.name || commit.author?.login || 'Unknown',
              avatarUrl: commit.author?.avatar_url
            },
            date: commit.commit.author?.date || commit.commit.committer?.date,
            url: commit.html_url,
            repository: repoFullName
          });
        }
      } catch (error) {
        // Log but don't fail if one repo has issues
        logger.warn({ error: error.message, stack: error.stack, repo: repoFullName }, 'Failed to fetch commits from repo');
      }
    }

    // Sort by date descending
    allCommits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Limit total commits returned
    const limitedCommits = allCommits.slice(0, 100);

    logger.info({ count: limitedCommits.length }, 'Commits fetched');
    res.json({
      commits: limitedCommits,
      since: sinceDate,
      repositories: Array.from(repos)
    });
  } catch (error) {
    logger.error({
      error: error.message,
      installationId,
      projectNumber
    }, 'Failed to fetch commits');
    res.json({ commits: [], since: null, repositories: [] });
  }
});

// ============================================================
// Document Endpoints
// ============================================================

// Get document types
app.get('/api/document-types', (req, res) => {
  res.json(DOCUMENT_TYPES);
});

// List documents for an installation (optionally filtered by project, pinned, or recent)
app.get('/api/installations/:installationId/documents', async (req, res) => {
  const { installationId } = req.params;
  const { projectNumber, filter } = req.query;

  try {
    const documents = getDocumentsByInstallation(parseInt(installationId), {
      projectNumber: projectNumber ? parseInt(projectNumber) : null,
      filter: filter || null
    });
    res.json(documents);
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to fetch documents');
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get document counts for sidebar badges
app.get('/api/installations/:installationId/documents/counts', async (req, res) => {
  const { installationId } = req.params;

  try {
    const counts = getDocumentCounts(parseInt(installationId));
    res.json(counts);
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to fetch document counts');
    res.status(500).json({ error: 'Failed to fetch document counts' });
  }
});

// Create a new document (with optional file upload)
app.post('/api/installations/:installationId/documents', upload.single('file'), async (req, res) => {
  const { installationId } = req.params;
  const { title, type, content, projectNumber, linkedIssues, linkedMilestones, status } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'Title and type are required' });
  }

  if (!DOCUMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: `Invalid document type. Must be one of: ${DOCUMENT_TYPES.join(', ')}` });
  }

  try {
    const createdBy = req.session?.user?.login || null;

    // Handle file upload if present
    const fileData = req.file ? {
      fileData: req.file.buffer,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
    } : {};

    const documentId = createDocument(parseInt(installationId), {
      title,
      type,
      content: content || '',
      projectNumber: projectNumber ? parseInt(projectNumber) : null,
      linkedIssues: linkedIssues ? JSON.parse(linkedIssues) : [],
      linkedMilestones: linkedMilestones ? JSON.parse(linkedMilestones) : [],
      status: status || 'draft',
      createdBy,
      ...fileData
    });

    logger.info({ installationId, documentId, type, hasFile: !!req.file }, 'Document created');
    res.status(201).json({ id: documentId, success: true });
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to create document');
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// Get a single document
app.get('/api/installations/:installationId/documents/:documentId', async (req, res) => {
  const { installationId, documentId } = req.params;

  try {
    const document = getDocument(parseInt(documentId));

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Verify the document belongs to this installation
    if (document.installation_id !== parseInt(installationId)) {
      return res.status(403).json({ error: 'Document does not belong to this installation' });
    }

    res.json(document);
  } catch (error) {
    logger.error({ error, installationId, documentId }, 'Failed to fetch document');
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// Update a document (with optional file upload)
app.put('/api/installations/:installationId/documents/:documentId', upload.single('file'), async (req, res) => {
  const { installationId, documentId } = req.params;
  const { title, type, content, projectNumber, linkedIssues, linkedMilestones, status, changeSummary } = req.body;

  try {
    const document = getDocument(parseInt(documentId));

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.installation_id !== parseInt(installationId)) {
      return res.status(403).json({ error: 'Document does not belong to this installation' });
    }

    if (type && !DOCUMENT_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid document type. Must be one of: ${DOCUMENT_TYPES.join(', ')}` });
    }

    const updatedBy = req.session?.user?.login || null;

    // Handle file upload if present
    const fileData = req.file ? {
      fileData: req.file.buffer,
      fileName: req.file.originalname,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
    } : {};

    updateDocument(parseInt(documentId), {
      title,
      type,
      content,
      projectNumber: projectNumber !== undefined ? (projectNumber ? parseInt(projectNumber) : null) : undefined,
      linkedIssues: linkedIssues ? JSON.parse(linkedIssues) : undefined,
      linkedMilestones: linkedMilestones ? JSON.parse(linkedMilestones) : undefined,
      status,
      changeSummary,
      ...fileData
    }, updatedBy);

    logger.info({ installationId, documentId, hasFile: !!req.file }, 'Document updated');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error, installationId, documentId }, 'Failed to update document');
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// Delete a document
app.delete('/api/installations/:installationId/documents/:documentId', async (req, res) => {
  const { installationId, documentId } = req.params;

  try {
    const document = getDocument(parseInt(documentId));

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.installation_id !== parseInt(installationId)) {
      return res.status(403).json({ error: 'Document does not belong to this installation' });
    }

    deleteDocument(parseInt(documentId));

    logger.info({ installationId, documentId }, 'Document deleted');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error, installationId, documentId }, 'Failed to delete document');
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Get document version history
app.get('/api/installations/:installationId/documents/:documentId/versions', async (req, res) => {
  const { installationId, documentId } = req.params;

  try {
    const document = getDocument(parseInt(documentId));

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.installation_id !== parseInt(installationId)) {
      return res.status(403).json({ error: 'Document does not belong to this installation' });
    }

    const versions = getDocumentVersions(parseInt(documentId));
    res.json(versions);
  } catch (error) {
    logger.error({ error, installationId, documentId }, 'Failed to fetch document versions');
    res.status(500).json({ error: 'Failed to fetch document versions' });
  }
});

// Download document file
app.get('/api/installations/:installationId/documents/:documentId/download', async (req, res) => {
  const { installationId, documentId } = req.params;

  try {
    const document = getDocument(parseInt(documentId));

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.installation_id !== parseInt(installationId)) {
      return res.status(403).json({ error: 'Document does not belong to this installation' });
    }

    if (!document.file_name) {
      return res.status(404).json({ error: 'No file attached to this document' });
    }

    // Get the file data
    const fileRecord = getDocumentFile(parseInt(documentId));
    if (!fileRecord || !fileRecord.file_data) {
      return res.status(404).json({ error: 'File data not found' });
    }

    // Set response headers for file download/preview
    // Use ?inline=true for previewing in browser instead of downloading
    const isInline = req.query.inline === 'true';
    const disposition = isInline ? 'inline' : 'attachment';

    res.setHeader('Content-Type', fileRecord.file_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileRecord.file_name}"`);
    res.setHeader('Content-Length', fileRecord.file_size || fileRecord.file_data.length);

    // Send the file data
    res.send(fileRecord.file_data);
  } catch (error) {
    logger.error({ error, installationId, documentId }, 'Failed to download document file');
    res.status(500).json({ error: 'Failed to download document file' });
  }
});

// Toggle document pinned status
app.patch('/api/installations/:installationId/documents/:documentId/pin', async (req, res) => {
  const { installationId, documentId } = req.params;

  try {
    const document = getDocument(parseInt(documentId));

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (document.installation_id !== parseInt(installationId)) {
      return res.status(403).json({ error: 'Document does not belong to this installation' });
    }

    const pinned = toggleDocumentPinned(parseInt(documentId));
    logger.info({ installationId, documentId, pinned }, 'Document pin status toggled');
    res.json({ success: true, pinned });
  } catch (error) {
    logger.error({ error, installationId, documentId }, 'Failed to toggle document pin status');
    res.status(500).json({ error: 'Failed to toggle document pin status' });
  }
});

// ============================================================
// Risk Assessment Endpoint
// ============================================================

// Get risk assessment for a project
app.get('/api/installations/:installationId/projects/:projectNumber/risks', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });
    const riskReport = await engine.getRiskAssessment(
      installation.account_login,
      parseInt(projectNumber)
    );

    res.json(riskReport);
  } catch (error) {
    logger.error({ error, installationId, projectNumber }, 'Failed to get risk assessment');
    res.status(500).json({ error: 'Failed to get risk assessment' });
  }
});

// Get risk summary across all projects for an installation
app.get('/api/installations/:installationId/risks/summary', async (req, res) => {
  const { installationId } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projects = getProjectsByInstallation(parseInt(installationId));
    const projectRisks = [];
    const aggregateSummary = {
      total: 0,
      byLevel: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
      byType: {}
    };

    for (const project of projects) {
      try {
        const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });
        const riskReport = await engine.getRiskAssessment(
          project.owner,
          project.project_number
        );

        projectRisks.push({
          projectNumber: project.project_number,
          owner: project.owner,
          summary: riskReport.summary,
          topRisks: riskReport.items.filter(r => r.level === 'critical' || r.level === 'high').slice(0, 3)
        });

        // Aggregate
        aggregateSummary.total += riskReport.summary.total;
        for (const [level, count] of Object.entries(riskReport.summary.byLevel)) {
          aggregateSummary.byLevel[level] = (aggregateSummary.byLevel[level] || 0) + count;
        }
        for (const [type, count] of Object.entries(riskReport.summary.byType)) {
          aggregateSummary.byType[type] = (aggregateSummary.byType[type] || 0) + count;
        }
      } catch (err) {
        logger.warn({ err, project: project.project_number }, 'Failed to assess project risks');
      }
    }

    res.json({
      summary: aggregateSummary,
      projects: projectRisks
    });
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to get risk summary');
    res.status(500).json({ error: 'Failed to get risk summary' });
  }
});

// ============================================================
// Project Risks CRUD Endpoints (manual risk tracking)
// ============================================================

// Get all risks for a project
app.get('/api/installations/:installationId/projects/:projectNumber/project-risks', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const risks = getRisksByProject(parseInt(installationId), parseInt(projectNumber));
    const summary = getRiskSummary(parseInt(installationId), parseInt(projectNumber));

    res.json({ risks, summary });
  } catch (error) {
    logger.error({ error, installationId, projectNumber }, 'Failed to fetch project risks');
    res.status(500).json({ error: 'Failed to fetch project risks' });
  }
});

// Create a new risk
app.post('/api/installations/:installationId/projects/:projectNumber/project-risks', async (req, res) => {
  const { installationId, projectNumber } = req.params;
  const { title, description, severity, owner, mitigationPlan, linkedIssues } = req.body;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Title is required' });
    }

    if (severity && !RISK_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `Invalid severity. Must be one of: ${RISK_SEVERITIES.join(', ')}` });
    }

    const createdBy = req.session?.user?.login || null;
    const riskId = createRisk(parseInt(installationId), parseInt(projectNumber), {
      title: title.trim(),
      description: description?.trim() || null,
      severity: severity || 'medium',
      owner: owner?.trim() || null,
      mitigationPlan: mitigationPlan?.trim() || null,
      linkedIssues: linkedIssues || [],
      createdBy
    });

    const risk = getRisk(riskId);
    logger.info({ installationId, projectNumber, riskId }, 'Risk created');
    res.status(201).json(risk);
  } catch (error) {
    logger.error({ error, installationId, projectNumber }, 'Failed to create risk');
    res.status(500).json({ error: 'Failed to create risk' });
  }
});

// Get a single risk
app.get('/api/installations/:installationId/projects/:projectNumber/project-risks/:riskId', async (req, res) => {
  const { installationId, projectNumber, riskId } = req.params;

  try {
    const risk = getRisk(parseInt(riskId));

    if (!risk) {
      return res.status(404).json({ error: 'Risk not found' });
    }

    if (risk.installation_id !== parseInt(installationId) || risk.project_number !== parseInt(projectNumber)) {
      return res.status(403).json({ error: 'Risk does not belong to this project' });
    }

    res.json(risk);
  } catch (error) {
    logger.error({ error, installationId, projectNumber, riskId }, 'Failed to fetch risk');
    res.status(500).json({ error: 'Failed to fetch risk' });
  }
});

// Update a risk
app.put('/api/installations/:installationId/projects/:projectNumber/project-risks/:riskId', async (req, res) => {
  const { installationId, projectNumber, riskId } = req.params;
  const { title, description, severity, status, owner, mitigationPlan, linkedIssues } = req.body;

  try {
    const risk = getRisk(parseInt(riskId));

    if (!risk) {
      return res.status(404).json({ error: 'Risk not found' });
    }

    if (risk.installation_id !== parseInt(installationId) || risk.project_number !== parseInt(projectNumber)) {
      return res.status(403).json({ error: 'Risk does not belong to this project' });
    }

    if (severity && !RISK_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `Invalid severity. Must be one of: ${RISK_SEVERITIES.join(', ')}` });
    }

    if (status && !RISK_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${RISK_STATUSES.join(', ')}` });
    }

    const updatedBy = req.session?.user?.login || null;
    updateRisk(parseInt(riskId), {
      title: title?.trim(),
      description: description?.trim(),
      severity,
      status,
      owner: owner?.trim(),
      mitigationPlan: mitigationPlan?.trim(),
      linkedIssues
    }, updatedBy);

    const updatedRisk = getRisk(parseInt(riskId));
    logger.info({ installationId, projectNumber, riskId }, 'Risk updated');
    res.json(updatedRisk);
  } catch (error) {
    logger.error({ error, installationId, projectNumber, riskId }, 'Failed to update risk');
    res.status(500).json({ error: 'Failed to update risk' });
  }
});

// Delete a risk
app.delete('/api/installations/:installationId/projects/:projectNumber/project-risks/:riskId', async (req, res) => {
  const { installationId, projectNumber, riskId } = req.params;

  try {
    const risk = getRisk(parseInt(riskId));

    if (!risk) {
      return res.status(404).json({ error: 'Risk not found' });
    }

    if (risk.installation_id !== parseInt(installationId) || risk.project_number !== parseInt(projectNumber)) {
      return res.status(403).json({ error: 'Risk does not belong to this project' });
    }

    deleteRisk(parseInt(riskId));
    logger.info({ installationId, projectNumber, riskId }, 'Risk deleted');
    res.json({ success: true });
  } catch (error) {
    logger.error({ error, installationId, projectNumber, riskId }, 'Failed to delete risk');
    res.status(500).json({ error: 'Failed to delete risk' });
  }
});

// ============================================================
// Dependency Graph Endpoints
// ============================================================

// Get dependency graph for a project
app.get('/api/installations/:installationId/projects/:projectNumber/dependencies', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });
    const graphData = await engine.getDependencyGraph(
      installation.account_login,
      parseInt(projectNumber)
    );

    res.json(graphData);
  } catch (error) {
    logger.error({ error, installationId, projectNumber }, 'Failed to get dependency graph');
    res.status(500).json({ error: 'Failed to get dependency graph' });
  }
});

// ============================================================
// Executive Dashboard Endpoints
// ============================================================

// Get executive summary across all projects
app.get('/api/installations/:installationId/executive-summary', async (req, res) => {
  const { installationId } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projects = getProjectsByInstallation(parseInt(installationId));
    const summary = {
      projects: {
        total: projects.length,
        tracked: 0,
        byStatus: {
          open: 0,
          closed: 0
        }
      },
      items: {
        total: 0,
        byStatus: {
          todo: 0,
          inProgress: 0,
          done: 0,
          other: 0
        },
        completed: 0,
        remaining: 0
      },
      risks: {
        total: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        itemsAtRisk: 0
      },
      timeline: {
        onTrack: 0,
        behind: 0,
        ahead: 0,
        noBaseline: 0
      },
      projectDetails: []
    };

    // Gather data from each project
    for (const project of projects) {
      const projectData = {
        number: project.project_number,
        title: project.title || `Project #${project.project_number}`,
        owner: project.owner,
        items: { total: 0, completed: 0, remaining: 0 },
        risks: { critical: 0, high: 0, medium: 0, low: 0 },
        timeline: { onTrack: 0, behind: 0, ahead: 0 },
        health: 'good' // good, warning, critical
      };

      try {
        const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });

        // Get risk assessment
        const riskReport = await engine.getRiskAssessment(
          project.owner,
          project.project_number
        );

        // Get variance report
        const varianceReport = await engine.generateVarianceReport(
          project.owner,
          project.project_number
        );

        // Calculate items
        const items = Array.from(engine.projectItems.values());
        projectData.items.total = items.length;
        projectData.items.completed = items.filter(i => i.state === 'CLOSED' || i.status === 'Done').length;
        projectData.items.remaining = projectData.items.total - projectData.items.completed;

        // Aggregate item status
        for (const item of items) {
          if (item.state === 'CLOSED' || item.status === 'Done') {
            summary.items.byStatus.done++;
          } else if (item.status === 'In Progress') {
            summary.items.byStatus.inProgress++;
          } else if (item.status === 'Todo' || !item.status) {
            summary.items.byStatus.todo++;
          } else {
            summary.items.byStatus.other++;
          }
        }

        // Aggregate risks
        projectData.risks.critical = riskReport.summary.byLevel.critical;
        projectData.risks.high = riskReport.summary.byLevel.high;
        projectData.risks.medium = riskReport.summary.byLevel.medium;
        projectData.risks.low = riskReport.summary.byLevel.low;

        summary.risks.critical += projectData.risks.critical;
        summary.risks.high += projectData.risks.high;
        summary.risks.medium += projectData.risks.medium;
        summary.risks.low += projectData.risks.low;
        summary.risks.total += riskReport.summary.total;
        summary.risks.itemsAtRisk += riskReport.summary.byLevel.critical + riskReport.summary.byLevel.high;

        // Aggregate timeline
        projectData.timeline.onTrack = varianceReport.summary.onTrack;
        projectData.timeline.behind = varianceReport.summary.behind;
        projectData.timeline.ahead = varianceReport.summary.ahead;

        summary.timeline.onTrack += projectData.timeline.onTrack;
        summary.timeline.behind += projectData.timeline.behind;
        summary.timeline.ahead += projectData.timeline.ahead;
        summary.timeline.noBaseline += varianceReport.summary.noBaseline;

        // Aggregate items
        summary.items.total += projectData.items.total;
        summary.items.completed += projectData.items.completed;
        summary.items.remaining += projectData.items.remaining;

        // Determine project health
        if (projectData.risks.critical > 0 || projectData.timeline.behind > projectData.items.total * 0.3) {
          projectData.health = 'critical';
        } else if (projectData.risks.high > 0 || projectData.timeline.behind > 0) {
          projectData.health = 'warning';
        }

        summary.projectDetails.push(projectData);
        summary.projects.tracked++;

      } catch (err) {
        logger.warn({ err, project: project.project_number }, 'Failed to get project data for executive summary');
        // Still include the project with minimal data
        summary.projectDetails.push({
          ...projectData,
          error: 'Failed to load project data'
        });
      }
    }

    // Calculate project status
    summary.projects.byStatus.open = projects.filter(p => !p.closed_at).length;
    summary.projects.byStatus.closed = projects.length - summary.projects.byStatus.open;

    // Calculate overall health score (0-100)
    const healthFactors = {
      riskScore: summary.risks.itemsAtRisk > 0 ?
        Math.max(0, 100 - (summary.risks.critical * 20 + summary.risks.high * 10)) : 100,
      timelineScore: summary.items.total > 0 ?
        Math.round((summary.timeline.onTrack + summary.timeline.ahead) / Math.max(1, summary.timeline.onTrack + summary.timeline.behind + summary.timeline.ahead) * 100) : 100,
      completionScore: summary.items.total > 0 ?
        Math.round(summary.items.completed / summary.items.total * 100) : 0
    };

    summary.healthScore = Math.round(
      (healthFactors.riskScore * 0.4 + healthFactors.timelineScore * 0.4 + healthFactors.completionScore * 0.2)
    );

    res.json(summary);
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to get executive summary');
    res.status(500).json({ error: 'Failed to get executive summary' });
  }
});

// ============================================================
// Milestone/Release Planning Endpoints
// ============================================================

// Get milestones summary for a project
app.get('/api/installations/:installationId/projects/:projectNumber/milestones', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });
    const milestoneData = await engine.getMilestonesSummary(
      installation.account_login,
      parseInt(projectNumber)
    );

    res.json(milestoneData);
  } catch (error) {
    logger.error({ error, installationId, projectNumber }, 'Failed to get milestones');
    res.status(500).json({ error: 'Failed to get milestones' });
  }
});

// ============================================================
// Project Items Endpoint
// ============================================================

// Get all items for a project (for DataTable display)
app.get('/api/installations/:installationId/projects/:projectNumber/items', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const { Octokit } = await import('@octokit/rest');

    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const octokit = new Octokit({ auth: userToken });
    const accountLogin = installation.account_login;
    const accountType = installation.account_type;
    const ownerType = accountType === 'Organization' ? 'organization' : 'user';

    // GraphQL query to get all project items with full details
    const query = `
      query($login: String!, $number: Int!, $cursor: String) {
        ${ownerType}(login: $login) {
          projectV2(number: $number) {
            id
            items(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                content {
                  ... on Issue {
                    number
                    title
                    state
                    closedAt
                    url
                    issueType {
                      name
                    }
                    labels(first: 10) {
                      nodes {
                        name
                        color
                      }
                    }
                    milestone {
                      number
                      title
                    }
                    assignees(first: 10) {
                      nodes {
                        login
                        name
                        avatarUrl
                      }
                    }
                  }
                  ... on DraftIssue {
                    title
                  }
                }
                fieldValues(first: 20) {
                  nodes {
                    ... on ProjectV2ItemFieldDateValue {
                      field { ... on ProjectV2Field { name } }
                      date
                    }
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field { ... on ProjectV2SingleSelectField { name } }
                      name
                    }
                    ... on ProjectV2ItemFieldNumberValue {
                      field { ... on ProjectV2Field { name } }
                      number
                    }
                    ... on ProjectV2ItemFieldTextValue {
                      field { ... on ProjectV2Field { name } }
                      text
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    // Fetch all items with pagination
    const allItems = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const result = await octokit.graphql(query, {
        login: accountLogin,
        number: parseInt(projectNumber),
        cursor
      });

      const projectData = result[ownerType]?.projectV2;
      if (!projectData) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const items = projectData.items?.nodes || [];
      allItems.push(...items);

      hasNextPage = projectData.items?.pageInfo?.hasNextPage || false;
      cursor = projectData.items?.pageInfo?.endCursor;
    }

    // Transform items for the frontend
    const transformedItems = allItems
      .filter(item => item.content?.number) // Only include actual issues (not drafts)
      .map(item => {
        const content = item.content;
        const fieldValues = {};

        // Extract field values
        for (const fv of item.fieldValues.nodes) {
          if (!fv.field?.name) continue;
          const fieldName = fv.field.name;

          if (fv.date !== undefined) fieldValues[fieldName] = fv.date;
          if (fv.name !== undefined) fieldValues[fieldName] = fv.name;
          if (fv.number !== undefined) fieldValues[fieldName] = fv.number;
          if (fv.text !== undefined) fieldValues[fieldName] = fv.text;
        }

        // Determine item type - check native issueType, then project "Type" field, then labels
        const labels = content.labels?.nodes || [];
        let type = 'task'; // default

        // First check native GitHub issue type
        const issueTypeName = content.issueType?.name;
        if (issueTypeName) {
          const typeLower = issueTypeName.toLowerCase();
          if (typeLower === 'epic' || typeLower.includes('epic')) {
            type = 'epic';
          } else if (typeLower === 'bug' || typeLower.includes('bug')) {
            type = 'bug';
          } else if (typeLower === 'feature' || typeLower.includes('feature') || typeLower === 'enhancement') {
            type = 'feature';
          } else if (typeLower === 'story' || typeLower.includes('story')) {
            type = 'story';
          } else if (typeLower === 'task' || typeLower.includes('task')) {
            type = 'task';
          }
        } else {
          // Fall back to project "Type" field
          const typeFieldValue = fieldValues['Type'];
          if (typeFieldValue) {
            const typeLower = typeFieldValue.toLowerCase();
            if (typeLower === 'epic' || typeLower.includes('epic')) {
              type = 'epic';
            } else if (typeLower === 'bug' || typeLower.includes('bug')) {
              type = 'bug';
            } else if (typeLower === 'feature' || typeLower.includes('feature') || typeLower === 'enhancement') {
              type = 'feature';
            } else if (typeLower === 'story' || typeLower.includes('story')) {
              type = 'story';
            }
          } else {
            // Fall back to checking labels
            for (const label of labels) {
              const labelLower = label.name.toLowerCase();
              if (labelLower === 'epic' || labelLower.includes('epic')) {
                type = 'epic';
                break;
              } else if (labelLower === 'bug' || labelLower.includes('bug')) {
                type = 'bug';
                break;
              } else if (labelLower === 'feature' || labelLower.includes('feature') || labelLower === 'enhancement') {
                type = 'feature';
                break;
              } else if (labelLower === 'story' || labelLower.includes('story')) {
                type = 'story';
                break;
              }
            }
          }
        }

        // Use closedAt if no Actual End Date
        let actualEndDate = fieldValues['Actual End Date'];
        if (!actualEndDate && content.closedAt) {
          actualEndDate = content.closedAt.split('T')[0];
        }

        // Parse % Complete
        let percentComplete = 0;
        if (fieldValues['% Complete']) {
          const match = String(fieldValues['% Complete']).match(/(\d+)/);
          if (match) {
            percentComplete = parseInt(match[1]);
          }
        }

        return {
          id: item.id,
          issueNumber: content.number,
          type,
          title: content.title,
          url: content.url,
          state: content.state,
          assignees: (content.assignees?.nodes || []).map(a => ({
            login: a.login,
            name: a.name || a.login,
            avatarUrl: a.avatarUrl
          })),
          status: fieldValues['Status'] || (content.state === 'CLOSED' ? 'Done' : 'Todo'),
          estimate: fieldValues['Estimate'],
          startDate: fieldValues['Start Date'],
          targetDate: fieldValues['Target Date'],
          actualEndDate,
          percentComplete,
          milestone: content.milestone?.title || 'No Milestone',
          milestoneNumber: content.milestone?.number,
          labels: labels.map(l => ({ name: l.name, color: l.color }))
        };
      });

    logger.info({
      installationId,
      projectNumber,
      itemCount: transformedItems.length
    }, 'Project items fetched');

    res.json(transformedItems);
  } catch (error) {
    const errorDetails = {
      message: error.message,
      name: error.name,
      errors: error.errors
    };
    logger.error({
      error: errorDetails,
      installationId,
      projectNumber
    }, 'Failed to fetch project items');
    res.status(500).json({ error: 'Failed to fetch project items' });
  }
});

// ============================================================
// Resource Allocation Endpoints
// ============================================================

// Get resource allocation for a project
app.get('/api/installations/:installationId/projects/:projectNumber/resources', async (req, res) => {
  const { installationId, projectNumber } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });
    const resourceData = await engine.getResourceAllocation(
      installation.account_login,
      parseInt(projectNumber)
    );

    res.json(resourceData);
  } catch (error) {
    logger.error({ error, installationId, projectNumber }, 'Failed to get resource allocation');
    res.status(500).json({ error: 'Failed to get resource allocation' });
  }
});

// Get resource allocation summary across all projects
app.get('/api/installations/:installationId/resources/summary', async (req, res) => {
  const { installationId } = req.params;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    const userToken = req.session?.accessToken;
    if (!userToken) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const projects = getProjectsByInstallation(parseInt(installationId));
    const allResources = new Map();
    let totalUnassigned = 0;

    for (const project of projects) {
      try {
        const engine = new ProjectFlowEngine(parseInt(installationId), logger, { userToken });
        const resourceData = await engine.getResourceAllocation(
          project.owner,
          project.project_number
        );

        totalUnassigned += resourceData.summary.unassignedItems;

        // Merge resources
        for (const resource of resourceData.resources) {
          if (!allResources.has(resource.login)) {
            allResources.set(resource.login, {
              ...resource,
              projects: []
            });
          }

          const existing = allResources.get(resource.login);
          existing.totalItems += resource.totalItems;
          existing.completedItems += resource.completedItems;
          existing.totalDays += resource.totalDays;
          existing.remainingDays += resource.remainingDays;
          existing.items = [...existing.items, ...resource.items];
          existing.projects.push({
            number: project.project_number,
            title: project.title,
            items: resource.totalItems,
            remainingDays: resource.remainingDays
          });
        }
      } catch (err) {
        logger.warn({ err, project: project.project_number }, 'Failed to get project resources');
      }
    }

    // Recalculate workload levels
    const normalCapacityDays = 50;
    const normalCapacityItems = 5;

    for (const [login, data] of allResources) {
      const openItems = data.totalItems - data.completedItems;

      if (data.remainingDays > normalCapacityDays * 1.5 || openItems > normalCapacityItems * 1.5) {
        data.workload = 'overloaded';
      } else if (data.remainingDays > normalCapacityDays || openItems > normalCapacityItems) {
        data.workload = 'high';
      } else if (data.remainingDays < normalCapacityDays * 0.3 && openItems < normalCapacityItems * 0.5) {
        data.workload = 'low';
      } else {
        data.workload = 'normal';
      }
    }

    const resources = Array.from(allResources.values())
      .sort((a, b) => b.remainingDays - a.remainingDays);

    res.json({
      resources,
      summary: {
        totalAssignees: resources.length,
        unassignedItems: totalUnassigned,
        byWorkload: {
          overloaded: resources.filter(r => r.workload === 'overloaded').length,
          high: resources.filter(r => r.workload === 'high').length,
          normal: resources.filter(r => r.workload === 'normal').length,
          low: resources.filter(r => r.workload === 'low').length
        }
      }
    });
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to get resource summary');
    res.status(500).json({ error: 'Failed to get resource summary' });
  }
});

// Export executive summary as CSV
app.get('/api/installations/:installationId/executive-summary/export', async (req, res) => {
  const { installationId } = req.params;
  const { format = 'csv' } = req.query;

  try {
    const installation = getInstallation(parseInt(installationId));
    if (!installation) {
      return res.status(404).json({ error: 'Installation not found' });
    }

    // Fetch summary data
    const summaryResponse = await fetch(`http://localhost:${process.env.PORT || 3000}/api/installations/${installationId}/executive-summary`);
    const summary = await summaryResponse.json();

    if (format === 'csv') {
      // Generate CSV
      const rows = [
        ['Executive Summary Report', new Date().toISOString()],
        [],
        ['Overall Metrics'],
        ['Health Score', summary.healthScore],
        ['Total Projects', summary.projects.total],
        ['Total Items', summary.items.total],
        ['Completed', summary.items.completed],
        ['Remaining', summary.items.remaining],
        [],
        ['Risk Summary'],
        ['Critical', summary.risks.critical],
        ['High', summary.risks.high],
        ['Medium', summary.risks.medium],
        ['Low', summary.risks.low],
        [],
        ['Timeline Summary'],
        ['On Track', summary.timeline.onTrack],
        ['Behind', summary.timeline.behind],
        ['Ahead', summary.timeline.ahead],
        [],
        ['Project Details'],
        ['Project', 'Total Items', 'Completed', 'Critical Risks', 'High Risks', 'Behind Schedule', 'Health']
      ];

      for (const project of summary.projectDetails) {
        rows.push([
          project.title,
          project.items.total,
          project.items.completed,
          project.risks.critical,
          project.risks.high,
          project.timeline.behind,
          project.health
        ]);
      }

      const csv = rows.map(row => row.join(',')).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="executive-summary-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Unsupported format. Use csv.' });
    }
  } catch (error) {
    logger.error({ error, installationId }, 'Failed to export executive summary');
    res.status(500).json({ error: 'Failed to export executive summary' });
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
      successUrl: `${baseUrl}/app/settings?checkout=success`,
      cancelUrl: `${baseUrl}/app/settings?checkout=canceled`
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
    res.redirect(`/app/settings?installation_id=${installationId}&welcome=true`);

  } else if (setup_action === 'update') {
    // Permissions were updated
    res.redirect('/app/settings?updated=true');
  } else {
    // Unknown action, redirect to home
    res.redirect('/');
  }
});

// Serve static files for web UI
if (process.env.ENABLE_WEB_UI !== 'false') {
  // Serve React app from client/dist (built with Vite)
  app.use(express.static('client/dist'));

  // Also serve legacy public files (for privacy, terms, etc.)
  app.use(express.static('public'));

  // SPA fallback - serve React app for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) {
      // First try to serve from client/dist (React app)
      res.sendFile('index.html', { root: 'client/dist' }, (err) => {
        if (err) {
          // Fall back to public/index.html (legacy landing page)
          res.sendFile('index.html', { root: 'public' });
        }
      });
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
