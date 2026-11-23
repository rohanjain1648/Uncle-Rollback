export interface ExecResult { exitCode: number; stdout: string; stderr: string; timedOut: boolean }

export interface ExecOpts { timeoutMs?: number; env?: Record<string, string>; cwd?: string }

export interface Garage {
  exec(cmd: string[], opts?: ExecOpts): Promise<ExecResult>;
  writeFile(path: string, content: string): Promise<void>;
  checkpoint(comment: string): Promise<string>;
  restore(versionId: string): Promise<void>;
  findCheckpoint(comment: string): Promise<string | null>;
}
