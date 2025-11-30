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
  }

  async initialize() {
    // Get installation settings
    this.settings = getInstallationSettings(this.installationId);

    // Get holidays and add to settings
    const holidays = getHolidays(this.installationId);
    const holidayDates = holidays.map(h => h.date);
    this.settings.holidays = holidayDates;

    // Initialize date utilities
    this.dateUtils = new DateUtils(this.settings);

    // Get authenticated Octokit
    const auth = getGitHubAuth();
    this.octokit = await auth.getInstallationOctokit(this.installationId);
  }

  /**
   * Load project items from GitHub
   */
  async loadProjectItems(owner, projectNumber) {
    await this.initialize();

    const project = getProject(this.installationId, owner, projectNumber);
    if (!project) {
      throw new Error(`Project not found: ${owner}/${projectNumber}`);
    }

    this.logger.info({ owner, projectNumber }, 'Loading project items');

    const query = `
      query($owner: String!, $projectNumber: Int!) {
        organization(login: $owner) {
          projectV2(number: $projectNumber) {
            id
            items(first: 100) {
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

    const result = await this.octokit.graphql(query, {
      owner,
      projectNumber
    });

    const items = result.organization?.projectV2?.items?.nodes || [];
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

      // Track sub-issues
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
   * Update a single field value in GitHub
   */
  async updateItemField(project, issueNumber, fieldName, value) {
    const item = this.projectItems.get(issueNumber);
    if (!item) return false;

    const fieldIdMap = {
      startDate: project.start_date_field_id,
      targetDate: project.target_date_field_id,
      actualEndDate: project.actual_end_date_field_id,
      baselineStart: project.baseline_start_field_id,
      baselineTarget: project.baseline_target_field_id
    };

    const fieldId = fieldIdMap[fieldName];
    if (!fieldId) {
      this.logger.warn({ fieldName }, 'Field ID not configured');
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
}
