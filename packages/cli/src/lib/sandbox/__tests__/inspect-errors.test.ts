import { describe, it, expect } from 'vitest';
import { isContainerMissingInspectError } from '../inspect-errors.js';

describe('isContainerMissingInspectError', () => {
  it('returns true for Docker "No such object" error', () => {
    const error = {
      message: 'Command failed',
      stderr: 'Error: No such object: abc123',
    };
    expect(isContainerMissingInspectError(error)).toBe(true);
  });

  it('returns true for Podman "no such container" error', () => {
    const error = {
      message: 'Command failed',
      stderr: 'Error: no such container abc123',
    };
    expect(isContainerMissingInspectError(error)).toBe(true);
  });

  it('returns true for "no container with name or id" error', () => {
    const error = {
      shortMessage: 'no container with name or id "abc123"',
    };
    expect(isContainerMissingInspectError(error)).toBe(true);
  });

  it('returns true when error message itself contains the pattern', () => {
    const error = {
      message: 'No such object: container-xyz',
    };
    expect(isContainerMissingInspectError(error)).toBe(true);
  });

  it('returns false for backend connectivity errors', () => {
    const error = {
      message: 'Cannot connect to the Docker daemon',
      stderr: 'Is the docker daemon running?',
    };
    expect(isContainerMissingInspectError(error)).toBe(false);
  });

  it('returns false for permission errors', () => {
    const error = {
      message: 'Permission denied',
      stderr: 'Got permission denied while trying to connect',
    };
    expect(isContainerMissingInspectError(error)).toBe(false);
  });

  it('returns false for null input', () => {
    expect(isContainerMissingInspectError(null)).toBe(false);
  });

  it('returns false for undefined input', () => {
    expect(isContainerMissingInspectError(undefined)).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(isContainerMissingInspectError('some string')).toBe(false);
    expect(isContainerMissingInspectError(42)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isContainerMissingInspectError({})).toBe(false);
  });

  it('is case-insensitive', () => {
    const error = {
      stderr: 'ERROR: NO SUCH OBJECT: ABC123',
    };
    expect(isContainerMissingInspectError(error)).toBe(true);
  });
});
