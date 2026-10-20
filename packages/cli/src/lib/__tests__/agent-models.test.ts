import { AI_AGENT } from 'rover-core';
import { describe, expect, it } from 'vitest';
import { getAvailableModels, getDefaultModelName } from '../agent-models.js';

describe('MiniMax model catalog', () => {
  it('lists only the current models with MiniMax-M3.1-Flash first and default', () => {
    expect(
      getAvailableModels(AI_AGENT.MiniMax).map(model => model.name)
    ).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(getDefaultModelName(AI_AGENT.MiniMax)).toBe('MiniMax-M3.1-Flash');
  });
});
