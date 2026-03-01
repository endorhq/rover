import { describe, it, expect, vi } from 'vitest';
import { evaluateCondition } from '../condition.js';

describe('evaluateCondition', () => {
  it('returns true when == condition matches', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map([['exit_code', '0']]));

    expect(
      evaluateCondition('steps.run_tests.outputs.exit_code == 0', stepsOutput)
    ).toBe(true);
  });

  it('returns false when == condition does not match', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map([['exit_code', '1']]));

    expect(
      evaluateCondition('steps.run_tests.outputs.exit_code == 0', stepsOutput)
    ).toBe(false);
  });

  it('returns true when != condition matches', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map([['exit_code', '1']]));

    expect(
      evaluateCondition('steps.run_tests.outputs.exit_code != 0', stepsOutput)
    ).toBe(true);
  });

  it('returns false when != condition does not match', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map([['exit_code', '0']]));

    expect(
      evaluateCondition('steps.run_tests.outputs.exit_code != 0', stepsOutput)
    ).toBe(false);
  });

  it('returns false when step does not exist (== operator)', () => {
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(
      evaluateCondition(
        'steps.missing_step.outputs.exit_code == 0',
        stepsOutput
      )
    ).toBe(false);
  });

  it('returns true when step does not exist (!= operator)', () => {
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(
      evaluateCondition(
        'steps.missing_step.outputs.exit_code != 0',
        stepsOutput
      )
    ).toBe(true);
  });

  it('returns false when output key does not exist (== operator)', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map());

    expect(
      evaluateCondition('steps.run_tests.outputs.exit_code == 0', stepsOutput)
    ).toBe(false);
  });

  it('returns true when output key does not exist (!= operator)', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map());

    expect(
      evaluateCondition('steps.run_tests.outputs.exit_code != 0', stepsOutput)
    ).toBe(true);
  });

  it('returns false and warns for invalid condition format', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(evaluateCondition('invalid condition', stepsOutput)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('does not match expected format')
    );
    warnSpy.mockRestore();
  });

  it('returns false and warns when using && operator', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('a', new Map([['x', '1']]));
    stepsOutput.set('b', new Map([['y', '2']]));

    expect(
      evaluateCondition(
        'steps.a.outputs.x == 1 && steps.b.outputs.y == 2',
        stepsOutput
      )
    ).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"&&" (AND) operator is not supported')
    );
    warnSpy.mockRestore();
  });

  it('handles whitespace in condition', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run_tests', new Map([['exit_code', '0']]));

    expect(
      evaluateCondition(
        '  steps.run_tests.outputs.exit_code  ==  0  ',
        stepsOutput
      )
    ).toBe(true);
  });

  it('supports hyphenated step and output IDs', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('run-tests', new Map([['exit-code', '0']]));

    expect(
      evaluateCondition('steps.run-tests.outputs.exit-code == 0', stepsOutput)
    ).toBe(true);
  });

  it('normalizes boolean-like values case-insensitively', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'True']]));

    expect(
      evaluateCondition(
        'steps.review.outputs.issues_found == true',
        stepsOutput
      )
    ).toBe(true);
  });

  it('treats "yes" as equivalent to "true"', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'yes']]));

    expect(
      evaluateCondition(
        'steps.review.outputs.issues_found == true',
        stepsOutput
      )
    ).toBe(true);
  });

  it('treats "no" as equivalent to "false"', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('review', new Map([['issues_found', 'no']]));

    expect(
      evaluateCondition(
        'steps.review.outputs.issues_found == false',
        stepsOutput
      )
    ).toBe(true);
  });

  it('does not normalize non-boolean strings', () => {
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('check', new Map([['status', 'Passed']]));

    expect(
      evaluateCondition('steps.check.outputs.status == passed', stepsOutput)
    ).toBe(false);
  });

  describe('OR (||) conditions', () => {
    it('returns true when first clause is true', () => {
      const stepsOutput = new Map<string, Map<string, string>>();
      stepsOutput.set('run_tests', new Map([['exit_code', '0']]));
      stepsOutput.set('checkpoint', new Map([['exit_code', '0']]));

      expect(
        evaluateCondition(
          'steps.run_tests.outputs.exit_code == 0 || steps.checkpoint.outputs.exit_code != 0',
          stepsOutput
        )
      ).toBe(true);
    });

    it('returns true when second clause is true', () => {
      const stepsOutput = new Map<string, Map<string, string>>();
      stepsOutput.set('run_tests', new Map([['exit_code', '1']]));
      stepsOutput.set('checkpoint', new Map([['exit_code', '1']]));

      expect(
        evaluateCondition(
          'steps.run_tests.outputs.exit_code == 0 || steps.checkpoint.outputs.exit_code != 0',
          stepsOutput
        )
      ).toBe(true);
    });

    it('returns false when neither clause is true', () => {
      const stepsOutput = new Map<string, Map<string, string>>();
      stepsOutput.set('run_tests', new Map([['exit_code', '1']]));
      stepsOutput.set('checkpoint', new Map([['exit_code', '0']]));

      expect(
        evaluateCondition(
          'steps.run_tests.outputs.exit_code == 0 || steps.checkpoint.outputs.exit_code != 0',
          stepsOutput
        )
      ).toBe(false);
    });
  });
});
