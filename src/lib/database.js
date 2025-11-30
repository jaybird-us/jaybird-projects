/**
 * Database for ProjectFlow
 *
 * Uses SQLite for simplicity and portability
 * Stores:
 * - Installation configurations (org, repos, settings)
 * - Custom holidays per installation
 * - Field ID mappings per project
 * - Billing/subscription status
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

let db = null;

/**
 * Initialize the database
 */
export async function initDatabase() {
  const dbPath = process.env.DATABASE_PATH || './data/projectflow.db';

  // Ensure directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    -- Installations table (one per GitHub App installation)
    CREATE TABLE IF NOT EXISTS installations (
      id INTEGER PRIMARY KEY,
      installation_id INTEGER UNIQUE NOT NULL,
      account_login TEXT NOT NULL,
      account_type TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

      -- Subscription tier: 'free', 'pro', 'enterprise'
      tier TEXT DEFAULT 'free',
      subscription_status TEXT DEFAULT 'active',
      subscription_expires_at TEXT,

      -- Stripe billing
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,

      -- Global settings
      settings_json TEXT DEFAULT '{}'
    );

    -- Projects table (GitHub Projects we're tracking)
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      installation_id INTEGER NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT,
      project_number INTEGER NOT NULL,
      project_id TEXT NOT NULL,

      -- Field IDs for this project
      start_date_field_id TEXT,
      target_date_field_id TEXT,
      actual_end_date_field_id TEXT,
      baseline_start_field_id TEXT,
      baseline_target_field_id TEXT,
      estimate_field_id TEXT,
      confidence_field_id TEXT,
      percent_complete_field_id TEXT,
      status_field_id TEXT,

      -- Settings specific to this project
      settings_json TEXT DEFAULT '{}',

      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (installation_id) REFERENCES installations(installation_id),
      UNIQUE(installation_id, owner, project_number)
    );

    -- Holidays table (custom holidays per installation)
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY,
      installation_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      name TEXT,
      recurring INTEGER DEFAULT 0,

      FOREIGN KEY (installation_id) REFERENCES installations(installation_id),
      UNIQUE(installation_id, date)
    );

    -- Audit log for tracking changes
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      installation_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (installation_id) REFERENCES installations(installation_id)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_installations_installation_id ON installations(installation_id);
    CREATE INDEX IF NOT EXISTS idx_projects_installation_id ON projects(installation_id);
    CREATE INDEX IF NOT EXISTS idx_holidays_installation_id ON holidays(installation_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_installation_id ON audit_log(installation_id);
  `);

  return db;
}

/**
 * Get database instance
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ============================================================
// Installation CRUD
// ============================================================

export function createInstallation(installationId, accountLogin, accountType) {
  const stmt = getDatabase().prepare(`
    INSERT INTO installations (installation_id, account_login, account_type)
    VALUES (?, ?, ?)
    ON CONFLICT(installation_id) DO UPDATE SET
      account_login = excluded.account_login,
      account_type = excluded.account_type,
      updated_at = CURRENT_TIMESTAMP
  `);
  return stmt.run(installationId, accountLogin, accountType);
}

export function getInstallation(installationId) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM installations WHERE installation_id = ?
  `);
  const row = stmt.get(installationId);
  if (row && row.settings_json) {
    row.settings = JSON.parse(row.settings_json);
  }
  return row;
}

export function getInstallations() {
  const stmt = getDatabase().prepare(`SELECT * FROM installations`);
  return stmt.all().map(row => {
    if (row.settings_json) {
      row.settings = JSON.parse(row.settings_json);
    }
    return row;
  });
}

export function deleteInstallation(installationId) {
  const stmt = getDatabase().prepare(`
    DELETE FROM installations WHERE installation_id = ?
  `);
  return stmt.run(installationId);
}

export function getInstallationSettings(installationId) {
  const installation = getInstallation(installationId);
  if (!installation) return null;

  // Default settings
  const defaults = {
    workingDaysOnly: true,
    weekendDays: [0, 6], // Sunday, Saturday
    defaultBufferDays: 1,
    estimateDays: {
      'XS': 2,
      'S': 5,
      'M': 10,
      'L': 15,
      'XL': 25,
      'XXL': 40
    },
    confidenceBuffer: {
      'High': 0,
      'Medium': 2,
      'Low': 5
    }
  };

  return {
    ...defaults,
    ...installation.settings,
    stripeCustomerId: installation.stripe_customer_id,
    stripeSubscriptionId: installation.stripe_subscription_id,
    tier: installation.tier,
    subscriptionStatus: installation.subscription_status
  };
}

export function updateInstallationSettings(installationId, settings) {
  const stmt = getDatabase().prepare(`
    UPDATE installations
    SET settings_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE installation_id = ?
  `);
  return stmt.run(JSON.stringify(settings), installationId);
}

// ============================================================
// Project CRUD
// ============================================================

export function createProject(installationId, owner, repo, projectNumber, projectId) {
  const stmt = getDatabase().prepare(`
    INSERT INTO projects (installation_id, owner, repo, project_number, project_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(installation_id, owner, project_number) DO UPDATE SET
      repo = excluded.repo,
      project_id = excluded.project_id,
      updated_at = CURRENT_TIMESTAMP
  `);
  return stmt.run(installationId, owner, repo, projectNumber, projectId);
}

export function getProject(installationId, owner, projectNumber) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM projects
    WHERE installation_id = ? AND owner = ? AND project_number = ?
  `);
  const row = stmt.get(installationId, owner, projectNumber);
  if (row && row.settings_json) {
    row.settings = JSON.parse(row.settings_json);
  }
  return row;
}

export function getProjectsByInstallation(installationId) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM projects WHERE installation_id = ?
  `);
  return stmt.all(installationId).map(row => {
    if (row.settings_json) {
      row.settings = JSON.parse(row.settings_json);
    }
    return row;
  });
}

export function updateProjectFieldIds(installationId, owner, projectNumber, fieldIds) {
  const stmt = getDatabase().prepare(`
    UPDATE projects SET
      start_date_field_id = ?,
      target_date_field_id = ?,
      actual_end_date_field_id = ?,
      baseline_start_field_id = ?,
      baseline_target_field_id = ?,
      estimate_field_id = ?,
      confidence_field_id = ?,
      percent_complete_field_id = ?,
      status_field_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE installation_id = ? AND owner = ? AND project_number = ?
  `);
  return stmt.run(
    fieldIds.startDate,
    fieldIds.targetDate,
    fieldIds.actualEndDate,
    fieldIds.baselineStart,
    fieldIds.baselineTarget,
    fieldIds.estimate,
    fieldIds.confidence,
    fieldIds.percentComplete,
    fieldIds.status,
    installationId, owner, projectNumber
  );
}

// ============================================================
// Holidays CRUD
// ============================================================

export function getHolidays(installationId) {
  const stmt = getDatabase().prepare(`
    SELECT date, name, recurring FROM holidays WHERE installation_id = ?
  `);
  return stmt.all(installationId);
}

export function addHoliday(installationId, date, name, recurring = false) {
  const stmt = getDatabase().prepare(`
    INSERT INTO holidays (installation_id, date, name, recurring)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(installation_id, date) DO UPDATE SET
      name = excluded.name,
      recurring = excluded.recurring
  `);
  return stmt.run(installationId, date, name, recurring ? 1 : 0);
}

export function removeHoliday(installationId, date) {
  const stmt = getDatabase().prepare(`
    DELETE FROM holidays WHERE installation_id = ? AND date = ?
  `);
  return stmt.run(installationId, date);
}

// ============================================================
// Audit Log
// ============================================================

export function logAudit(installationId, action, details) {
  const stmt = getDatabase().prepare(`
    INSERT INTO audit_log (installation_id, action, details_json)
    VALUES (?, ?, ?)
  `);
  return stmt.run(installationId, action, JSON.stringify(details));
}

export function getAuditLog(installationId, limit = 100) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM audit_log
    WHERE installation_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(installationId, limit).map(row => {
    if (row.details_json) {
      row.details = JSON.parse(row.details_json);
    }
    return row;
  });
}

// ============================================================
// Subscription/Billing
// ============================================================

export function updateSubscription(installationId, tier, status, expiresAt) {
  const stmt = getDatabase().prepare(`
    UPDATE installations SET
      tier = ?,
      subscription_status = ?,
      subscription_expires_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE installation_id = ?
  `);
  return stmt.run(tier, status, expiresAt, installationId);
}

export function getSubscription(installationId) {
  const stmt = getDatabase().prepare(`
    SELECT tier, subscription_status, subscription_expires_at
    FROM installations WHERE installation_id = ?
  `);
  return stmt.get(installationId);
}

/**
 * Update installation subscription from Stripe webhook
 */
export function updateInstallationSubscription(installationId, data) {
  const updates = [];
  const values = [];

  if (data.stripeCustomerId !== undefined) {
    updates.push('stripe_customer_id = ?');
    values.push(data.stripeCustomerId);
  }
  if (data.stripeSubscriptionId !== undefined) {
    updates.push('stripe_subscription_id = ?');
    values.push(data.stripeSubscriptionId);
  }
  if (data.plan !== undefined) {
    updates.push('tier = ?');
    values.push(data.plan);
  }
  if (data.subscriptionStatus !== undefined) {
    updates.push('subscription_status = ?');
    values.push(data.subscriptionStatus);
  }

  if (updates.length === 0) return;

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(installationId);

  const stmt = getDatabase().prepare(`
    UPDATE installations SET ${updates.join(', ')}
    WHERE installation_id = ?
  `);

  return stmt.run(...values);
}
