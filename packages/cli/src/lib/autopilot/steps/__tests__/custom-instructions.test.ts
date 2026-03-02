import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  loadCustomInstructions,
  formatCustomInstructions,
  formatMaintainers,
} from '../custom-instructions.js';

describe('loadCustomInstructions', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'rover-ci-test-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('returns nulls when no files exist', () => {
    const result = loadCustomInstructions(projectPath, 'coordinate');
    expect(result).toEqual({ general: null, stepSpecific: null });
  });

  it('reads general instructions only', () => {
    const roverDir = join(projectPath, '.rover');
    mkdirSync(roverDir, { recursive: true });
    writeFileSync(join(roverDir, 'AUTOPILOT.md'), 'General rules here');

    const result = loadCustomInstructions(projectPath, 'coordinate');
    expect(result).toEqual({
      general: 'General rules here',
      stepSpecific: null,
    });
  });

  it('reads step-specific instructions only', () => {
    const roverDir = join(projectPath, '.rover');
    mkdirSync(roverDir, { recursive: true });
    writeFileSync(join(roverDir, 'AUTOPILOT.plan.md'), 'Plan-specific rules');

    const result = loadCustomInstructions(projectPath, 'plan');
    expect(result).toEqual({
      general: null,
      stepSpecific: 'Plan-specific rules',
    });
  });

  it('reads both general and step-specific instructions', () => {
    const roverDir = join(projectPath, '.rover');
    mkdirSync(roverDir, { recursive: true });
    writeFileSync(join(roverDir, 'AUTOPILOT.md'), 'General rules');
    writeFileSync(
      join(roverDir, 'AUTOPILOT.resolve.md'),
      'Resolve-specific rules'
    );

    const result = loadCustomInstructions(projectPath, 'resolve');
    expect(result).toEqual({
      general: 'General rules',
      stepSpecific: 'Resolve-specific rules',
    });
  });

  it('treats empty files as absent', () => {
    const roverDir = join(projectPath, '.rover');
    mkdirSync(roverDir, { recursive: true });
    writeFileSync(join(roverDir, 'AUTOPILOT.md'), '   \n  ');
    writeFileSync(join(roverDir, 'AUTOPILOT.notify.md'), '');

    const result = loadCustomInstructions(projectPath, 'notify');
    expect(result).toEqual({ general: null, stepSpecific: null });
  });
});

describe('formatCustomInstructions', () => {
  it('returns empty string when both are null', () => {
    expect(
      formatCustomInstructions({ general: null, stepSpecific: null })
    ).toBe('');
  });

  it('formats general instructions only', () => {
    const result = formatCustomInstructions({
      general: 'Always use TypeScript.',
      stepSpecific: null,
    });
    expect(result).toContain('## Custom Instructions');
    expect(result).toContain('Always use TypeScript.');
    expect(result).not.toContain('Step-Specific');
  });

  it('formats step-specific instructions only', () => {
    const result = formatCustomInstructions({
      general: null,
      stepSpecific: 'Keep commits small.',
    });
    expect(result).toContain('## Custom Instructions');
    expect(result).toContain('Keep commits small.');
    expect(result).not.toContain('Step-Specific');
  });

  it('formats both with step-specific heading when both present', () => {
    const result = formatCustomInstructions({
      general: 'General rule.',
      stepSpecific: 'Step rule.',
    });
    expect(result).toContain('## Custom Instructions');
    expect(result).toContain('General rule.');
    expect(result).toContain(
      '### Step-Specific Instructions (take precedence)'
    );
    expect(result).toContain('Step rule.');
  });
});

describe('formatMaintainers', () => {
  it('returns empty string for undefined', () => {
    expect(formatMaintainers(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(formatMaintainers([])).toBe('');
  });

  it('formats maintainers with @ prefix', () => {
    const result = formatMaintainers(['alice', 'bob']);
    expect(result).toContain('## Maintainers');
    expect(result).toContain('@alice');
    expect(result).toContain('@bob');
  });

  it('does not double-prefix @ handles', () => {
    const result = formatMaintainers(['@alice']);
    expect(result).toContain('@alice');
    expect(result).not.toContain('@@alice');
  });
});
