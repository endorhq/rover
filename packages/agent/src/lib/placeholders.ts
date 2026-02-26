/**
 * Shared placeholder resolution for {{inputs.X}} and {{steps.Y.outputs.Z}} patterns.
 * Used by command-runner, Runner, and ACPRunner to avoid triple-maintaining the same logic.
 */

export interface ResolveOptions {
  /** Input values provided to the workflow */
  inputs: Map<string, string>;
  /** Output values from previously executed steps */
  stepsOutput: Map<string, Map<string, string>>;
  /**
   * Optional callback to transform a resolved step output value before substitution.
   * Receives the step ID, output name, and raw value from stepsOutput.
   * Return the value to use in the template.
   */
  transformStepOutput?: (
    stepId: string,
    outputName: string,
    rawValue: string
  ) => string;
  /**
   * When true, throw an error listing all unresolved placeholders.
   * When false (default), leave unresolved placeholders in place.
   */
  failOnUnresolved?: boolean;
}

export interface ResolveResult {
  /** The template with resolved placeholders */
  text: string;
  /** Warnings about unresolved or problematic placeholders */
  warnings: string[];
}

/**
 * Resolve all {{...}} placeholders in a template string.
 *
 * Supports:
 *   - {{inputs.<name>}} — resolved from options.inputs
 *   - {{steps.<id>.outputs.<name>}} — resolved from options.stepsOutput
 *
 * Uses callback-form String.replace to avoid $& / $1 special patterns in values.
 */
export function resolvePlaceholders(
  template: string,
  options: ResolveOptions
): ResolveResult {
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  const matches = [...template.matchAll(placeholderRegex)];
  const warnings: string[] = [];
  const unresolved: string[] = [];
  let result = template;

  for (const match of matches) {
    const fullMatch = match[0];
    const rawPath = match[1].trim();
    const parts = rawPath.split('.');
    let replacementValue: string | undefined;

    if (parts[0] === 'inputs' && parts.length === 2) {
      const inputName = parts[1];
      const value = options.inputs.get(inputName);

      if (value !== undefined) {
        replacementValue = value;
      } else {
        warnings.push(`Input '${inputName}' not provided`);
        unresolved.push(fullMatch);
      }
    } else if (
      parts[0] === 'steps' &&
      parts.length === 4 &&
      parts[2] === 'outputs'
    ) {
      const stepId = parts[1];
      const outputName = parts[3];
      const stepOutputs = options.stepsOutput.get(stepId);

      if (!stepOutputs) {
        warnings.push(`Step '${stepId}' has not been executed yet`);
        unresolved.push(fullMatch);
      } else {
        const rawValue = stepOutputs.get(outputName);
        if (rawValue === undefined) {
          warnings.push(`Output '${outputName}' not found in step '${stepId}'`);
          unresolved.push(fullMatch);
        } else {
          replacementValue = options.transformStepOutput
            ? options.transformStepOutput(stepId, outputName, rawValue)
            : rawValue;
        }
      }
    } else {
      warnings.push(`Invalid placeholder format: '${rawPath}'`);
      unresolved.push(fullMatch);
    }

    // Use callback form to avoid $& / $1 special replacement patterns in values.
    if (replacementValue !== undefined) {
      result = result.replace(fullMatch, () => replacementValue!);
    }
  }

  if (options.failOnUnresolved && unresolved.length > 0) {
    throw new Error(`Unresolved placeholders: ${unresolved.join(', ')}`);
  }

  return { text: result, warnings };
}
