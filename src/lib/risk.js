/**
 * Risk Detection Module
 *
 * Calculates risk scores for project items based on multiple factors:
 * - Overdue items
 * - Approaching deadlines with low progress
 * - Low confidence estimates
 * - Missing estimates or target dates
 * - Blocked items
 * - Items behind baseline
 */

// Risk factor weights (points)
export const RISK_WEIGHTS = {
  overdue: 35,              // Target date is past and item is open
  approachingDeadline: 20,  // Within 5 days of target with low % complete
  lowConfidence: 15,        // Confidence is "Low"
  noEstimate: 10,           // Missing estimate
  noTargetDate: 10,         // Missing target date
  blocked: 15,              // Has uncompleted dependencies
  behindBaseline: 15,       // Current target later than baseline
  noStartDate: 5,           // Has target but no start date
};

// Risk level thresholds
export const RISK_LEVELS = {
  critical: 50,   // 50+ points
  high: 30,       // 30-49 points
  medium: 15,     // 15-29 points
  low: 1,         // 1-14 points
  none: 0         // 0 points
};

/**
 * Calculate risk score for a single project item
 */
export function calculateItemRisk(item, allItems, today = new Date()) {
  const risks = [];
  let totalScore = 0;
  const todayStr = today.toISOString().split('T')[0];

  // Skip completed items
  if (item.state === 'CLOSED' || item.status === 'Done') {
    return {
      issueNumber: item.issueNumber,
      title: item.title,
      score: 0,
      level: 'none',
      risks: [],
      isCompleted: true
    };
  }

  // 1. Overdue check
  if (item.targetDate && item.targetDate < todayStr) {
    const daysOverdue = Math.floor(
      (today - new Date(item.targetDate + 'T00:00:00Z')) / (1000 * 60 * 60 * 24)
    );
    risks.push({
      type: 'overdue',
      message: `Overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}`,
      weight: RISK_WEIGHTS.overdue,
      severity: 'critical'
    });
    totalScore += RISK_WEIGHTS.overdue;
  }

  // 2. Approaching deadline with low progress
  if (item.targetDate && item.targetDate >= todayStr) {
    const daysUntilTarget = Math.floor(
      (new Date(item.targetDate + 'T00:00:00Z') - today) / (1000 * 60 * 60 * 24)
    );

    if (daysUntilTarget <= 5) {
      const percentComplete = parsePercentComplete(item.percentComplete);
      if (percentComplete < 80) {
        risks.push({
          type: 'approachingDeadline',
          message: `Due in ${daysUntilTarget} day${daysUntilTarget !== 1 ? 's' : ''} with only ${percentComplete}% complete`,
          weight: RISK_WEIGHTS.approachingDeadline,
          severity: 'high'
        });
        totalScore += RISK_WEIGHTS.approachingDeadline;
      }
    }
  }

  // 3. Low confidence
  if (item.confidence === 'Low') {
    risks.push({
      type: 'lowConfidence',
      message: 'Low confidence estimate',
      weight: RISK_WEIGHTS.lowConfidence,
      severity: 'medium'
    });
    totalScore += RISK_WEIGHTS.lowConfidence;
  }

  // 4. No estimate
  if (!item.estimate) {
    risks.push({
      type: 'noEstimate',
      message: 'Missing size estimate',
      weight: RISK_WEIGHTS.noEstimate,
      severity: 'medium'
    });
    totalScore += RISK_WEIGHTS.noEstimate;
  }

  // 5. No target date
  if (!item.targetDate) {
    risks.push({
      type: 'noTargetDate',
      message: 'No target date set',
      weight: RISK_WEIGHTS.noTargetDate,
      severity: 'medium'
    });
    totalScore += RISK_WEIGHTS.noTargetDate;
  }

  // 6. Blocked by uncompleted dependencies
  if (item.blockedBy && item.blockedBy.length > 0) {
    const blockingItems = item.blockedBy.filter(depNum => {
      const depItem = allItems.get(depNum);
      return depItem && depItem.state !== 'CLOSED' && depItem.status !== 'Done';
    });

    if (blockingItems.length > 0) {
      risks.push({
        type: 'blocked',
        message: `Blocked by ${blockingItems.length} incomplete item${blockingItems.length !== 1 ? 's' : ''}`,
        weight: RISK_WEIGHTS.blocked,
        severity: 'high',
        blockingIssues: blockingItems
      });
      totalScore += RISK_WEIGHTS.blocked;
    }
  }

  // 7. Behind baseline
  if (item.baselineTarget && item.targetDate && item.targetDate > item.baselineTarget) {
    const daysSlipped = Math.floor(
      (new Date(item.targetDate + 'T00:00:00Z') - new Date(item.baselineTarget + 'T00:00:00Z')) / (1000 * 60 * 60 * 24)
    );
    risks.push({
      type: 'behindBaseline',
      message: `${daysSlipped} day${daysSlipped !== 1 ? 's' : ''} behind baseline`,
      weight: RISK_WEIGHTS.behindBaseline,
      severity: 'medium'
    });
    totalScore += RISK_WEIGHTS.behindBaseline;
  }

  // 8. No start date but has target
  if (item.targetDate && !item.startDate) {
    risks.push({
      type: 'noStartDate',
      message: 'No start date set',
      weight: RISK_WEIGHTS.noStartDate,
      severity: 'low'
    });
    totalScore += RISK_WEIGHTS.noStartDate;
  }

  // Determine risk level
  let level = 'none';
  if (totalScore >= RISK_LEVELS.critical) {
    level = 'critical';
  } else if (totalScore >= RISK_LEVELS.high) {
    level = 'high';
  } else if (totalScore >= RISK_LEVELS.medium) {
    level = 'medium';
  } else if (totalScore >= RISK_LEVELS.low) {
    level = 'low';
  }

  return {
    issueNumber: item.issueNumber,
    title: item.title,
    score: totalScore,
    level,
    risks,
    isCompleted: false,
    targetDate: item.targetDate,
    estimate: item.estimate,
    confidence: item.confidence,
    percentComplete: item.percentComplete
  };
}

/**
 * Calculate risk scores for all project items
 */
export function calculateProjectRisks(projectItems) {
  const itemsMap = new Map();

  // First pass: build map for dependency lookup
  for (const item of projectItems.values()) {
    itemsMap.set(item.issueNumber, item);
  }

  // Second pass: calculate risks
  const riskAssessments = [];
  for (const item of projectItems.values()) {
    const assessment = calculateItemRisk(item, itemsMap);
    riskAssessments.push(assessment);
  }

  // Sort by risk score (highest first)
  riskAssessments.sort((a, b) => b.score - a.score);

  // Generate summary
  const summary = {
    total: riskAssessments.length,
    byLevel: {
      critical: riskAssessments.filter(r => r.level === 'critical').length,
      high: riskAssessments.filter(r => r.level === 'high').length,
      medium: riskAssessments.filter(r => r.level === 'medium').length,
      low: riskAssessments.filter(r => r.level === 'low').length,
      none: riskAssessments.filter(r => r.level === 'none').length
    },
    byType: {},
    averageScore: 0,
    highestScore: 0
  };

  // Count risk types
  for (const assessment of riskAssessments) {
    for (const risk of assessment.risks) {
      summary.byType[risk.type] = (summary.byType[risk.type] || 0) + 1;
    }
    if (assessment.score > summary.highestScore) {
      summary.highestScore = assessment.score;
    }
  }

  const openItems = riskAssessments.filter(r => !r.isCompleted);
  if (openItems.length > 0) {
    summary.averageScore = Math.round(
      openItems.reduce((sum, r) => sum + r.score, 0) / openItems.length
    );
  }

  return {
    items: riskAssessments,
    summary
  };
}

/**
 * Parse percent complete field value
 */
function parsePercentComplete(value) {
  if (!value) return 0;

  // Handle string values like "50%", "75%", etc.
  const match = value.match(/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return 0;
}

/**
 * Get risk level color for UI
 */
export function getRiskLevelColor(level) {
  switch (level) {
    case 'critical': return 'destructive';
    case 'high': return 'warning';
    case 'medium': return 'secondary';
    case 'low': return 'outline';
    default: return 'default';
  }
}
