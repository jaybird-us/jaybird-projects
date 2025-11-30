/**
 * Project Field Management
 *
 * Auto-detects and creates required fields for jayBird Projects
 */

// Required fields for the app to function
export const REQUIRED_FIELDS = {
  // Core fields (Free tier)
  'Start Date': { type: 'DATE', required: true },
  'Target Date': { type: 'DATE', required: true },
  'Estimate': {
    type: 'SINGLE_SELECT',
    required: true,
    options: ['XS', 'S', 'M', 'L', 'XL', 'XXL']
  },

  // Pro fields
  'Baseline Start': { type: 'DATE', required: false, pro: true },
  'Baseline Target': { type: 'DATE', required: false, pro: true },
  'Confidence': {
    type: 'SINGLE_SELECT',
    required: false,
    pro: true,
    options: ['High', 'Medium', 'Low']
  },

  // Optional but useful
  'Actual End Date': { type: 'DATE', required: false }
};

/**
 * Get existing fields from a project
 */
export async function getProjectFields(octokit, projectId) {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await octokit.graphql(query, { projectId });
  return result.node?.fields?.nodes || [];
}

/**
 * Create a date field
 */
async function createDateField(octokit, projectId, name) {
  const mutation = `
    mutation($projectId: ID!, $name: String!) {
      createProjectV2Field(input: {
        projectId: $projectId
        dataType: DATE
        name: $name
      }) {
        projectV2Field {
          ... on ProjectV2Field {
            id
            name
          }
        }
      }
    }
  `;

  const result = await octokit.graphql(mutation, { projectId, name });
  return result.createProjectV2Field?.projectV2Field;
}

/**
 * Create a single select field with options
 */
async function createSingleSelectField(octokit, projectId, name, options) {
  const mutation = `
    mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
      createProjectV2Field(input: {
        projectId: $projectId
        dataType: SINGLE_SELECT
        name: $name
        singleSelectOptions: $options
      }) {
        projectV2Field {
          ... on ProjectV2SingleSelectField {
            id
            name
            options {
              id
              name
            }
          }
        }
      }
    }
  `;

  const optionInputs = options.map((name, index) => ({
    name,
    color: getOptionColor(index)
  }));

  const result = await octokit.graphql(mutation, {
    projectId,
    name,
    options: optionInputs
  });
  return result.createProjectV2Field?.projectV2Field;
}

/**
 * Get a color for single select options
 */
function getOptionColor(index) {
  const colors = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];
  return colors[index % colors.length];
}

/**
 * Normalize field name for comparison (case-insensitive, trim whitespace)
 */
function normalizeFieldName(name) {
  return name.toLowerCase().trim();
}

/**
 * Check if a field already exists (case-insensitive match)
 */
function fieldExists(existingFields, fieldName) {
  const normalized = normalizeFieldName(fieldName);
  return existingFields.some(f => normalizeFieldName(f.name) === normalized);
}

/**
 * Ensure all required fields exist on a project
 * Returns object with created fields and any errors
 */
export async function ensureProjectFields(octokit, projectId, logger, options = {}) {
  const { includePro = false } = options;

  const result = {
    existingFields: [],
    createdFields: [],
    skippedFields: [],
    errors: []
  };

  try {
    // Get existing fields
    const existingFields = await getProjectFields(octokit, projectId);
    result.existingFields = existingFields.map(f => f.name);

    logger.info({
      projectId,
      existingFields: result.existingFields
    }, 'Checking project fields');

    // Check each required field
    for (const [fieldName, fieldConfig] of Object.entries(REQUIRED_FIELDS)) {
      // Skip Pro fields if not requested
      if (fieldConfig.pro && !includePro) {
        result.skippedFields.push(fieldName);
        continue;
      }

      // Check if field already exists
      if (fieldExists(existingFields, fieldName)) {
        logger.debug({ fieldName }, 'Field already exists');
        continue;
      }

      // Create the field
      try {
        logger.info({ fieldName, type: fieldConfig.type }, 'Creating missing field');

        let createdField;
        if (fieldConfig.type === 'DATE') {
          createdField = await createDateField(octokit, projectId, fieldName);
        } else if (fieldConfig.type === 'SINGLE_SELECT') {
          createdField = await createSingleSelectField(
            octokit,
            projectId,
            fieldName,
            fieldConfig.options
          );
        }

        if (createdField) {
          result.createdFields.push(fieldName);
          logger.info({ fieldName, fieldId: createdField.id }, 'Field created');
        }
      } catch (fieldError) {
        logger.error({ fieldName, error: fieldError.message }, 'Failed to create field');
        result.errors.push({ field: fieldName, error: fieldError.message });
      }
    }

    return result;
  } catch (error) {
    logger.error({ error: error.message, projectId }, 'Failed to ensure project fields');
    throw error;
  }
}
