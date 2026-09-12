/**
 * Webcmd CLI Subprocess Wrapper for SaaS GrimReaper
 *
 * Provides safe subprocess execution of Webcmd commands with structured JSON parsing,
 * timeout handling, secret sanitization, bounded retries, and auth failure detection.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root of webcmd package is two levels up from grimreaper/src
const WEBCMD_DIST_MAIN = path.resolve(__dirname, '../../dist/src/main.js');

export interface WebcmdExecOptions {
  timeoutMs?: number;
  maxRetries?: number;
  env?: Record<string, string>;
  stdinInput?: string;
}

export interface WebcmdExecutionResult<T = unknown> {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  data: T | null;
  authRequired: boolean;
  durationMs: number;
  errorDiagnostic?: string;
}

/** Patterns matching sensitive credentials, tokens, or cookies to redact from logs/output */
const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.=]+/gi,
  /cookie:\s*[^;\r\n]+/gi,
  /password["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
  /token["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
  /secret["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
  /authorization:\s*[^;\r\n]+/gi,
];

/** Redacts sensitive tokens or authorization keys from string logs. */
export function sanitizeLogs(input: string): string {
  let cleaned = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED_SECRET]');
  }
  return cleaned;
}

/** Detects whether an execution failed due to an authentication requirement / human handoff. */
export function isAuthRequiredOutput(exitCode: number, stdout: string, stderr: string): boolean {
  if (exitCode === 77) return true;
  const combined = `${stdout}\n${stderr}`;
  return (
    combined.includes('SESSION_PAUSED_FOR_HUMAN_HANDOFF') ||
    combined.includes('AUTH_REQUIRED') ||
    combined.includes('AuthRequiredError') ||
    combined.includes('Not logged in to')
  );
}

const DEFAULT_CLI_COMMAND = process.platform === 'win32' ? 'webcmd.cmd' : 'webcmd';

export class WebcmdCliWrapper {
  private readonly cliPath: string;
  private readonly defaultTimeoutMs: number;

  constructor(customCliPath?: string, defaultTimeoutMs = 30_000) {
    this.cliPath = customCliPath ?? DEFAULT_CLI_COMMAND;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  /**
   * Executes a Webcmd command as a subprocess with structured output, timeout, and retries.
   */
  async exec<T = unknown>(
    args: string[],
    options: WebcmdExecOptions = {}
  ): Promise<WebcmdExecutionResult<T>> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = options.maxRetries ?? 0;

    let attempt = 0;
    let lastResult: WebcmdExecutionResult<T> | null = null;

    while (attempt <= maxRetries) {
      attempt++;
      const startTime = Date.now();
      const result = await this.runOnce<T>(args, options, timeoutMs, startTime);
      lastResult = result;

      // Do NOT retry if successful, if auth is required, or if it's a usage/argument error
      if (result.success || result.authRequired || result.exitCode === 2) {
        return result;
      }

      // Retry only on transient errors (timeouts or daemon unavailability exit code 69/75)
      const isTransient = result.exitCode === 69 || result.exitCode === 75 || result.stderr.includes('TIMEOUT');
      if (!isTransient || attempt > maxRetries) {
        break;
      }
    }

    return lastResult!;
  }

  private runOnce<T>(
    args: string[],
    options: WebcmdExecOptions,
    timeoutMs: number,
    startTime: number
  ): Promise<WebcmdExecutionResult<T>> {
    return new Promise((resolve) => {
      // Execute via node calling main.js or direct executable
      const isJsScript = this.cliPath.endsWith('.js') || this.cliPath.endsWith('.ts');
      const spawnCmd = isJsScript ? process.execPath : this.cliPath;
      const spawnArgs = isJsScript ? [this.cliPath, ...args] : args;

      const isWindowsCmd = process.platform === 'win32' && (spawnCmd.endsWith('.cmd') || spawnCmd.endsWith('.bat'));
      const child = spawn(spawnCmd, spawnArgs, {
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWindowsCmd,
      });

      let stdout = '';
      let stderr = '';
      let killedDueToTimeout = false;

      const timer = setTimeout(() => {
        killedDueToTimeout = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      if (options.stdinInput) {
        child.stdin.write(options.stdinInput);
        child.stdin.end();
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        const exitCode = killedDueToTimeout ? 75 : (code ?? 1);
        const sanitizedStdout = sanitizeLogs(stdout);
        let sanitizedStderr = sanitizeLogs(stderr);

        if (killedDueToTimeout) {
          sanitizedStderr += `\n[WebcmdCliWrapper] Command timed out after ${timeoutMs}ms`;
        }

        const authRequired = isAuthRequiredOutput(exitCode, sanitizedStdout, sanitizedStderr);

        let parsedData: T | null = null;
        let errorDiagnostic: string | undefined;

        if (sanitizedStdout.trim()) {
          try {
            parsedData = JSON.parse(sanitizedStdout) as T;
          } catch {
            // Not JSON or non-JSON response
            parsedData = null;
          }
        }

        if (exitCode !== 0) {
          errorDiagnostic = sanitizedStderr.trim() || `Command failed with exit code ${exitCode}`;
        }

        resolve({
          success: exitCode === 0 && !authRequired,
          exitCode,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
          data: parsedData,
          authRequired,
          durationMs,
          errorDiagnostic,
        });
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;
        resolve({
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: sanitizeLogs(err.message),
          data: null,
          authRequired: false,
          durationMs,
          errorDiagnostic: `Subprocess spawn error: ${err.message}`,
        });
      });
    });
  }

  // ── High-Level Webcmd Helper Functions ───────────────────────────────────

  /** Runs `webcmd doctor -f json` */
  async doctor(options?: WebcmdExecOptions): Promise<WebcmdExecutionResult> {
    return this.exec(['doctor', '-f', 'json'], options);
  }

  /** Creates a named browser session in the specified profile */
  async createSession(
    profile: string,
    sessionName: string,
    options?: WebcmdExecOptions
  ): Promise<WebcmdExecutionResult<{ id: string; profileId: string; kind: string }>> {
    return this.exec<{ id: string; profileId: string; kind: string }>(
      ['--profile', profile, 'session', 'create', sessionName, '-f', 'json'],
      options
    );
  }

  /** Lists browser sessions for a profile */
  async listSessions(
    profile?: string,
    options?: WebcmdExecOptions
  ): Promise<WebcmdExecutionResult<Array<{ id: string; profileId: string; runtimeState: string }>>> {
    const args = profile
      ? ['--profile', profile, 'session', 'list', '-f', 'json']
      : ['session', 'list', '-f', 'json'];
    return this.exec(args, options);
  }

  /** Closes an active browser session */
  async closeSession(
    profile: string,
    sessionId: string,
    options?: WebcmdExecOptions
  ): Promise<WebcmdExecutionResult> {
    return this.exec(['--profile', profile, 'session', 'close', sessionId, '-f', 'json'], options);
  }

  /** Captures page state via snapshot */
  async snapshot(
    profile: string,
    sessionId: string,
    snapshotOpts?: { mode?: 'act' | 'tree' | 'read' },
    options?: WebcmdExecOptions
  ): Promise<WebcmdExecutionResult> {
    const mode = snapshotOpts?.mode ?? 'act';
    return this.exec(
      ['--profile', profile, '--session', sessionId, 'browser', 'snapshot', '--snapshot-mode', mode, '-f', 'json'],
      options
    );
  }

  /** Runs a Playwright-style script snippet inside the QuickJS sandbox */
  async browserRun(
    profile: string,
    sessionId: string,
    script: string,
    options?: WebcmdExecOptions
  ): Promise<WebcmdExecutionResult> {
    return this.exec(
      ['--profile', profile, '--session', sessionId, 'browser', 'run', '--stdin', '-f', 'json'],
      { ...options, stdinInput: script }
    );
  }
}
