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
import crypto from 'crypto';

let db = null;

// ============================================================
// Encryption utilities for sensitive data
// ============================================================

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment (must be 32 bytes for AES-256)
 * Falls back to a derived key in development
 */
function getEncryptionKey() {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (key) {
    // If provided, ensure it's 32 bytes
    return crypto.createHash('sha256').update(key).digest();
  }
  // Development fallback - derive from session secret or use default
  const fallback = process.env.SESSION_SECRET || 'dev-encryption-key-not-for-production';
  return crypto.createHash('sha256').update(fallback).digest();
}

/**
 * Encrypt a string value
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string value
 */
function decrypt(encryptedValue) {
  if (!encryptedValue) return null;

  try {
    const parts = encryptedValue.split(':');
    if (parts.length !== 3) {
      // Might be an unencrypted legacy token
      return encryptedValue;
    }

    const [ivHex, authTagHex, encrypted] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // If decryption fails, might be a legacy unencrypted token
    console.warn('Token decryption failed, returning as-is (may be legacy token)');
    return encryptedValue;
  }
}

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

      -- OAuth token for project access (encrypted in production)
      oauth_token TEXT,

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

    -- Project documents table
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      installation_id INTEGER NOT NULL,
      project_number INTEGER,

      -- Document metadata
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT DEFAULT '',

      -- Ownership and tracking
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

      -- Optional linking to issues/milestones
      linked_issues TEXT,
      linked_milestones TEXT,

      -- Status and versioning
      status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,

      FOREIGN KEY (installation_id) REFERENCES installations(installation_id)
    );

    -- Document versions table (for history)
    CREATE TABLE IF NOT EXISTS document_versions (
      id INTEGER PRIMARY KEY,
      document_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      changed_by TEXT,
      changed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      change_summary TEXT,

      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    -- Risks table (project risks)
    CREATE TABLE IF NOT EXISTS risks (
      id INTEGER PRIMARY KEY,
      installation_id INTEGER NOT NULL,
      project_number INTEGER NOT NULL,

      -- Risk details
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      owner TEXT,

      -- Timestamps
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      updated_by TEXT,

      -- Optional linking
      linked_issues TEXT,
      mitigation_plan TEXT,

      FOREIGN KEY (installation_id) REFERENCES installations(installation_id)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_installations_installation_id ON installations(installation_id);
    CREATE INDEX IF NOT EXISTS idx_projects_installation_id ON projects(installation_id);
    CREATE INDEX IF NOT EXISTS idx_holidays_installation_id ON holidays(installation_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_installation_id ON audit_log(installation_id);
    CREATE INDEX IF NOT EXISTS idx_documents_installation_id ON documents(installation_id);
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(installation_id, project_number);
    CREATE INDEX IF NOT EXISTS idx_document_versions_document_id ON document_versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_risks_installation_id ON risks(installation_id);
    CREATE INDEX IF NOT EXISTS idx_risks_project ON risks(installation_id, project_number);
  `);

  // Migration: Add oauth_token column if it doesn't exist
  try {
    db.exec(`ALTER TABLE installations ADD COLUMN oauth_token TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add pinned column to documents if it doesn't exist
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN pinned INTEGER DEFAULT 0`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: Add file storage columns to documents if they don't exist
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN file_data BLOB`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN file_name TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN file_type TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE documents ADD COLUMN file_size INTEGER`);
  } catch (e) {
    // Column already exists, ignore
  }

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

export function saveOAuthToken(installationId, token) {
  // Encrypt token before storing
  const encryptedToken = encrypt(token);
  const stmt = getDatabase().prepare(`
    UPDATE installations SET oauth_token = ?, updated_at = CURRENT_TIMESTAMP
    WHERE installation_id = ?
  `);
  return stmt.run(encryptedToken, installationId);
}

export function getOAuthToken(installationId) {
  const stmt = getDatabase().prepare(`
    SELECT oauth_token FROM installations WHERE installation_id = ?
  `);
  const row = stmt.get(installationId);

  if (row?.oauth_token) {
    // Decrypt token before returning
    return decrypt(row.oauth_token);
  }

  // Fall back to environment variable (for bootstrap/recovery)
  return process.env.FALLBACK_OAUTH_TOKEN;
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

export function getProjectByNodeId(installationId, projectNodeId) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM projects
    WHERE installation_id = ? AND project_id = ?
  `);
  const row = stmt.get(installationId, projectNodeId);
  if (row && row.settings_json) {
    row.settings = JSON.parse(row.settings_json);
  }
  return row;
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

// ============================================================
// Documents CRUD
// ============================================================

// Document types
export const DOCUMENT_TYPES = [
  'charter',
  'requirements',
  'status_report',
  'decision_log',
  'risk_register',
  'meeting_notes',
  'release_notes',
  'retrospective',
  'other'
];

export function createDocument(installationId, data) {
  const stmt = getDatabase().prepare(`
    INSERT INTO documents (
      installation_id, project_number, title, type, content,
      created_by, updated_by, linked_issues, linked_milestones, status,
      file_data, file_name, file_type, file_size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    installationId,
    data.projectNumber || null,
    data.title,
    data.type,
    data.content || '',
    data.createdBy || null,
    data.createdBy || null,
    JSON.stringify(data.linkedIssues || []),
    JSON.stringify(data.linkedMilestones || []),
    data.status || 'draft',
    data.fileData || null,
    data.fileName || null,
    data.fileType || null,
    data.fileSize || null
  );

  return result.lastInsertRowid;
}

export function getDocument(documentId) {
  // Exclude file_data from normal queries to avoid loading large blobs
  const stmt = getDatabase().prepare(`
    SELECT id, installation_id, project_number, title, type, content,
           created_by, updated_by, created_at, updated_at,
           linked_issues, linked_milestones, status, version, pinned,
           file_name, file_type, file_size
    FROM documents WHERE id = ?
  `);
  const doc = stmt.get(documentId);
  if (doc) {
    doc.linkedIssues = JSON.parse(doc.linked_issues || '[]');
    doc.linkedMilestones = JSON.parse(doc.linked_milestones || '[]');
    doc.pinned = doc.pinned === 1;
    doc.hasFile = !!doc.file_name;
  }
  return doc;
}

export function getDocumentFile(documentId) {
  // Get just the file data for downloads
  const stmt = getDatabase().prepare(`
    SELECT file_data, file_name, file_type, file_size
    FROM documents WHERE id = ?
  `);
  return stmt.get(documentId);
}

export function getDocumentsByInstallation(installationId, options = {}) {
  const { projectNumber = null, filter = null, limit = null } = options;

  // Exclude file_data from listing queries to avoid loading large blobs
  let query = `SELECT id, installation_id, project_number, title, type, content,
                      created_by, updated_by, created_at, updated_at,
                      linked_issues, linked_milestones, status, version, pinned,
                      file_name, file_type, file_size
               FROM documents WHERE installation_id = ?`;
  const params = [installationId];

  // Apply filter based on type
  if (filter === 'pinned') {
    query += ` AND pinned = 1`;
  } else if (filter === 'recent') {
    // Recent means last 10 modified documents (limit applied at end)
  } else if (projectNumber !== null) {
    query += ` AND project_number = ?`;
    params.push(projectNumber);
  }

  query += ` ORDER BY updated_at DESC`;

  // Apply limit for recent filter or explicit limit
  if (filter === 'recent') {
    query += ` LIMIT 10`;
  } else if (limit !== null) {
    query += ` LIMIT ?`;
    params.push(limit);
  }

  const stmt = getDatabase().prepare(query);
  return stmt.all(...params).map(doc => {
    doc.linkedIssues = JSON.parse(doc.linked_issues || '[]');
    doc.linkedMilestones = JSON.parse(doc.linked_milestones || '[]');
    doc.pinned = doc.pinned === 1;
    doc.hasFile = !!doc.file_name;
    return doc;
  });
}

export function toggleDocumentPinned(documentId) {
  const stmt = getDatabase().prepare(`
    UPDATE documents
    SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const result = stmt.run(documentId);

  // Return the new pinned state
  const doc = getDocument(documentId);
  return doc ? doc.pinned === 1 : false;
}

export function getDocumentCounts(installationId) {
  const db = getDatabase();

  // Get pinned count
  const pinnedStmt = db.prepare(`
    SELECT COUNT(*) as count FROM documents
    WHERE installation_id = ? AND pinned = 1
  `);
  const pinnedCount = pinnedStmt.get(installationId)?.count || 0;

  // Get recent count (last 10 modified)
  const recentStmt = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT id FROM documents
      WHERE installation_id = ?
      ORDER BY updated_at DESC LIMIT 10
    )
  `);
  const recentCount = recentStmt.get(installationId)?.count || 0;

  // Get counts by project
  const byProjectStmt = db.prepare(`
    SELECT project_number, COUNT(*) as count
    FROM documents
    WHERE installation_id = ? AND project_number IS NOT NULL
    GROUP BY project_number
  `);
  const byProject = byProjectStmt.all(installationId);

  return {
    pinned: pinnedCount,
    recent: recentCount,
    byProject: byProject.reduce((acc, row) => {
      acc[row.project_number] = row.count;
      return acc;
    }, {})
  };
}

export function updateDocument(documentId, data, updatedBy = null) {
  // First, save current version to history
  const current = getDocument(documentId);
  if (current) {
    saveDocumentVersion(documentId, current, updatedBy, data.changeSummary);
  }

  const updates = [];
  const values = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.content !== undefined) {
    updates.push('content = ?');
    values.push(data.content);
  }
  if (data.type !== undefined) {
    updates.push('type = ?');
    values.push(data.type);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }
  if (data.linkedIssues !== undefined) {
    updates.push('linked_issues = ?');
    values.push(JSON.stringify(data.linkedIssues));
  }
  if (data.linkedMilestones !== undefined) {
    updates.push('linked_milestones = ?');
    values.push(JSON.stringify(data.linkedMilestones));
  }
  if (data.projectNumber !== undefined) {
    updates.push('project_number = ?');
    values.push(data.projectNumber);
  }
  // File updates
  if (data.fileData !== undefined) {
    updates.push('file_data = ?');
    values.push(data.fileData);
  }
  if (data.fileName !== undefined) {
    updates.push('file_name = ?');
    values.push(data.fileName);
  }
  if (data.fileType !== undefined) {
    updates.push('file_type = ?');
    values.push(data.fileType);
  }
  if (data.fileSize !== undefined) {
    updates.push('file_size = ?');
    values.push(data.fileSize);
  }

  if (updates.length === 0) return;

  updates.push('updated_by = ?');
  values.push(updatedBy);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  updates.push('version = version + 1');

  values.push(documentId);

  const stmt = getDatabase().prepare(`
    UPDATE documents SET ${updates.join(', ')}
    WHERE id = ?
  `);

  return stmt.run(...values);
}

export function deleteDocument(documentId) {
  const stmt = getDatabase().prepare(`DELETE FROM documents WHERE id = ?`);
  return stmt.run(documentId);
}

// Version history
function saveDocumentVersion(documentId, current, changedBy, changeSummary) {
  const stmt = getDatabase().prepare(`
    INSERT INTO document_versions (
      document_id, version, title, content, changed_by, change_summary
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    documentId,
    current.version,
    current.title,
    current.content,
    changedBy,
    changeSummary || null
  );
}

export function getDocumentVersions(documentId) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM document_versions
    WHERE document_id = ?
    ORDER BY version DESC
  `);
  return stmt.all(documentId);
}

export function getDocumentVersion(documentId, version) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM document_versions
    WHERE document_id = ? AND version = ?
  `);
  return stmt.get(documentId, version);
}

// ============================================================
// Risks CRUD
// ============================================================

// Valid risk severities and statuses
export const RISK_SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const RISK_STATUSES = ['open', 'mitigated', 'closed'];

export function createRisk(installationId, projectNumber, data) {
  const stmt = getDatabase().prepare(`
    INSERT INTO risks (
      installation_id, project_number, title, description, severity, status,
      owner, created_by, updated_by, linked_issues, mitigation_plan
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    installationId,
    projectNumber,
    data.title,
    data.description || null,
    data.severity || 'medium',
    data.status || 'open',
    data.owner || null,
    data.createdBy || null,
    data.createdBy || null,
    JSON.stringify(data.linkedIssues || []),
    data.mitigationPlan || null
  );

  return result.lastInsertRowid;
}

export function getRisk(riskId) {
  const stmt = getDatabase().prepare(`SELECT * FROM risks WHERE id = ?`);
  const risk = stmt.get(riskId);
  if (risk) {
    risk.linkedIssues = JSON.parse(risk.linked_issues || '[]');
  }
  return risk;
}

export function getRisksByProject(installationId, projectNumber) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM risks
    WHERE installation_id = ? AND project_number = ?
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      created_at DESC
  `);
  return stmt.all(installationId, projectNumber).map(risk => {
    risk.linkedIssues = JSON.parse(risk.linked_issues || '[]');
    return risk;
  });
}

export function getRisksByInstallation(installationId) {
  const stmt = getDatabase().prepare(`
    SELECT * FROM risks WHERE installation_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(installationId).map(risk => {
    risk.linkedIssues = JSON.parse(risk.linked_issues || '[]');
    return risk;
  });
}

export function updateRisk(riskId, data, updatedBy = null) {
  const updates = [];
  const values = [];

  if (data.title !== undefined) {
    updates.push('title = ?');
    values.push(data.title);
  }
  if (data.description !== undefined) {
    updates.push('description = ?');
    values.push(data.description);
  }
  if (data.severity !== undefined) {
    updates.push('severity = ?');
    values.push(data.severity);
  }
  if (data.status !== undefined) {
    updates.push('status = ?');
    values.push(data.status);
  }
  if (data.owner !== undefined) {
    updates.push('owner = ?');
    values.push(data.owner);
  }
  if (data.linkedIssues !== undefined) {
    updates.push('linked_issues = ?');
    values.push(JSON.stringify(data.linkedIssues));
  }
  if (data.mitigationPlan !== undefined) {
    updates.push('mitigation_plan = ?');
    values.push(data.mitigationPlan);
  }

  if (updates.length === 0) return;

  updates.push('updated_by = ?');
  values.push(updatedBy);
  updates.push('updated_at = CURRENT_TIMESTAMP');

  values.push(riskId);

  const stmt = getDatabase().prepare(`
    UPDATE risks SET ${updates.join(', ')}
    WHERE id = ?
  `);

  return stmt.run(...values);
}

export function deleteRisk(riskId) {
  const stmt = getDatabase().prepare(`DELETE FROM risks WHERE id = ?`);
  return stmt.run(riskId);
}

export function getRiskSummary(installationId, projectNumber) {
  const stmt = getDatabase().prepare(`
    SELECT
      severity,
      COUNT(*) as count
    FROM risks
    WHERE installation_id = ? AND project_number = ? AND status != 'closed'
    GROUP BY severity
  `);
  const rows = stmt.all(installationId, projectNumber);

  // Initialize counts
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  rows.forEach(row => {
    summary[row.severity] = row.count;
  });

  return summary;
}
