import { describe, it, expect } from 'vitest';
import { normalizeExtraArgs } from '../container-common.js';

describe('normalizeExtraArgs', () => {
  it('should return empty array for undefined input', () => {
    expect(normalizeExtraArgs(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(normalizeExtraArgs('')).toEqual([]);
  });

  it('should return array as-is when input is array', () => {
    const input = ['--network', 'mynet', '--memory', '512m'];
    expect(normalizeExtraArgs(input)).toEqual(input);
  });

  it('should return empty array as-is', () => {
    expect(normalizeExtraArgs([])).toEqual([]);
  });

  it('should split simple string by whitespace', () => {
    expect(normalizeExtraArgs('--network mynet')).toEqual([
      '--network',
      'mynet',
    ]);
  });

  it('should handle single argument string', () => {
    expect(normalizeExtraArgs('--rm')).toEqual(['--rm']);
  });

  it('should handle multiple arguments', () => {
    expect(normalizeExtraArgs('--network mynet --memory 512m')).toEqual([
      '--network',
      'mynet',
      '--memory',
      '512m',
    ]);
  });

  it('should preserve double-quoted strings', () => {
    expect(
      normalizeExtraArgs('--add-host "host.docker.internal:host-gateway"')
    ).toEqual(['--add-host', '"host.docker.internal:host-gateway"']);
  });

  it('should preserve single-quoted strings', () => {
    expect(normalizeExtraArgs("--label 'my label with spaces'")).toEqual([
      '--label',
      "'my label with spaces'",
    ]);
  });

  it('should handle complex real-world example', () => {
    expect(
      normalizeExtraArgs(
        '--network myproject_default --add-host host.docker.internal:host-gateway'
      )
    ).toEqual([
      '--network',
      'myproject_default',
      '--add-host',
      'host.docker.internal:host-gateway',
    ]);
  });
});
