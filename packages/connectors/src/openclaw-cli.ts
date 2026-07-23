import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface OpenClawProcessInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMilliseconds: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
}

export interface OpenClawProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface OpenClawProcessRunner {
  run(input: OpenClawProcessInput): Promise<OpenClawProcessResult>;
}

export class OpenClawProcessError extends Error {
  constructor(readonly code: "timeout" | "cancelled" | "output_limit" | "spawn_failed") {
    super(`OpenClaw process failed safely: ${code}.`);
    this.name = "OpenClawProcessError";
  }
}

export class NodeOpenClawProcessRunner implements OpenClawProcessRunner {
  run(input: OpenClawProcessInput): Promise<OpenClawProcessResult> {
    if (input.timeoutMilliseconds <= 0 || input.maxOutputBytes <= 0) {
      return Promise.reject(new OpenClawProcessError("spawn_failed"));
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";
      const child: ChildProcessWithoutNullStreams = spawn(input.executable, [...input.args], {
        shell: false,
        env: { ...input.environment } as NodeJS.ProcessEnv,
        stdio: "pipe"
      });
      child.stdin.end();

      const cleanup = () => {
        clearTimeout(timeout);
        input.signal?.removeEventListener("abort", cancel);
      };
      const fail = (error: OpenClawProcessError) => {
        if (settled) return;
        settled = true;
        cleanup();
        child.kill("SIGTERM");
        reject(error);
      };
      const cancel = () => fail(new OpenClawProcessError("cancelled"));
      const timeout = setTimeout(
        () => fail(new OpenClawProcessError("timeout")),
        input.timeoutMilliseconds
      );
      const append = (stream: "stdout" | "stderr", chunk: string) => {
        if (stream === "stdout") stdout += chunk;
        else stderr += chunk;
        if (
          Buffer.byteLength(stdout, "utf8") + Buffer.byteLength(stderr, "utf8") >
          input.maxOutputBytes
        ) {
          fail(new OpenClawProcessError("output_limit"));
        }
      };

      input.signal?.addEventListener("abort", cancel, { once: true });
      if (input.signal?.aborted) cancel();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => append("stdout", chunk));
      child.stderr.on("data", (chunk: string) => append("stderr", chunk));
      child.once("error", () => fail(new OpenClawProcessError("spawn_failed")));
      child.once("close", (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ exitCode: exitCode ?? 1, stdout, stderr });
      });
    });
  }
}
