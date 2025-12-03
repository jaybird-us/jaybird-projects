/**
 * GitHub OAuth Authentication Routes
 *
 * Handles user authentication via GitHub OAuth
 */

import { Router } from 'express';
import crypto from 'crypto';
import { saveOAuthToken } from '../lib/database.js';

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

const router = Router();

// GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GITHUB_OAUTH_URL = 'https://github.com/login/oauth';
const GITHUB_API_URL = 'https://api.github.com';

/**
 * Initiate GitHub OAuth flow
 */
router.get('/github', (req, res) => {
  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;

  // Store the origin for redirects after OAuth callback
  req.session.oauthOrigin = getBaseUrl(req);

  // Store return URL if provided
  if (req.query.returnTo) {
    req.session.returnTo = req.query.returnTo;
  }

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${req.session.oauthOrigin}/auth/github/callback`,
    scope: 'read:user user:email read:project read:org',
    state,
  });

  res.redirect(`${GITHUB_OAUTH_URL}/authorize?${params}`);
});

/**
 * GitHub OAuth callback
 */
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;

  // Get the stored origin for redirects (use current request as fallback)
  const origin = req.session.oauthOrigin || getBaseUrl(req);

  // Helper for redirects using the original origin
  const redirectTo = (path) => res.redirect(`${origin}${path}`);

  // Verify state for CSRF protection
  if (!state || state !== req.session.oauthState) {
    console.error('OAuth state mismatch');
    return redirectTo('/?error=invalid_state');
  }

  // Clear the state
  delete req.session.oauthState;

  if (!code) {
    console.error('No code provided');
    return redirectTo('/?error=no_code');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetchWithTimeout(`${GITHUB_OAUTH_URL}/access_token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('OAuth token error:', tokenData);
      return redirectTo('/?error=token_error');
    }

    const accessToken = tokenData.access_token;

    // Get user info
    const userResponse = await fetchWithTimeout(`${GITHUB_API_URL}/user`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    const user = await userResponse.json();

    // Store user in session
    req.session.user = {
      id: user.id,
      login: user.login,
      name: user.name,
      email: user.email,
      avatar_url: user.avatar_url,
    };
    req.session.accessToken = accessToken;

    // Save OAuth token to installations for webhook access
    try {
      const installationsResponse = await fetchWithTimeout(`${GITHUB_API_URL}/user/installations`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });
      const installationsData = await installationsResponse.json();

      console.log('[AUTH] User installations response:', JSON.stringify({
        total: installationsData.total_count,
        installations: installationsData.installations?.map(i => ({
          id: i.id,
          account: i.account?.login
        }))
      }));

      if (!installationsData.installations || installationsData.installations.length === 0) {
        console.log('[AUTH] No installations found for user');
      }

      for (const inst of installationsData.installations || []) {
        const result = saveOAuthToken(inst.id, accessToken);
        console.log(`[AUTH] Saved OAuth token for installation ${inst.id}, changes: ${result.changes}`);
      }
    } catch (tokenSaveError) {
      console.error('[AUTH] Failed to save OAuth token to installations:', tokenSaveError);
      // Continue anyway - the session token will still work for UI
    }

    // Redirect to app or stored return URL
    const returnTo = req.session.returnTo || '/app';
    delete req.session.returnTo;
    delete req.session.oauthOrigin;

    redirectTo(returnTo);
  } catch (error) {
    console.error('OAuth callback error:', error);
    redirectTo('/?error=oauth_error');
  }
});

/**
 * Check authentication status
 */
router.get('/status', (req, res) => {
  if (req.session.user) {
    res.json({
      authenticated: true,
      user: req.session.user,
    });
  } else {
    res.json({
      authenticated: false,
      user: null,
    });
  }
});

/**
 * Logout
 */
router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

/**
 * Get base URL from request, respecting forwarded headers for proxy support
 */
function getBaseUrl(req) {
  // Check for explicit APP_URL first (production)
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }

  // Use forwarded headers if behind a proxy (e.g., Vite dev server)
  const forwardedHost = req.get('X-Forwarded-Host');
  const forwardedProto = req.get('X-Forwarded-Proto') || req.protocol;

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  // Fallback to direct host
  return `${req.protocol}://${req.get('host')}`;
}

export default router;
