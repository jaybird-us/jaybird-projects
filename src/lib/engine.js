/**
 * ProjectFlow Engine
 *
 * Core date calculation and automation logic
 * Ported from date-automation.js to work with Octokit
 */

import { getGitHubAuth } from './github-auth.js';
import {
  getInstallation,
  getInstallationSettings,
  getProject,
  getProjectsByInstallation,
  getHolidays,
  logAudit
} from './database.js';
import { calculateProjectRisks } from './risk.js';
import { getProjectFields } from './project-fields.js';

// ============================================================
// Date Utilities
// ============================================================

class DateUtils {
  constructor(settings) {
    this.weekendDays = settings.weekendDays || [0, 6];
    this.holidays = new Set(settings.holidays || []);
  }

  isWorkingDay(date) {
    const d = new Date(date);
    if (this.weekendDays.includes(d.getUTCDay())) return false;
    if (this.holidays.has(this.formatDate(d))) return false;
    return true;
  }

  formatDate(date) {
    return date.toISOString().split('T')[0];
  }

  parseDate(dateStr) {
    return new Date(dateStr + 'T00:00:00Z');
  }

  addWorkingDays(startDate, days) {
    let current = new Date(startDate);
    let remaining = days;

    while (remaining > 0) {
      current.setUTCDate(current.getUTCDate() + 1);
      if (this.isWorkingDay(current)) {
        remaining--;
      }
    }

    return current;
  }

  workingDaysBetween(start, end) {
    let count = 0;
    let current = new Date(start);
    const endDate = new Date(end);

    while (current < endDate) {
      current.setUTCDate(current.getUTCDate() + 1);
      if (this.isWorkingDay(current)) {
        count++;
      }
    }

    return count;
  }

  nextWorkingDay(date) {
    let current = new Date(date);
    while (!this.isWorkingDay(current)) {
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return current;
  }

  minDate(dates) {
    const validDates = dates.filter(d => d);
    if (validDates.length === 0) return null;
    return validDates.reduce((min, d) => d < min ? d : min);
  }

  maxDate(dates) {
    const validDates = dates.filter(d => d);
    if (validDates.length === 0) return null;
    return validDates.reduce((max, d) => d > max ? d : max);
  }
}

// ============================================================
// ProjectFlow Engine
// ============================================================

export class ProjectFlowEngine {
  constructor(installationId, logger, options = {}) {
    this.installationId = installationId;
    this.logger = logger;
    this.maxTrackedIssues = options.maxTrackedIssues || Infinity;
    this.userToken = options.userToken || null; // User's OAuth token for project access
    this.octokit = null;
    this.settings = null;
    this.dateUtils = null;
    this.projectItems = new Map();
    this.issueDependencies = new Map();
    this.parentChildren = new Map();
    this.milestoneEpics = new Map();
    this.calculatedDates = new Map();
    this.limitReached = false;
    this.totalItemsFound = 0;
    this.cachedFieldIds = null; // Cache for dynamically fetched field IDs
  }

  async initialize() {
    // Get installation and account type
    const installation = getInstallation(this.installationId);
    this.accountType = installation?.account_type || 'Organization';

    // Get installation settings
    this.settings = getInstallationSettings(this.installationId);

    // Get holidays and add to settings
    const holidays = getHolidays(this.installationId);
    const holidayDates = holidays.map(h => h.date);
    this.settings.holidays = holidayDates;

    // Initialize date utilities
    this.dateUtils = new DateUtils(this.settings);

    // Use user's OAuth token if provided (required for project access)
    // Fall back to GitHub App token only if user token not available
    if (this.userToken) {
      const { Octokit } = await import('@octokit/rest');
      this.octokit = new Octokit({ auth: this.userToken });
      this.logger.info({ installationId: this.installationId }, 'Using user OAuth token for project access');
    } else {
      // Fallback to GitHub App token (may not have project permissions)
      const auth = getGitHubAuth();
      this.octokit = await auth.getInstallationOctokit(this.installationId);
      this.logger.warn({ installationId: this.installationId }, 'Using GitHub App token - project access may be limited');
    }
  }

  /**
   * Get the GraphQL owner type (organization or user)
   */
  getOwnerType() {
    return this.accountType === 'Organization' ? 'organization' : 'user';
  }

  /**
   * Build a GraphQL query with dynamic owner type support
   */
  buildOwnerQuery(ownerType, projectFields) {
    return `
      query($owner: String!, $projectNumber: Int!) {
        ${ownerType}(login: $owner) {
          projectV2(number: $projectNumber) {
            ${projectFields}
          }
        }
      }
    `;
  }

  /**
   * Extract project data from GraphQL response (handles both org and user)
   */
  extractProjectData(result) {
    return result.organization?.projectV2 || result.user?.projectV2;
  }

  /**
   * Load project items from GitHub with pagination support
   */
  async loadProjectItems(owner, projectNumber) {
    await this.initialize();

    const project = getProject(this.installationId, owner, projectNumber);
    if (!project) {
      throw new Error(`Project not found: ${owner}/${projectNumber}`);
    }

    this.logger.info({ owner, projectNumber, accountType: this.accountType }, 'Loading project items');

    const ownerType = this.getOwnerType();

    // Query with pagination support
    const query = `
      query($owner: String!, $projectNumber: Int!, $cursor: String) {
        ${ownerType}(login: $owner) {
          projectV2(number: $projectNumber) {
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
                    milestone {
                      number
                      title
                    }
                    parent {
                      number
                    }
                    subIssues: subIssues(first: 50) {
                      nodes {
                        number
                      }
                    }
                    blockedBy(first: 20) {
                      nodes {
                        number
                      }
                    }
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
                  }
                }
              }
            }
          }
        }
      }
    `;

    // Fetch all pages of items
    const allItems = [];
    let hasNextPage = true;
    let cursor = null;
    let projectId = null;

    try {
      while (hasNextPage) {
        const result = await this.octokit.graphql(query, {
          owner,
          projectNumber,
          cursor
        });

        const projectData = this.extractProjectData(result);
        if (!projectData) {
          throw new Error('Project not found in GraphQL response');
        }

        projectId = projectData.id;
        const items = projectData.items?.nodes || [];
        allItems.push(...items);

        hasNextPage = projectData.items?.pageInfo?.hasNextPage || false;
        cursor = projectData.items?.pageInfo?.endCursor;

        // Safety limit to prevent infinite loops (max 1000 items)
        if (allItems.length >= 1000) {
          this.logger.warn({ itemCount: allItems.length }, 'Reached maximum item limit (1000)');
          break;
        }
      }

      this.logger.info({ result: `Fetched ${allItems.length} items across ${cursor ? 'multiple' : 'one'} page(s)` }, 'GraphQL response');
    } catch (graphqlError) {
      this.logger.error({ error: graphqlError.message, owner, projectNumber }, 'GraphQL query failed');
      throw graphqlError;
    }

    const items = allItems;
    this.totalItemsFound = items.length;
    this.limitReached = items.length > this.maxTrackedIssues;

    // Apply limit for free tier
    const itemsToProcess = this.maxTrackedIssues < Infinity
      ? items.slice(0, this.maxTrackedIssues)
      : items;

    if (this.limitReached) {
      this.logger.warn({
        total: items.length,
        limit: this.maxTrackedIssues,
        processing: itemsToProcess.length
      }, 'Issue limit reached - upgrade to Pro for unlimited tracking');
    }

    this.projectItems.clear();
    this.issueDependencies.clear();
    this.parentChildren.clear();
    this.milestoneEpics.clear();

    for (const item of itemsToProcess) {
      if (!item.content?.number) continue;

      const issueNumber = item.content.number;
      const fieldValues = {};

      for (const fv of item.fieldValues.nodes) {
        if (fv.field?.name === 'Start Date') fieldValues.startDate = fv.date;
        if (fv.field?.name === 'Target Date') fieldValues.targetDate = fv.date;
        if (fv.field?.name === 'Actual End Date') fieldValues.actualEndDate = fv.date;
        if (fv.field?.name === 'Baseline Start') fieldValues.baselineStart = fv.date;
        if (fv.field?.name === 'Baseline Target') fieldValues.baselineTarget = fv.date;
        if (fv.field?.name === '% Complete') fieldValues.percentComplete = fv.name;
        if (fv.field?.name === 'Status') fieldValues.status = fv.name;
        if (fv.field?.name === 'Estimate') fieldValues.estimate = fv.name;
        if (fv.field?.name === 'Confidence') fieldValues.confidence = fv.name;
      }

      // Use closedAt if no Actual End Date
      const closedAt = item.content.closedAt;
      if (closedAt && !fieldValues.actualEndDate) {
        fieldValues.actualEndDate = closedAt.split('T')[0];
      }

      // Track sub-issues (parent-child relationships)
      const subIssueNumbers = item.content.subIssues?.nodes?.map(s => s.number) || [];
      if (subIssueNumbers.length > 0) {
        this.parentChildren.set(issueNumber, subIssueNumbers);
      }

      // Track blocking dependencies
      const blockedByNumbers = item.content.blockedBy?.nodes?.map(b => b.number) || [];
      if (blockedByNumbers.length > 0) {
        this.issueDependencies.set(issueNumber, blockedByNumbers);
      }

      // Track milestone membership
      if (item.content.milestone?.number) {
        const milestoneNum = item.content.milestone.number;
        if (!this.milestoneEpics.has(milestoneNum)) {
          this.milestoneEpics.set(milestoneNum, []);
        }
        this.milestoneEpics.get(milestoneNum).push(issueNumber);
      }

      this.projectItems.set(issueNumber, {
        itemId: item.id,
        issueNumber,
        title: item.content.title,
        state: item.content.state,
        milestone: item.content.milestone,
        parentNumber: item.content.parent?.number,
        hasChildren: subIssueNumbers.length > 0,
        ...fieldValues
      });
    }

    this.logger.info({
      itemCount: this.projectItems.size,
      withDependencies: this.issueDependencies.size
    }, 'Project items loaded');

    return this.projectItems;
  }

  /**
   * Get dependencies for an issue
   */
  getDependencies(issueNumber) {
    return this.issueDependencies.get(issueNumber) || [];
  }

  /**
   * Get duration from Estimate field
   */
  getDuration(issueNumber) {
    const item = this.projectItems.get(issueNumber);
    if (item?.estimate && this.settings.estimateDays[item.estimate]) {
      return this.settings.estimateDays[item.estimate];
    }
    return 10; // Default
  }

  /**
   * Get buffer from Confidence field
   */
  getBuffer(issueNumber) {
    const item = this.projectItems.get(issueNumber);
    if (item?.confidence && this.settings.confidenceBuffer[item.confidence] !== undefined) {
      return this.settings.confidenceBuffer[item.confidence];
    }
    return this.settings.confidenceBuffer['Medium'] || 2;
  }

  /**
   * Topological sort for dependency order
   */
  topologicalSort(issueIds) {
    const visited = new Set();
    const result = [];

    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);

      const deps = this.getDependencies(parseInt(id));
      for (const depId of deps) {
        visit(depId.toString());
      }

      result.push(id);
    };

    for (const id of issueIds) {
      visit(id);
    }

    return result;
  }

  /**
   * Calculate dates for a single issue
   */
  calculateIssueDates(issueNumber) {
    const item = this.projectItems.get(parseInt(issueNumber));
    if (!item) return null;

    const isCompleted = item.state === 'CLOSED' || item.status === 'Done';

    // Completed items use actual dates
    if (isCompleted) {
      const endDate = item.actualEndDate || item.targetDate;
      this.calculatedDates.set(issueNumber, {
        startDate: item.startDate,
        targetDate: item.targetDate,
        endDateForDependents: endDate,
        isCompleted: true,
        isSummary: false
      });
      return this.calculatedDates.get(issueNumber);
    }

    // Parent issues with children - will be rolled up
    if (item.hasChildren) {
      this.calculatedDates.set(issueNumber, {
        startDate: null,
        targetDate: null,
        isCompleted: false,
        isSummary: true
      });
      return this.calculatedDates.get(issueNumber);
    }

    let startDate = null;
    const dependencies = this.getDependencies(parseInt(issueNumber));

    // Calculate from dependencies
    if (dependencies.length > 0) {
      let latestDepEnd = null;

      for (const depId of dependencies) {
        const depDates = this.calculatedDates.get(depId.toString());
        let depEndDate = depDates?.endDateForDependents || depDates?.targetDate;

        if (depEndDate) {
          const depEnd = this.dateUtils.parseDate(depEndDate);
          if (!latestDepEnd || depEnd > latestDepEnd) {
            latestDepEnd = depEnd;
          }
        }
      }

      if (latestDepEnd) {
        startDate = new Date(latestDepEnd);
        startDate.setUTCDate(startDate.getUTCDate() + 1);
        startDate = this.dateUtils.nextWorkingDay(startDate);
      }
    }

    // Fallback to today
    if (!startDate) {
      startDate = this.dateUtils.nextWorkingDay(new Date());
    }

    // Calculate target date
    const duration = this.getDuration(parseInt(issueNumber));
    const buffer = this.getBuffer(parseInt(issueNumber));
    const targetDate = this.dateUtils.addWorkingDays(startDate, duration + buffer);

    const dates = {
      startDate: this.dateUtils.formatDate(startDate),
      targetDate: this.dateUtils.formatDate(targetDate),
      endDateForDependents: this.dateUtils.formatDate(targetDate),
      duration,
      buffer,
      dependencies: dependencies.length,
      isCompleted: false,
      isSummary: false
    };

    this.calculatedDates.set(issueNumber, dates);
    return dates;
  }

  /**
   * Roll up parent dates from children
   */
  rollUpParentDates() {
    for (const [parentNum, childNums] of this.parentChildren) {
      const childDates = childNums
        .map(num => this.calculatedDates.get(num.toString()))
        .filter(d => d && d.startDate && d.targetDate);

      if (childDates.length === 0) continue;

      const startDates = childDates.map(d => this.dateUtils.parseDate(d.startDate));
      const targetDates = childDates.map(d => this.dateUtils.parseDate(d.targetDate));

      const minStart = this.dateUtils.minDate(startDates);
      const maxTarget = this.dateUtils.maxDate(targetDates);

      if (minStart && maxTarget) {
        this.calculatedDates.set(parentNum.toString(), {
          startDate: this.dateUtils.formatDate(minStart),
          targetDate: this.dateUtils.formatDate(maxTarget),
          isCompleted: false,
          isSummary: true,
          childCount: childNums.length
        });
      }
    }
  }

  /**
   * Calculate all dates
   */
  calculateAllDates() {
    this.calculatedDates.clear();

    const allIssueNumbers = Array.from(this.projectItems.keys()).map(n => n.toString());
    const sorted = this.topologicalSort(allIssueNumbers);

    for (const issueId of sorted) {
      this.calculateIssueDates(issueId);
    }

    this.rollUpParentDates();

    return this.calculatedDates;
  }

  /**
   * Get field ID by name, fetching from GitHub if not cached
   */
  async getFieldId(projectId, fieldName) {
    // Map internal field names to GitHub field names
    const fieldNameMap = {
      startDate: 'Start Date',
      targetDate: 'Target Date',
      actualEndDate: 'Actual End Date',
      baselineStart: 'Baseline Start',
      baselineTarget: 'Baseline Target'
    };

    const githubFieldName = fieldNameMap[fieldName];
    if (!githubFieldName) return null;

    // Fetch and cache field IDs if not already done
    if (!this.cachedFieldIds) {
      try {
        const fields = await getProjectFields(this.octokit, projectId);
        this.cachedFieldIds = {};
        for (const field of fields) {
          this.cachedFieldIds[field.name] = field.id;
        }
        this.logger.info({ fieldCount: fields.length }, 'Fetched and cached project field IDs');
      } catch (error) {
        this.logger.error({ error: error.message }, 'Failed to fetch project fields');
        return null;
      }
    }

    return this.cachedFieldIds[githubFieldName];
  }

  /**
   * Update a single field value in GitHub
   */
  async updateItemField(project, issueNumber, fieldName, value) {
    const item = this.projectItems.get(issueNumber);
    if (!item) return false;

    // First try stored field IDs, then dynamically fetch
    const storedFieldIdMap = {
      startDate: project.start_date_field_id,
      targetDate: project.target_date_field_id,
      actualEndDate: project.actual_end_date_field_id,
      baselineStart: project.baseline_start_field_id,
      baselineTarget: project.baseline_target_field_id
    };

    let fieldId = storedFieldIdMap[fieldName];

    // If not stored, fetch dynamically
    if (!fieldId) {
      fieldId = await this.getFieldId(project.project_id, fieldName);
    }

    if (!fieldId) {
      this.logger.warn({ fieldName }, 'Field ID not found');
      return false;
    }

    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { date: $date }
          }
        ) {
          projectV2Item { id }
        }
      }
    `;

    try {
      await this.octokit.graphql(mutation, {
        projectId: project.project_id,
        itemId: item.itemId,
        fieldId: fieldId,
        date: value
      });

      this.logger.debug({ issueNumber, fieldName, value }, 'Updated field');
      return true;
    } catch (error) {
      this.logger.error({ error, issueNumber, fieldName }, 'Failed to update field');
      return false;
    }
  }

  /**
   * Recalculate and update all dates
   */
  async recalculateAll(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);
    const project = getProject(this.installationId, owner, projectNumber);

    this.calculateAllDates();

    let updated = 0;
    let skipped = 0;

    for (const [issueId, dates] of this.calculatedDates) {
      const item = this.projectItems.get(parseInt(issueId));
      if (!item) continue;

      // Skip if no change
      if (item.startDate === dates.startDate && item.targetDate === dates.targetDate) {
        skipped++;
        continue;
      }

      // Skip completed items
      if (dates.isCompleted) {
        skipped++;
        continue;
      }

      // Update dates
      const startUpdated = await this.updateItemField(project, parseInt(issueId), 'startDate', dates.startDate);
      const targetUpdated = await this.updateItemField(project, parseInt(issueId), 'targetDate', dates.targetDate);

      if (startUpdated && targetUpdated) {
        updated++;
      }
    }

    // Log audit
    logAudit(this.installationId, 'recalculate', {
      owner,
      projectNumber,
      updated,
      skipped
    });

    this.logger.info({ updated, skipped }, 'Recalculation complete');

    return { updated, skipped };
  }

  /**
   * Save baseline dates
   */
  async saveBaseline(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);
    const project = getProject(this.installationId, owner, projectNumber);

    let saved = 0;

    for (const [issueNum, item] of this.projectItems) {
      if (!item.startDate && !item.targetDate) continue;

      const needsBaselineStart = item.startDate && !item.baselineStart;
      const needsBaselineTarget = item.targetDate && !item.baselineTarget;

      if (needsBaselineStart) {
        await this.updateItemField(project, issueNum, 'baselineStart', item.startDate);
      }
      if (needsBaselineTarget) {
        await this.updateItemField(project, issueNum, 'baselineTarget', item.targetDate);
      }

      if (needsBaselineStart || needsBaselineTarget) {
        saved++;
      }
    }

    logAudit(this.installationId, 'save-baseline', { owner, projectNumber, saved });

    return { saved };
  }

  /**
   * Generate variance report
   */
  async generateVarianceReport(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);

    const report = {
      items: [],
      summary: {
        ahead: 0,
        onTrack: 0,
        behind: 0,
        noBaseline: 0
      }
    };

    for (const [issueNum, item] of this.projectItems) {
      if (!item.baselineTarget) {
        report.summary.noBaseline++;
        continue;
      }

      const baselineTarget = this.dateUtils.parseDate(item.baselineTarget);
      const currentTarget = this.dateUtils.parseDate(item.targetDate || item.baselineTarget);

      let variance = 0;
      if (currentTarget > baselineTarget) {
        variance = this.dateUtils.workingDaysBetween(baselineTarget, currentTarget);
      } else if (currentTarget < baselineTarget) {
        variance = -this.dateUtils.workingDaysBetween(currentTarget, baselineTarget);
      }

      const status = item.state === 'CLOSED' ? 'done' :
                     variance > 0 ? 'behind' :
                     variance < 0 ? 'ahead' : 'onTrack';

      report.items.push({
        issueNumber: issueNum,
        title: item.title,
        baselineStart: item.baselineStart,
        baselineTarget: item.baselineTarget,
        currentStart: item.startDate,
        currentTarget: item.targetDate,
        variance,
        status
      });

      if (status === 'done' || status === 'onTrack') {
        report.summary.onTrack++;
      } else if (status === 'ahead') {
        report.summary.ahead++;
      } else {
        report.summary.behind++;
      }
    }

    return report;
  }

  /**
   * Handle issue close event
   */
  async onIssueClosed(owner, repo, issueNumber) {
    // Find the project this issue belongs to
    const projects = getProjectsByInstallation(this.installationId);

    for (const project of projects) {
      if (project.owner !== owner) continue;

      try {
        await this.loadProjectItems(owner, project.project_number);

        const item = this.projectItems.get(issueNumber);
        if (!item) continue;

        // Set Actual End Date if not already set
        if (!item.actualEndDate) {
          const today = new Date().toISOString().split('T')[0];
          await this.updateItemField(project, issueNumber, 'actualEndDate', today);
          this.logger.info({ issueNumber, actualEndDate: today }, 'Set Actual End Date');
        }

        // Recalculate dependent dates
        await this.recalculateAll(owner, project.project_number);

      } catch (error) {
        this.logger.error({ error, owner, issueNumber }, 'Failed to process issue close');
      }
    }
  }

  /**
   * Adjust past-due target dates
   */
  async adjustPastDueDates(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);
    const project = getProject(this.installationId, owner, projectNumber);

    const today = new Date().toISOString().split('T')[0];
    let adjusted = 0;

    for (const [issueNum, item] of this.projectItems) {
      if (item.state === 'CLOSED' || item.status === 'Done') continue;

      if (item.targetDate && item.targetDate < today) {
        await this.updateItemField(project, issueNum, 'targetDate', today);
        adjusted++;
      }
    }

    // Recalculate to cascade changes
    if (adjusted > 0) {
      await this.recalculateAll(owner, projectNumber);
    }

    logAudit(this.installationId, 'adjust-past-due', { owner, projectNumber, adjusted });

    return { adjusted };
  }

  /**
   * Get risk assessment for all project items
   */
  async getRiskAssessment(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);

    // Enhance items with blockedBy info for risk calculation
    for (const [issueNum, item] of this.projectItems) {
      item.blockedBy = this.issueDependencies.get(issueNum) || [];
    }

    const riskReport = calculateProjectRisks(this.projectItems);

    this.logger.info({
      owner,
      projectNumber,
      summary: riskReport.summary
    }, 'Risk assessment completed');

    return riskReport;
  }

  /**
   * Get dependency graph data for visualization
   */
  async getDependencyGraph(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);
    this.calculateAllDates();

    const nodes = [];
    const edges = [];

    // Build nodes from project items
    for (const [issueNum, item] of this.projectItems) {
      const calcDates = this.calculatedDates.get(issueNum.toString()) || {};

      nodes.push({
        id: issueNum.toString(),
        issueNumber: issueNum,
        title: item.title,
        state: item.state,
        status: item.status,
        startDate: calcDates.startDate || item.startDate,
        targetDate: calcDates.targetDate || item.targetDate,
        estimate: item.estimate,
        isCompleted: item.state === 'CLOSED' || item.status === 'Done',
        isSummary: calcDates.isSummary || false,
        hasChildren: item.hasChildren,
        parentNumber: item.parentNumber,
        duration: calcDates.duration || this.getDuration(issueNum),
        buffer: calcDates.buffer || this.getBuffer(issueNum)
      });
    }

    // Build edges from dependencies (blockedBy relationships)
    for (const [issueNum, blockedByList] of this.issueDependencies) {
      for (const blockerNum of blockedByList) {
        // Edge goes from blocker to blocked (blocker must complete first)
        edges.push({
          id: `${blockerNum}-${issueNum}`,
          source: blockerNum.toString(),
          target: issueNum.toString(),
          type: 'dependency'
        });
      }
    }

    // Build edges from parent-child relationships
    for (const [parentNum, childNums] of this.parentChildren) {
      for (const childNum of childNums) {
        edges.push({
          id: `parent-${parentNum}-${childNum}`,
          source: parentNum.toString(),
          target: childNum.toString(),
          type: 'parent-child'
        });
      }
    }

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath();

    return {
      nodes,
      edges,
      criticalPath,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        dependencyEdges: this.issueDependencies.size,
        parentChildEdges: this.parentChildren.size
      }
    };
  }

  /**
   * Get milestone summary data for release planning
   */
  async getMilestonesSummary(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);
    this.calculateAllDates();

    // Query for milestone data
    const ownerType = this.getOwnerType();
    const query = `
      query($owner: String!, $projectNumber: Int!) {
        ${ownerType}(login: $owner) {
          projectV2(number: $projectNumber) {
            items(first: 100) {
              nodes {
                content {
                  ... on Issue {
                    number
                    state
                    milestone {
                      number
                      title
                      description
                      dueOn
                      state
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.octokit.graphql(query, {
      owner,
      projectNumber
    });

    // Build milestone map
    const milestoneData = new Map();
    const projectData = this.extractProjectData(result);
    const items = projectData?.items?.nodes || [];

    for (const item of items) {
      if (!item.content?.number) continue;
      const issueNumber = item.content.number;
      const milestone = item.content.milestone;

      const projectItem = this.projectItems.get(issueNumber);
      if (!projectItem) continue;

      const calcDates = this.calculatedDates.get(issueNumber.toString()) || {};
      const isCompleted = projectItem.state === 'CLOSED' || projectItem.status === 'Done';

      if (milestone) {
        const milestoneKey = `${milestone.number}`;
        if (!milestoneData.has(milestoneKey)) {
          milestoneData.set(milestoneKey, {
            number: milestone.number,
            title: milestone.title,
            description: milestone.description,
            dueOn: milestone.dueOn,
            state: milestone.state,
            url: milestone.url,
            items: [],
            stats: {
              total: 0,
              completed: 0,
              inProgress: 0,
              todo: 0,
              totalDays: 0,
              remainingDays: 0
            },
            latestTargetDate: null,
            earliestStartDate: null,
            isOnTrack: true,
            riskLevel: 'none'
          });
        }

        const data = milestoneData.get(milestoneKey);
        const duration = calcDates.duration || this.getDuration(issueNumber);

        data.items.push({
          issueNumber,
          title: projectItem.title,
          status: projectItem.status,
          state: projectItem.state,
          estimate: projectItem.estimate,
          startDate: calcDates.startDate || projectItem.startDate,
          targetDate: calcDates.targetDate || projectItem.targetDate,
          duration,
          isCompleted
        });

        data.stats.total++;
        data.stats.totalDays += duration;

        if (isCompleted) {
          data.stats.completed++;
        } else {
          data.stats.remainingDays += duration;
          if (projectItem.status === 'In Progress') {
            data.stats.inProgress++;
          } else {
            data.stats.todo++;
          }
        }

        // Track dates for timeline
        const targetDate = calcDates.targetDate || projectItem.targetDate;
        const startDate = calcDates.startDate || projectItem.startDate;

        if (targetDate && (!data.latestTargetDate || targetDate > data.latestTargetDate)) {
          data.latestTargetDate = targetDate;
        }
        if (startDate && (!data.earliestStartDate || startDate < data.earliestStartDate)) {
          data.earliestStartDate = startDate;
        }
      }
    }

    // Calculate risk level and on-track status for each milestone
    const today = new Date().toISOString().split('T')[0];

    for (const [key, data] of milestoneData) {
      // Check if on track
      if (data.dueOn && data.latestTargetDate) {
        data.isOnTrack = data.latestTargetDate <= data.dueOn;
      }

      // Calculate risk level
      const completionRate = data.stats.total > 0 ? data.stats.completed / data.stats.total : 0;
      const isPastDue = data.dueOn && data.dueOn < today && data.state === 'OPEN';

      if (isPastDue && completionRate < 1) {
        data.riskLevel = 'critical';
      } else if (!data.isOnTrack) {
        data.riskLevel = 'high';
      } else if (completionRate < 0.5 && data.dueOn) {
        // Check if we're past 50% of time but less than 50% complete
        const dueDate = new Date(data.dueOn);
        const startDate = data.earliestStartDate ? new Date(data.earliestStartDate) : new Date();
        const now = new Date();
        const totalTime = dueDate.getTime() - startDate.getTime();
        const elapsedTime = now.getTime() - startDate.getTime();
        if (totalTime > 0 && elapsedTime / totalTime > 0.5) {
          data.riskLevel = 'medium';
        }
      }
    }

    // Sort by due date (soonest first), then by title
    const milestones = Array.from(milestoneData.values())
      .sort((a, b) => {
        if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
        if (a.dueOn) return -1;
        if (b.dueOn) return 1;
        return a.title.localeCompare(b.title);
      });

    // Count items without milestone
    let unmilestoned = 0;
    for (const item of items) {
      if (item.content?.number && !item.content.milestone) {
        unmilestoned++;
      }
    }

    return {
      milestones,
      summary: {
        total: milestones.length,
        open: milestones.filter(m => m.state === 'OPEN').length,
        closed: milestones.filter(m => m.state === 'CLOSED').length,
        atRisk: milestones.filter(m => m.riskLevel === 'high' || m.riskLevel === 'critical').length,
        unmilestoned
      }
    };
  }

  /**
   * Get resource allocation data showing workload per assignee
   */
  async getResourceAllocation(owner, projectNumber) {
    await this.loadProjectItems(owner, projectNumber);
    this.calculateAllDates();

    // Query for assignee data (separate query since we need assignees)
    const ownerType = this.getOwnerType();
    const query = `
      query($owner: String!, $projectNumber: Int!) {
        ${ownerType}(login: $owner) {
          projectV2(number: $projectNumber) {
            items(first: 100) {
              nodes {
                content {
                  ... on Issue {
                    number
                    assignees(first: 10) {
                      nodes {
                        login
                        name
                        avatarUrl
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.octokit.graphql(query, {
      owner,
      projectNumber
    });

    // Build assignee map
    const assigneeData = new Map();
    const projectData = this.extractProjectData(result);
    const items = projectData?.items?.nodes || [];

    for (const item of items) {
      if (!item.content?.number) continue;
      const issueNumber = item.content.number;
      const assignees = item.content.assignees?.nodes || [];

      const projectItem = this.projectItems.get(issueNumber);
      if (!projectItem) continue;

      const calcDates = this.calculatedDates.get(issueNumber.toString()) || {};
      const duration = calcDates.duration || this.getDuration(issueNumber);
      const isCompleted = projectItem.state === 'CLOSED' || projectItem.status === 'Done';

      for (const assignee of assignees) {
        if (!assigneeData.has(assignee.login)) {
          assigneeData.set(assignee.login, {
            login: assignee.login,
            name: assignee.name || assignee.login,
            avatarUrl: assignee.avatarUrl,
            items: [],
            totalItems: 0,
            completedItems: 0,
            totalDays: 0,
            remainingDays: 0,
            workload: 'normal' // low, normal, high, overloaded
          });
        }

        const data = assigneeData.get(assignee.login);
        data.items.push({
          issueNumber,
          title: projectItem.title,
          status: projectItem.status,
          state: projectItem.state,
          estimate: projectItem.estimate,
          startDate: calcDates.startDate || projectItem.startDate,
          targetDate: calcDates.targetDate || projectItem.targetDate,
          duration,
          isCompleted
        });

        data.totalItems++;
        data.totalDays += duration;

        if (isCompleted) {
          data.completedItems++;
        } else {
          data.remainingDays += duration;
        }
      }
    }

    // Calculate workload levels (based on remaining days)
    // Default capacity assumption: 5 items or 50 days is "normal" capacity
    const normalCapacityDays = 50;
    const normalCapacityItems = 5;

    for (const [login, data] of assigneeData) {
      const openItems = data.totalItems - data.completedItems;

      if (data.remainingDays > normalCapacityDays * 1.5 || openItems > normalCapacityItems * 1.5) {
        data.workload = 'overloaded';
      } else if (data.remainingDays > normalCapacityDays || openItems > normalCapacityItems) {
        data.workload = 'high';
      } else if (data.remainingDays < normalCapacityDays * 0.3 && openItems < normalCapacityItems * 0.5) {
        data.workload = 'low';
      }
    }

    // Sort by remaining days (most loaded first)
    const resources = Array.from(assigneeData.values())
      .sort((a, b) => b.remainingDays - a.remainingDays);

    // Summary stats
    const summary = {
      totalAssignees: resources.length,
      totalItems: Array.from(this.projectItems.values()).length,
      unassignedItems: 0,
      byWorkload: {
        overloaded: resources.filter(r => r.workload === 'overloaded').length,
        high: resources.filter(r => r.workload === 'high').length,
        normal: resources.filter(r => r.workload === 'normal').length,
        low: resources.filter(r => r.workload === 'low').length
      }
    };

    // Count unassigned items
    for (const item of items) {
      if (!item.content?.number) continue;
      const assignees = item.content.assignees?.nodes || [];
      if (assignees.length === 0) {
        summary.unassignedItems++;
      }
    }

    return {
      resources,
      summary
    };
  }

  /**
   * Calculate the critical path through the dependency graph
   * Critical path = longest path from start to end considering dependencies
   */
  calculateCriticalPath() {
    const nodes = new Map();

    // Initialize nodes with early start/finish times
    for (const [issueNum, item] of this.projectItems) {
      const calcDates = this.calculatedDates.get(issueNum.toString()) || {};
      const duration = calcDates.duration || this.getDuration(issueNum);

      nodes.set(issueNum.toString(), {
        issueNumber: issueNum,
        title: item.title,
        duration,
        earlyStart: 0,
        earlyFinish: duration,
        lateStart: Infinity,
        lateFinish: Infinity,
        slack: Infinity,
        predecessors: this.getDependencies(issueNum).map(d => d.toString()),
        successors: []
      });
    }

    // Build successor lists
    for (const [issueNum, deps] of this.issueDependencies) {
      for (const depNum of deps) {
        const depNode = nodes.get(depNum.toString());
        if (depNode) {
          depNode.successors.push(issueNum.toString());
        }
      }
    }

    // Forward pass - calculate early start/finish
    const sorted = this.topologicalSort(Array.from(nodes.keys()));

    for (const nodeId of sorted) {
      const node = nodes.get(nodeId);
      if (!node) continue;

      let maxPredFinish = 0;
      for (const predId of node.predecessors) {
        const pred = nodes.get(predId);
        if (pred && pred.earlyFinish > maxPredFinish) {
          maxPredFinish = pred.earlyFinish;
        }
      }

      node.earlyStart = maxPredFinish;
      node.earlyFinish = maxPredFinish + node.duration;
    }

    // Find project end time
    let projectEnd = 0;
    for (const node of nodes.values()) {
      if (node.earlyFinish > projectEnd) {
        projectEnd = node.earlyFinish;
      }
    }

    // Backward pass - calculate late start/finish
    for (const nodeId of sorted.slice().reverse()) {
      const node = nodes.get(nodeId);
      if (!node) continue;

      if (node.successors.length === 0) {
        node.lateFinish = projectEnd;
      } else {
        let minSuccStart = Infinity;
        for (const succId of node.successors) {
          const succ = nodes.get(succId);
          if (succ && succ.lateStart < minSuccStart) {
            minSuccStart = succ.lateStart;
          }
        }
        node.lateFinish = minSuccStart;
      }

      node.lateStart = node.lateFinish - node.duration;
      node.slack = node.lateStart - node.earlyStart;
    }

    // Critical path = nodes with zero slack
    const criticalNodes = [];
    for (const [nodeId, node] of nodes) {
      if (Math.abs(node.slack) < 0.001) { // Near-zero slack
        criticalNodes.push({
          id: nodeId,
          issueNumber: node.issueNumber,
          title: node.title,
          duration: node.duration,
          earlyStart: node.earlyStart,
          earlyFinish: node.earlyFinish
        });
      }
    }

    // Sort by early start
    criticalNodes.sort((a, b) => a.earlyStart - b.earlyStart);

    return {
      nodes: criticalNodes,
      totalDuration: projectEnd,
      nodesWithSlack: Array.from(nodes.values())
        .filter(n => n.slack > 0)
        .map(n => ({
          id: n.issueNumber.toString(),
          issueNumber: n.issueNumber,
          title: n.title,
          slack: n.slack
        }))
        .sort((a, b) => a.slack - b.slack)
    };
  }
}
