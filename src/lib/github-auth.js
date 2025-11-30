/**
 * GitHub App Authentication
 *
 * Handles JWT generation and installation token management
 * Updated for @octokit/app v14.x API
 */

import { App } from '@octokit/app';

export class GitHubAppAuth {
  constructor() {
    this.appId = process.env.GITHUB_APP_ID;
    let privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!this.appId || !privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
    }

    // Handle escaped newlines (Railway and other platforms may escape them)
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    this.privateKey = privateKey;

    // Initialize the GitHub App
    // In @octokit/app v14+, the App instance provides this.app.octokit for app-level auth
    this.app = new App({
      appId: this.appId,
      privateKey: this.privateKey,
    });

    // Cache for installation tokens
    this.tokenCache = new Map();
  }

  /**
   * Verify that the app credentials are valid
   * Uses this.app.octokit which is pre-authenticated as the GitHub App
   */
  async verifyCredentials() {
    // In @octokit/app v14+, use this.app.octokit for app-level API calls
    const { data: appInfo } = await this.app.octokit.request('GET /app');
    return appInfo;
  }

  /**
   * Get an authenticated Octokit instance for a specific installation
   */
  async getInstallationOctokit(installationId) {
    return await this.app.getInstallationOctokit(installationId);
  }

  /**
   * Get installation access token (cached with auto-refresh)
   */
  async getInstallationToken(installationId) {
    const cached = this.tokenCache.get(installationId);

    // Return cached token if it's still valid (with 5 minute buffer)
    if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
      return cached.token;
    }

    // Use app.octokit for app-level API calls
    const { data } = await this.app.octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      { installation_id: installationId }
    );

    // Cache the token
    this.tokenCache.set(installationId, {
      token: data.token,
      expiresAt: new Date(data.expires_at).getTime(),
    });

    return data.token;
  }

  /**
   * List all installations of this app
   */
  async listInstallations() {
    const { data } = await this.app.octokit.request('GET /app/installations');
    return data;
  }

  /**
   * Get installation by ID
   */
  async getInstallation(installationId) {
    const { data } = await this.app.octokit.request(
      'GET /app/installations/{installation_id}',
      { installation_id: installationId }
    );
    return data;
  }

  /**
   * Get repositories accessible to an installation
   */
  async getInstallationRepositories(installationId) {
    const octokit = await this.getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /installation/repositories');
    return data.repositories;
  }
}

// Singleton instance
let authInstance = null;

export function getGitHubAuth() {
  if (!authInstance) {
    authInstance = new GitHubAppAuth();
  }
  return authInstance;
}
