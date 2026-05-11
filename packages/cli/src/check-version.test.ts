import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkNodeVersion } from './index.js';

describe('checkNodeVersion', () => {
  let originalExit: typeof process.exit;
  let originalNodeVersion: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    originalExit = process.exit as unknown as typeof vi.fn;
    originalNodeVersion = process.versions.node;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original values
    (process.exit as unknown as typeof vi.fn).mockRestore?.();
    Object.defineProperty(process.versions, 'node', {
      value: originalNodeVersion,
      writable: true,
    });
  });

  it('passes when Node major version meets requirement', () => {
    Object.defineProperty(process.versions, 'node', { value: '20.10.0', writable: true });
    vi.spyOn(process, 'exit').mockImplementation(() => {} as never);

    // Should not throw or exit
    expect(() => checkNodeVersion()).not.toThrow();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('passes when Node major version exceeds requirement', () => {
    Object.defineProperty(process.versions, 'node', { value: '22.5.1', writable: true });
    vi.spyOn(process, 'exit').mockImplementation(() => {} as never);

    expect(() => checkNodeVersion()).not.toThrow();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('exits with code 1 when Node major version is below requirement', () => {
    Object.defineProperty(process.versions, 'node', { value: '18.19.0', writable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {} as never);

    expect(() => checkNodeVersion()).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('includes the detected version in the error message', () => {
    Object.defineProperty(process.versions, 'node', { value: '16.20.2', writable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {} as never);

    try {
      checkNodeVersion();
    } catch {
      // expected
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('v16.20.2'),
    );
  });

  it('exits with code 1 when Node major version equals 19 (below 20)', () => {
    Object.defineProperty(process.versions, 'node', { value: '19.9.0', writable: true });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {} as never);

    expect(() => checkNodeVersion()).toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
