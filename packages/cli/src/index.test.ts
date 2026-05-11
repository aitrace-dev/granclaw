import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseArgs, checkNodeVersion } from './index.js';

describe('parseArgs', () => {
  it('defaults to `start` with no args', () => {
    expect(parseArgs([])).toEqual({ command: 'start', port: undefined, home: undefined });
  });

  it('parses --port', () => {
    expect(parseArgs(['--port', '9000'])).toEqual({
      command: 'start',
      port: 9000,
      home: undefined,
    });
  });

  it('parses --home', () => {
    expect(parseArgs(['--home', '/tmp/gc'])).toEqual({
      command: 'start',
      port: undefined,
      home: '/tmp/gc',
    });
  });

  it('parses start subcommand with flags', () => {
    expect(parseArgs(['start', '--port', '8080', '--home', '/tmp/gc'])).toEqual({
      command: 'start',
      port: 8080,
      home: '/tmp/gc',
    });
  });

  it('parses --version', () => {
    expect(parseArgs(['--version'])).toEqual({ command: 'version' });
  });

  it('parses -v', () => {
    expect(parseArgs(['-v'])).toEqual({ command: 'version' });
  });

  it('parses --help', () => {
    expect(parseArgs(['--help'])).toEqual({ command: 'help' });
  });

  it('parses -h', () => {
    expect(parseArgs(['-h'])).toEqual({ command: 'help' });
  });

  it('rejects invalid port string', () => {
    expect(() => parseArgs(['--port', 'not-a-number'])).toThrow(/invalid port/i);
  });

  it('rejects port out of range', () => {
    expect(() => parseArgs(['--port', '70000'])).toThrow(/invalid port/i);
    expect(() => parseArgs(['--port', '0'])).toThrow(/invalid port/i);
  });

  it('rejects --home with no value', () => {
    expect(() => parseArgs(['--home'])).toThrow(/--home requires a path/);
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/unknown option/i);
  });
});
