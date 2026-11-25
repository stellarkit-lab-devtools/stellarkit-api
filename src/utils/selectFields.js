const StellarKitError = require("./StellarKitError");

/**
 * Extracts a nested value from an object using dot notation.
 * 
 * @param {Object} obj - The source object
 * @param {string} path - Dot-separated path (e.g., "asset.code")
 * @returns {*} The value at the path, or undefined if not found
 */
function getNestedValue(obj, path) {
  const parts = path.split(".");
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  
  return current;
}

/**
 * Sets a nested value in an object using dot notation.
 * Creates intermediate objects as needed.
 * 
 * @param {Object} obj - The target object
 * @param {string} path - Dot-separated path (e.g., "asset.code")
 * @param {*} value - The value to set
 */
function setNestedValue(obj, path, value) {
  const parts = path.split(".");
  const lastPart = parts.pop();
  
  let current = obj;
  for (const part of parts) {
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  
  current[lastPart] = value;
}

/**
 * Validates that requested fields are in the allow-list.
 * 
 * @param {string[]} requestedFields - Fields from ?fields= query param
 * @param {string[]} allowedFields - Allowed field names (supports dot paths)
 * @throws {StellarKitError} If validation fails
 */
function validateFields(requestedFields, allowedFields) {
  const allowedSet = new Set(allowedFields);
  const invalid = [];
  
  for (const field of requestedFields) {
    // Check exact match or if it's a valid nested path
    const baseField = field.split(".")[0];
    
    // Check if field or its base is in allowed list
    if (!allowedSet.has(field) && !allowedSet.has(baseField)) {
      invalid.push(field);
    }
  }
  
  if (invalid.length > 0) {
    throw new StellarKitError(
      `Invalid fields requested: ${invalid.join(", ")}. Valid fields are: ${allowedFields.sort().join(", ")}`,
      400,
      "InvalidFields",
      `The following fields are not allowed: ${invalid.join(", ")}`,
      `Use only the allowed fields: ${allowedFields.sort().join(", ")}`
    );
  }
}

/**
 * Applies field selection to a single object.
 * 
 * @param {Object} item - The item to filter
 * @param {string[]} fields - Array of field names to include (supports dot notation)
 * @returns {Object} New object with only selected fields
 */
function selectFieldsFromItem(item, fields) {
  if (!item || typeof item !== "object") {
    return item;
  }
  
  const result = {};
  
  for (const field of fields) {
    const value = getNestedValue(item, field);
    if (value !== undefined) {
      setNestedValue(result, field, value);
    }
  }
  
  return result;
}

/**
 * Applies field selection to data array or single object.
 * 
 * @param {Array|Object} data - The data to filter
 * @param {string[]} fields - Array of field names to include
 * @returns {Array|Object} Filtered data
 */
function applyFieldSelection(data, fields) {
  if (Array.isArray(data)) {
    return data.map(item => selectFieldsFromItem(item, fields));
  }
  
  return selectFieldsFromItem(data, fields);
}

/**
 * Parses and validates the ?fields= query parameter.
 * 
 * @param {string|undefined} fieldsParam - The ?fields= query parameter value
 * @param {string[]} allowedFields - Array of allowed field names
 * @returns {string[]|null} Array of field names, or null if not specified
 * @throws {StellarKitError} If fields param is invalid
 */
function parseFieldsParam(fieldsParam, allowedFields) {
  // If not provided, return null (no field selection)
  if (fieldsParam === undefined || fieldsParam === null) {
    return null;
  }
  
  // Convert to string and trim
  const fieldsStr = String(fieldsParam).trim();
  
  // Empty string is invalid
  if (fieldsStr === "") {
    throw new StellarKitError(
      "Query parameter 'fields' cannot be empty. Omit it to return all fields, or specify a comma-separated list.",
      400,
      "InvalidFields",
      "The fields parameter was provided but is empty",
      `Specify fields like ?fields=hash,createdAt or omit the parameter entirely. Valid fields: ${allowedFields.sort().join(", ")}`
    );
  }
  
  // Split by comma and trim each field
  const fields = fieldsStr
    .split(",")
    .map(f => f.trim())
    .filter(f => f.length > 0);
  
  // Must have at least one field
  if (fields.length === 0) {
    throw new StellarKitError(
      "Query parameter 'fields' must contain at least one valid field name.",
      400,
      "InvalidFields",
      "No valid field names found after parsing",
      `Valid fields: ${allowedFields.sort().join(", ")}`
    );
  }
  
  // Validate against allow-list
  validateFields(fields, allowedFields);
  
  return fields;
}

/**
 * Main helper function to handle field selection in routes.
 * Call this after cache lookup but before returning the response.
 * 
 * @param {Object} responseData - The full response data object
 * @param {string|undefined} fieldsParam - The ?fields= query parameter
 * @param {string[]} allowedFields - Array of allowed field names
 * @returns {Object} Response data with field selection applied
 * 
 * @example
 * const result = selectFields(cachedData, req.query.fields, [
 *   'id', 'hash', 'createdAt', 'asset.code', 'asset.issuer'
 * ]);
 */
function selectFields(responseData, fieldsParam, allowedFields) {
  // Parse and validate fields parameter
  const fields = parseFieldsParam(fieldsParam, allowedFields);
  
  // If no fields specified, return data unchanged
  if (!fields) {
    return responseData;
  }
  
  // Apply field selection to the data
  // The data can be in responseData directly or in responseData.data
  if (responseData.data !== undefined) {
    return {
      ...responseData,
      data: applyFieldSelection(responseData.data, fields)
    };
  }
  
  return applyFieldSelection(responseData, fields);
}

module.exports = {
  selectFields,
  parseFieldsParam,
  validateFields,
  applyFieldSelection,
  selectFieldsFromItem,
  getNestedValue,
  setNestedValue,
};
