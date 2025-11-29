/**
 * GitHub App Authentication
 *
 * Handles JWT generation and installation token management
 */

import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

export class GitHubAppAuth {
  constructor() {
    this.appId = process.env.GITHUB_APP_ID;
    this.privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!this.appId || !this.privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
    }

    // Initialize the GitHub App
    this.app = new App({
      appId: this.appId,
      privateKey: this.privateKey,
    });

    // Cache for installation tokens
    this.tokenCache = new Map();
  }

  /**
   * Verify that the app credentials are valid
   */
  async verifyCredentials() {
    const octokit = await this.app.getInstallationOctokit(
      // Use any installation to verify, or just check the app itself
      undefined
    ).catch(() => null);

    // Try to get app info to verify credentials
    const appOctokit = new Octokit({
      auth: this.app.getSignedJsonWebToken(),
    });

    const { data: appInfo } = await appOctokit.apps.getAuthenticated();
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

    // Get new token
    const octokit = new Octokit({
      auth: this.app.getSignedJsonWebToken(),
    });

    const { data } = await octokit.apps.createInstallationAccessToken({
      installation_id: installationId,
    });

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
    const octokit = new Octokit({
      auth: this.app.getSignedJsonWebToken(),
    });

    const { data } = await octokit.apps.listInstallations();
    return data;
  }

  /**
   * Get installation by ID
   */
  async getInstallation(installationId) {
    const octokit = new Octokit({
      auth: this.app.getSignedJsonWebToken(),
    });

    const { data } = await octokit.apps.getInstallation({
      installation_id: installationId,
    });
    return data;
  }

  /**
   * Get repositories accessible to an installation
   */
  async getInstallationRepositories(installationId) {
    const octokit = await this.getInstallationOctokit(installationId);
    const { data } = await octokit.apps.listReposAccessibleToInstallation();
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
