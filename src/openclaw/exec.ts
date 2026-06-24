import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a command and capture stdout/stderr. Rejects on non-zero exit by default. */
export function exec(
  cmd: string,
  args: string[],
  opts: { allowFailure?: boolean; timeoutMs?: number; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const result: ExecResult = { stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? -1 };
      if (code === 0 || opts.allowFailure) resolve(result);
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}
