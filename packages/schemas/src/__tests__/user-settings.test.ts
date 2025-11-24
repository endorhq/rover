import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearProjectRootCache, launchSync, AI_AGENT } from 'rover-common';
import { UserSettingsManager } from '../user-settings.js';

describe('UserSettingsManager', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-settings-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize a git repo for testing
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });

    clearProjectRootCache();
  });

  describe('createDefault', () => {
    it('should create default settings when file does not exist', () => {
      const settings = UserSettingsManager.createDefault();

      expect(existsSync('.rover/settings.json')).toBe(true);
      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));

      // Version should be 1.0
      expect(jsonData.version).toBe('1.0');

      // Should have empty arrays and empty defaults
      expect(jsonData.aiAgents).toEqual([]);
      expect(jsonData.defaults).toEqual({});

      // Getters should return expected values
      expect(settings.version).toBe('1.0');
      expect(settings.aiAgents).toEqual([]);
      expect(settings.defaultAiAgent).toBeUndefined();
    });

    it('should create .rover directory if it does not exist', () => {
      expect(existsSync('.rover')).toBe(false);

      UserSettingsManager.createDefault();

      expect(existsSync('.rover')).toBe(true);
      expect(existsSync('.rover/settings.json')).toBe(true);
    });
  });

  describe('load', () => {
    it('should create default settings when file does not exist', () => {
      const settings = UserSettingsManager.load();

      expect(settings.version).toBe('1.0');
      expect(settings.aiAgents).toEqual([]);
      expect(settings.defaultAiAgent).toBeUndefined();
    });

    it('should load existing settings file', () => {
      mkdirSync('.rover');
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(
          {
            version: '1.0',
            aiAgents: [AI_AGENT.Claude, AI_AGENT.Gemini],
            defaults: {
              aiAgent: AI_AGENT.Claude,
            },
          },
          null,
          2
        )
      );

      const settings = UserSettingsManager.load();

      expect(settings.version).toBe('1.0');
      expect(settings.aiAgents).toEqual([AI_AGENT.Claude, AI_AGENT.Gemini]);
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);
    });

    it('should migrate old version settings', () => {
      mkdirSync('.rover');
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(
          {
            version: '0.9',
            // Old version might not have all fields
          },
          null,
          2
        )
      );

      const settings = UserSettingsManager.load();

      // Should be migrated to current version
      expect(settings.version).toBe('1.0');
      // Migration provides default Claude agent
      expect(settings.aiAgents).toEqual([AI_AGENT.Claude]);
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);

      // Check saved file
      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(jsonData.version).toBe('1.0');
      expect(jsonData.aiAgents).toEqual([AI_AGENT.Claude]);
      expect(jsonData.defaults.aiAgent).toBe(AI_AGENT.Claude);
    });

    it('should not re-migrate current version settings', () => {
      mkdirSync('.rover');
      const originalData = {
        version: '1.0',
        aiAgents: [AI_AGENT.Gemini],
        defaults: {
          aiAgent: AI_AGENT.Gemini,
        },
      };
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(originalData, null, 2)
      );

      const settings = UserSettingsManager.load();

      // Should remain at version 1.0
      expect(settings.version).toBe('1.0');

      // All fields should be preserved exactly
      expect(settings.aiAgents).toEqual([AI_AGENT.Gemini]);
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Gemini);

      // Check file wasn't re-saved (would change formatting)
      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(jsonData).toEqual(originalData);
    });
  });

  describe('exists', () => {
    it('should return false when settings file does not exist', () => {
      expect(UserSettingsManager.exists()).toBe(false);
    });

    it('should return true when settings file exists', () => {
      mkdirSync('.rover');
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify({
          version: '1.0',
          aiAgents: [],
          defaults: {},
        })
      );

      expect(UserSettingsManager.exists()).toBe(true);
    });
  });

  describe('save', () => {
    it('should save settings to disk', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);

      expect(existsSync('.rover/settings.json')).toBe(true);
      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(jsonData.aiAgents).toContain(AI_AGENT.Claude);
    });

    it('should create .rover directory if it does not exist', () => {
      const settings = new (UserSettingsManager as any)({
        version: '1.0',
        aiAgents: [],
        defaults: {},
      });

      expect(existsSync('.rover')).toBe(false);

      settings.save();

      expect(existsSync('.rover')).toBe(true);
      expect(existsSync('.rover/settings.json')).toBe(true);
    });
  });

  describe('reload', () => {
    it('should reload settings from disk', () => {
      const settings = UserSettingsManager.createDefault();

      // Modify file on disk
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(
          {
            version: '1.0',
            aiAgents: [AI_AGENT.Claude],
            defaults: {
              aiAgent: AI_AGENT.Claude,
            },
          },
          null,
          2
        )
      );

      // Before reload, instance should have old data
      expect(settings.aiAgents).toEqual([]);

      // After reload, instance should have new data
      settings.reload();
      expect(settings.aiAgents).toEqual([AI_AGENT.Claude]);
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);
    });
  });

  describe('setDefaultAiAgent', () => {
    it('should set default AI agent', () => {
      const settings = UserSettingsManager.createDefault();

      settings.setDefaultAiAgent(AI_AGENT.Claude);

      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);
    });

    it('should automatically add agent to available agents list', () => {
      const settings = UserSettingsManager.createDefault();

      expect(settings.aiAgents).toEqual([]);

      settings.setDefaultAiAgent(AI_AGENT.Claude);

      expect(settings.aiAgents).toContain(AI_AGENT.Claude);
    });

    it('should not duplicate agent if already in list', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);

      expect(settings.aiAgents).toEqual([AI_AGENT.Claude]);

      settings.setDefaultAiAgent(AI_AGENT.Claude);

      // Should still have only one instance
      expect(settings.aiAgents).toEqual([AI_AGENT.Claude]);
    });

    it('should save settings after updating default', () => {
      const settings = UserSettingsManager.createDefault();

      settings.setDefaultAiAgent(AI_AGENT.Gemini);

      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(jsonData.defaults.aiAgent).toBe(AI_AGENT.Gemini);
      expect(jsonData.aiAgents).toContain(AI_AGENT.Gemini);
    });
  });

  describe('addAiAgent', () => {
    it('should add AI agent to list', () => {
      const settings = UserSettingsManager.createDefault();

      settings.addAiAgent(AI_AGENT.Claude);

      expect(settings.aiAgents).toContain(AI_AGENT.Claude);
    });

    it('should not duplicate agent if already in list', () => {
      const settings = UserSettingsManager.createDefault();

      settings.addAiAgent(AI_AGENT.Claude);
      settings.addAiAgent(AI_AGENT.Claude);

      expect(settings.aiAgents).toEqual([AI_AGENT.Claude]);
    });

    it('should save settings after adding agent', () => {
      const settings = UserSettingsManager.createDefault();

      settings.addAiAgent(AI_AGENT.Gemini);

      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(jsonData.aiAgents).toContain(AI_AGENT.Gemini);
    });

    it('should support multiple different agents', () => {
      const settings = UserSettingsManager.createDefault();

      settings.addAiAgent(AI_AGENT.Claude);
      settings.addAiAgent(AI_AGENT.Gemini);

      expect(settings.aiAgents).toEqual([AI_AGENT.Claude, AI_AGENT.Gemini]);
    });
  });

  describe('removeAiAgent', () => {
    it('should remove AI agent from list', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);
      settings.addAiAgent(AI_AGENT.Gemini);

      settings.removeAiAgent(AI_AGENT.Claude);

      expect(settings.aiAgents).toEqual([AI_AGENT.Gemini]);
    });

    it('should do nothing if agent not in list', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);

      settings.removeAiAgent(AI_AGENT.Gemini);

      expect(settings.aiAgents).toEqual([AI_AGENT.Claude]);
    });

    it('should update default if removed agent was the default', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);
      settings.addAiAgent(AI_AGENT.Gemini);
      settings.setDefaultAiAgent(AI_AGENT.Claude);

      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);

      settings.removeAiAgent(AI_AGENT.Claude);

      // Should automatically switch to the remaining agent
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Gemini);
    });

    it('should not update default if removed agent was not the default', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);
      settings.addAiAgent(AI_AGENT.Gemini);
      settings.setDefaultAiAgent(AI_AGENT.Claude);

      settings.removeAiAgent(AI_AGENT.Gemini);

      // Default should remain unchanged
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);
    });

    it('should save settings after removing agent', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);
      settings.addAiAgent(AI_AGENT.Gemini);

      settings.removeAiAgent(AI_AGENT.Claude);

      const jsonData = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(jsonData.aiAgents).toEqual([AI_AGENT.Gemini]);
    });
  });

  describe('toJSON', () => {
    it('should return a copy of the data', () => {
      const settings = UserSettingsManager.createDefault();
      settings.addAiAgent(AI_AGENT.Claude);

      const json = settings.toJSON();

      expect(json).toEqual({
        version: '1.0',
        aiAgents: [AI_AGENT.Claude],
        defaults: {},
      });
    });

    it('should return a copy, not a reference', () => {
      const settings = UserSettingsManager.createDefault();

      const json = settings.toJSON();
      json.aiAgents.push(AI_AGENT.Claude);

      // Original should be unchanged
      expect(settings.aiAgents).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty agents array', () => {
      mkdirSync('.rover');
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(
          {
            version: '1.0',
            aiAgents: [],
            defaults: {},
          },
          null,
          2
        )
      );

      const settings = UserSettingsManager.load();

      expect(settings.aiAgents).toEqual([]);
      expect(settings.defaultAiAgent).toBeUndefined();
    });

    it('should handle removing last agent when it is the default', () => {
      const settings = UserSettingsManager.createDefault();
      settings.setDefaultAiAgent(AI_AGENT.Claude);

      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);

      settings.removeAiAgent(AI_AGENT.Claude);

      // No agents left, default should still be Claude (not changed)
      // because there are no other agents to switch to
      expect(settings.aiAgents).toEqual([]);
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);
    });

    it('should handle settings with no defaults object in old versions', () => {
      mkdirSync('.rover');
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(
          {
            version: '0.9',
            aiAgents: [AI_AGENT.Gemini],
          },
          null,
          2
        )
      );

      const settings = UserSettingsManager.load();

      // Migration should add default from Claude fallback
      expect(settings.version).toBe('1.0');
      expect(settings.defaultAiAgent).toBe(AI_AGENT.Claude);
    });
  });
});
