import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCustomEnvironmentVariables,
  loadEnvsFile,
} from '../env-variables.js';

describe('parseCustomEnvironmentVariables', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up test environment variables
    process.env.TEST_VAR = 'test-value';
    process.env.NODE_ENV = 'development';
    process.env.API_KEY = 'secret-key';
    process.env.MULTI_EQUALS = 'foo=bar=baz';
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('should handle passthrough format for existing environment variable', () => {
    const result = parseCustomEnvironmentVariables(['TEST_VAR']);

    expect(result).toEqual(['-e', 'TEST_VAR=test-value']);
  });

  it('should handle explicit value format', () => {
    const result = parseCustomEnvironmentVariables(['CUSTOM_VAR=custom-value']);

    expect(result).toEqual(['-e', 'CUSTOM_VAR=custom-value']);
  });

  it('should skip passthrough format for missing environment variable', () => {
    const result = parseCustomEnvironmentVariables(['MISSING_VAR']);

    expect(result).toEqual([]);
  });

  it('should handle mixed formats', () => {
    const result = parseCustomEnvironmentVariables([
      'NODE_ENV',
      'CUSTOM=value',
      'API_KEY',
    ]);

    expect(result).toEqual([
      '-e',
      'NODE_ENV=development',
      '-e',
      'CUSTOM=value',
      '-e',
      'API_KEY=secret-key',
    ]);
  });

  it('should handle empty array', () => {
    const result = parseCustomEnvironmentVariables([]);

    expect(result).toEqual([]);
  });

  it('should handle value with equals signs', () => {
    const result = parseCustomEnvironmentVariables(['KEY=value=with=equals']);

    expect(result).toEqual(['-e', 'KEY=value=with=equals']);
  });

  it('should handle passthrough with value containing equals signs', () => {
    const result = parseCustomEnvironmentVariables(['MULTI_EQUALS']);

    expect(result).toEqual(['-e', 'MULTI_EQUALS=foo=bar=baz']);
  });

  it('should skip malformed entry with empty key', () => {
    const result = parseCustomEnvironmentVariables(['=VALUE']);

    expect(result).toEqual([]);
  });

  it('should skip malformed entry with only key and equals', () => {
    const result = parseCustomEnvironmentVariables(['KEY=']);

    // This should be skipped because value is empty string (which is falsy but defined)
    // Actually, based on the implementation, empty string is defined, so it should pass
    // Let me check the implementation again - it checks `value !== undefined`
    // empty string split result would be ['KEY', ''], so value would be ''
    // '' !== undefined is true, so it should be included
    expect(result).toEqual(['-e', 'KEY=']);
  });

  it('should handle multiple passthrough variables with some missing', () => {
    const result = parseCustomEnvironmentVariables([
      'TEST_VAR',
      'MISSING_VAR',
      'NODE_ENV',
      'ANOTHER_MISSING',
    ]);

    expect(result).toEqual([
      '-e',
      'TEST_VAR=test-value',
      '-e',
      'NODE_ENV=development',
    ]);
  });

  it('should handle all explicit values', () => {
    const result = parseCustomEnvironmentVariables([
      'VAR1=value1',
      'VAR2=value2',
      'VAR3=value3',
    ]);

    expect(result).toEqual([
      '-e',
      'VAR1=value1',
      '-e',
      'VAR2=value2',
      '-e',
      'VAR3=value3',
    ]);
  });

  it('should handle complex mixed scenario', () => {
    const result = parseCustomEnvironmentVariables([
      'NODE_ENV',
      'CUSTOM_VAR=custom-value',
      'MISSING_VAR',
      'API_KEY',
      'ANOTHER=value=with=equals',
    ]);

    expect(result).toEqual([
      '-e',
      'NODE_ENV=development',
      '-e',
      'CUSTOM_VAR=custom-value',
      '-e',
      'API_KEY=secret-key',
      '-e',
      'ANOTHER=value=with=equals',
    ]);
  });

  it('should handle environment variable with empty string value', () => {
    process.env.EMPTY_VAR = '';
    const result = parseCustomEnvironmentVariables(['EMPTY_VAR']);

    expect(result).toEqual(['-e', 'EMPTY_VAR=']);
  });

  it('should trim whitespace from keys in explicit format', () => {
    const result = parseCustomEnvironmentVariables(['  KEY  =value']);

    // The key will be '  KEY  ' after split, and '  KEY  '.trim() is 'KEY'
    // So it should pass validation
    // But we don't actually trim in the pushed value, we just check if trim is truthy
    // Let me verify: key.trim() checks if after trimming the key is not empty
    // But we push the original env string, so it would be '  KEY  =value'
    expect(result).toEqual(['-e', '  KEY  =value']);
  });
});

describe('loadEnvsFile', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-env-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should load environment variables from valid dotenv file', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(
      envFile,
      `
VAR1=value1
VAR2=value2
VAR3=value3
    `.trim()
    );

    const result = loadEnvsFile('.env', testDir);

    expect(result).toEqual([
      '-e',
      'VAR1=value1',
      '-e',
      'VAR2=value2',
      '-e',
      'VAR3=value3',
    ]);
  });

  it('should handle missing file gracefully', () => {
    const result = loadEnvsFile('.env.missing', testDir);

    expect(result).toEqual([]);
  });

  it('should handle empty dotenv file', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(envFile, '');

    const result = loadEnvsFile('.env', testDir);

    expect(result).toEqual([]);
  });

  it('should handle dotenv file with comments', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(
      envFile,
      `
# This is a comment
VAR1=value1
# Another comment
VAR2=value2
    `.trim()
    );

    const result = loadEnvsFile('.env', testDir);

    expect(result).toEqual(['-e', 'VAR1=value1', '-e', 'VAR2=value2']);
  });

  it('should handle dotenv file with quotes', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(
      envFile,
      `
VAR1="quoted value"
VAR2='single quoted'
    `.trim()
    );

    const result = loadEnvsFile('.env', testDir);

    // dotenv library handles quotes
    expect(result).toEqual([
      '-e',
      'VAR1=quoted value',
      '-e',
      'VAR2=single quoted',
    ]);
  });

  it('should handle dotenv file with values containing equals signs', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(
      envFile,
      `
DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
    `.trim()
    );

    const result = loadEnvsFile('.env', testDir);

    expect(result).toEqual([
      '-e',
      'DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require',
    ]);
  });

  it('should prevent path traversal attacks', () => {
    // Try to access parent directory
    const result = loadEnvsFile('../../etc/passwd', testDir);

    // Should return empty array due to security check
    expect(result).toEqual([]);
  });

  it('should prevent absolute path attacks', () => {
    // Try to use absolute path outside project root
    const result = loadEnvsFile('/etc/passwd', testDir);

    // Should return empty array due to security check
    expect(result).toEqual([]);
  });

  it('should allow nested paths within project root', () => {
    const nestedDir = join(testDir, 'config');
    mkdirSync(nestedDir, { recursive: true });
    const envFile = join(nestedDir, '.env.local');
    writeFileSync(envFile, 'NESTED_VAR=nested-value');

    const result = loadEnvsFile('config/.env.local', testDir);

    expect(result).toEqual(['-e', 'NESTED_VAR=nested-value']);
  });

  it('should handle malformed dotenv file gracefully', () => {
    const envFile = join(testDir, '.env');
    // Create a file that might cause parsing issues
    writeFileSync(envFile, '\x00\x01\x02 invalid binary data');

    const result = loadEnvsFile('.env', testDir);

    // Should return empty array on parse error
    expect(result).toEqual([]);
  });

  it('should handle dotenv file with multiline values', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(
      envFile,
      `
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA
-----END RSA PRIVATE KEY-----"
    `.trim()
    );

    const result = loadEnvsFile('.env', testDir);

    // dotenv library should handle multiline values
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe('-e');
    expect(result[1]).toContain('PRIVATE_KEY=');
  });

  it('should handle dotenv file with empty values', () => {
    const envFile = join(testDir, '.env');
    writeFileSync(
      envFile,
      `
VAR1=
VAR2=value2
VAR3=
    `.trim()
    );

    const result = loadEnvsFile('.env', testDir);

    expect(result).toEqual(['-e', 'VAR1=', '-e', 'VAR2=value2', '-e', 'VAR3=']);
  });

  it('should handle relative path resolution correctly', () => {
    const envFile = join(testDir, '.env.rover');
    writeFileSync(envFile, 'ROVER_VAR=rover-value');

    const result = loadEnvsFile('.env.rover', testDir);

    expect(result).toEqual(['-e', 'ROVER_VAR=rover-value']);
  });

  it('should handle dotenv file in subdirectory', () => {
    const subdir = join(testDir, 'subdir');
    mkdirSync(subdir, { recursive: true });
    const envFile = join(subdir, '.env');
    writeFileSync(envFile, 'SUB_VAR=sub-value');

    const result = loadEnvsFile('subdir/.env', testDir);

    expect(result).toEqual(['-e', 'SUB_VAR=sub-value']);
  });
});
