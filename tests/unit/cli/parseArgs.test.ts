import { resolve } from 'path';
import { parseArgs } from '../../../src/cli.js';

// Mock all heavy dependencies so importing cli.ts doesn't trigger side effects
vi.mock('../../../src/db/queries.js', () => ({}));
vi.mock('../../../src/db/connection.js', () => ({}));
vi.mock('../../../src/debug.js', () => ({
  setDebug: vi.fn(),
  setAIServiceTest: vi.fn(),
  setDemoMode: vi.fn(),
}));
vi.mock('../../../src/demo.js', () => ({
  DEMO_SCENARIOS: [
    { id: 1, label: 'Demo 1' },
    { id: 2, label: 'Demo 2' },
  ],
}));
vi.mock('../../../src/git/diff.js', () => ({}));
vi.mock('../../../src/lock.js', () => ({}));
vi.mock('../../../src/review-update.js', () => ({}));
vi.mock('../../../src/server.js', () => ({}));
vi.mock('../../../src/skills.js', () => ({}));
vi.mock('../../../src/update-check.js', () => ({}));

// Helper: creates argv like Node would (first two args are node + script)
function argv(...args: string[]): string[] {
  return ['node', 'glassbox', ...args];
}

describe('parseArgs', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default behavior', () => {
    it('defaults to uncommitted mode with no arguments', () => {
      const result = parseArgs(argv());
      expect(result).not.toBeNull();
      expect(result!.mode).toEqual({ type: 'uncommitted' });
    });

    it('defaults port to 4183', () => {
      const result = parseArgs(argv());
      expect(result!.port).toBe(4183);
    });

    it('defaults all boolean flags to false', () => {
      const result = parseArgs(argv());
      expect(result!.resume).toBe(false);
      expect(result!.forceUpdateCheck).toBe(false);
      expect(result!.debug).toBe(false);
      expect(result!.aiServiceTest).toBe(false);
      expect(result!.noOpen).toBe(false);
      expect(result!.strictPort).toBe(false);
    });

    it('defaults nullable values to null', () => {
      const result = parseArgs(argv());
      expect(result!.dataDir).toBeNull();
      expect(result!.demo).toBeNull();
      expect(result!.projectDir).toBeNull();
    });
  });

  describe('review modes', () => {
    it('parses --uncommitted', () => {
      const result = parseArgs(argv('--uncommitted'));
      expect(result!.mode).toEqual({ type: 'uncommitted' });
    });

    it('parses --staged', () => {
      const result = parseArgs(argv('--staged'));
      expect(result!.mode).toEqual({ type: 'staged' });
    });

    it('parses --unstaged', () => {
      const result = parseArgs(argv('--unstaged'));
      expect(result!.mode).toEqual({ type: 'unstaged' });
    });

    it('parses --commit with SHA', () => {
      const result = parseArgs(argv('--commit', 'abc123'));
      expect(result!.mode).toEqual({ type: 'commit', sha: 'abc123' });
    });

    it('parses --range with from..to', () => {
      const result = parseArgs(argv('--range', 'abc..def'));
      expect(result!.mode).toEqual({ type: 'range', from: 'abc', to: 'def' });
    });

    it('parses --range with from only (defaults to HEAD)', () => {
      const result = parseArgs(argv('--range', 'abc..'));
      expect(result!.mode).toEqual({ type: 'range', from: 'abc', to: 'HEAD' });
    });

    it('parses --branch with name', () => {
      const result = parseArgs(argv('--branch', 'main'));
      expect(result!.mode).toEqual({ type: 'branch', name: 'main' });
    });

    it('parses --files with comma-separated patterns', () => {
      const result = parseArgs(argv('--files', '*.ts,*.js'));
      expect(result!.mode).toEqual({ type: 'files', patterns: ['*.ts', '*.js'] });
    });

    it('parses --files with single pattern', () => {
      const result = parseArgs(argv('--files', 'src/**/*.ts'));
      expect(result!.mode).toEqual({ type: 'files', patterns: ['src/**/*.ts'] });
    });

    it('parses --all', () => {
      const result = parseArgs(argv('--all'));
      expect(result!.mode).toEqual({ type: 'all' });
    });

    it('parses --diff into absolute paths', () => {
      const result = parseArgs(argv('--diff', './before', './after'));
      expect(result!.mode).toEqual({
        type: 'diff',
        pathA: resolve('./before'),
        pathB: resolve('./after'),
      });
    });

    it('exits when --diff is missing its second path', () => {
      expect(() => parseArgs(argv('--diff', 'only-one'))).toThrow('process.exit');
    });

    it('parses --ground-truth into an absolute manifest path (comparisons loaded later)', () => {
      const result = parseArgs(argv('--ground-truth', './screens/manifest.json'));
      expect(result!.mode).toEqual({
        type: 'ground-truth',
        manifestPath: resolve('./screens/manifest.json'),
        comparisons: [],
      });
    });

    it('exits when --ground-truth is missing its manifest path', () => {
      expect(() => parseArgs(argv('--ground-truth'))).toThrow('process.exit');
    });
  });

  describe('options', () => {
    it('parses --port', () => {
      const result = parseArgs(argv('--port', '8080'));
      expect(result!.port).toBe(8080);
    });

    it('parses --data-dir as absolute path', () => {
      const result = parseArgs(argv('--data-dir', '/tmp/test-data'));
      // parseArgs resolves the data dir to an absolute path; on Windows that
      // anchors to the current drive (C:\tmp\test-data), so compare against
      // resolve() rather than the raw POSIX literal.
      expect(result!.dataDir).toBe(resolve('/tmp/test-data'));
    });

    it('parses --resume', () => {
      const result = parseArgs(argv('--resume'));
      expect(result!.resume).toBe(true);
    });

    it('parses --check-for-updates', () => {
      const result = parseArgs(argv('--check-for-updates'));
      expect(result!.forceUpdateCheck).toBe(true);
    });

    it('parses --debug', () => {
      const result = parseArgs(argv('--debug'));
      expect(result!.debug).toBe(true);
    });

    it('parses --ai-service-test', () => {
      const result = parseArgs(argv('--ai-service-test'));
      expect(result!.aiServiceTest).toBe(true);
    });

    it('parses --no-open', () => {
      const result = parseArgs(argv('--no-open'));
      expect(result!.noOpen).toBe(true);
    });

    it('parses --strict-port', () => {
      const result = parseArgs(argv('--strict-port'));
      expect(result!.strictPort).toBe(true);
    });

    it('parses --project-dir', () => {
      const result = parseArgs(argv('--project-dir', '/path/to/project'));
      expect(result!.projectDir).toBe('/path/to/project');
    });
  });

  describe('demo mode', () => {
    it('parses --demo:1', () => {
      const result = parseArgs(argv('--demo:1'));
      expect(result!.demo).toBe(1);
    });

    it('parses --demo:2', () => {
      const result = parseArgs(argv('--demo:2'));
      expect(result!.demo).toBe(2);
    });

    it('exits with error for --demo:0', () => {
      expect(() => parseArgs(argv('--demo:0'))).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits with error for --demo:invalid', () => {
      expect(() => parseArgs(argv('--demo:abc'))).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('combined options', () => {
    it('parses mode with multiple options', () => {
      const result = parseArgs(argv('--staged', '--port', '9000', '--resume', '--no-open'));
      expect(result!.mode).toEqual({ type: 'staged' });
      expect(result!.port).toBe(9000);
      expect(result!.resume).toBe(true);
      expect(result!.noOpen).toBe(true);
    });

    it('last mode wins when multiple modes specified', () => {
      const result = parseArgs(argv('--staged', '--unstaged'));
      expect(result!.mode).toEqual({ type: 'unstaged' });
    });
  });

  describe('error handling', () => {
    it('exits for unknown options', () => {
      expect(() => parseArgs(argv('--unknown'))).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits for --help', () => {
      expect(() => parseArgs(argv('--help'))).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('exits for -h', () => {
      expect(() => parseArgs(argv('-h'))).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});
