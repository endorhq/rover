/**
 * Shared condition evaluator for workflow step `if` guards and loop `until` clauses.
 *
 * Supports format: steps.<id>.outputs.<name> == <value>
 *                   steps.<id>.outputs.<name> != <value>
 * Multiple clauses can be joined with `||` (logical OR).
 */

/**
 * Normalize known boolean-like strings to canonical lowercase form.
 * Ensures "True", "TRUE", "yes", "Yes" etc. match "true" in conditions.
 */
function normalizeBoolean(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'true' || lower === 'yes') return 'true';
  if (lower === 'false' || lower === 'no') return 'false';
  return value;
}

/**
 * Evaluate a condition string against the current step outputs.
 * Supports OR (`||`) to join multiple clauses — returns true if any clause is true.
 *
 * @param condition - e.g. "steps.run_tests.outputs.exit_code == 0 || steps.checkpoint.outputs.exit_code != 0"
 * @param stepsOutput - Map of step ID → output Map
 * @returns true if condition is met
 */
export function evaluateCondition(
  condition: string,
  stepsOutput: Map<string, Map<string, string>>
): boolean {
  // Detect unsupported && (AND) operator and warn explicitly
  if (/&&/.test(condition)) {
    console.warn(
      `Warning: "&&" (AND) operator is not supported in conditions. Use separate steps with "if" conditions instead. Condition: "${condition}"`
    );
    return false;
  }

  const parts = condition.split(/\s*\|\|\s*/);
  return parts.some(part => evaluateSingleCondition(part.trim(), stepsOutput));
}

/**
 * Evaluate a single condition clause (no OR).
 */
function evaluateSingleCondition(
  condition: string,
  stepsOutput: Map<string, Map<string, string>>
): boolean {
  // All comparisons are string-based: command outputs and YAML values are always strings,
  // so e.g. `exit_code == 0` compares the string "0" to the string "0".
  const trimmed = condition.trim();

  // Match: steps.<stepId>.outputs.<outputName> <operator> <value>
  // Step/output IDs may contain word chars and hyphens (e.g. "run-tests").
  const match = trimmed.match(
    /^steps\.([\w-]+)\.outputs\.([\w-]+)\s*(==|!=)\s*(.+)$/
  );
  if (!match) {
    console.warn(
      `Warning: clause "${condition}" does not match expected format "steps.<id>.outputs.<name> == <value>"`
    );
    return false;
  }

  const [, stepId, outputName, operator, rawValue] = match;
  const expectedValue = rawValue.trim();

  const stepOutputs = stepsOutput.get(stepId);
  if (!stepOutputs) {
    // Step hasn't produced output yet — treat as undefined.
    // `== X` → false, `!= X` → true (undefined is not equal to anything).
    return operator === '!=';
  }

  const actualValue = stepOutputs.get(outputName);
  if (actualValue === undefined) {
    return operator === '!=';
  }

  // Normalize known boolean strings so "True"/"TRUE"/"yes" match "true", etc.
  const normActual = normalizeBoolean(actualValue);
  const normExpected = normalizeBoolean(expectedValue);

  if (operator === '==') {
    return normActual === normExpected;
  }

  // operator === '!='
  return normActual !== normExpected;
}
