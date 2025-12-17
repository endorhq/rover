import { describe, expect, it } from 'vitest';
import { containsGeminiYoloWarning } from '../gemini.js';

describe('containsGeminiYoloWarning', () => {
  it('detects standard warning message', () => {
    const text =
      'YOLO mode is enabled. All tool calls will be automatically approved.';
    expect(containsGeminiYoloWarning(text)).toBe(true);
  });

  it('detects variations in casing and related wording', () => {
    const text = 'Global Auto Approve is ON for Gemini.';
    expect(containsGeminiYoloWarning(text)).toBe(true);
  });

  it('returns false for unrelated messages', () => {
    expect(containsGeminiYoloWarning('All systems nominal')).toBe(false);
  });
});
