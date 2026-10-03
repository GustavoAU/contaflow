export interface NeonBranchLike {
  id?: string;
  name?: string;
  project_id?: string;
  default?: boolean;
  primary?: boolean;
  protected?: boolean;
  [key: string]: unknown;
}
export function ciBranchName(args: { runId: string | number; runAttempt: string | number }): string;
export function resolveDefaultBranch(branches: NeonBranchLike[]): NeonBranchLike;
export function assertDeletableBranch(args: {
  branch: NeonBranchLike | null | undefined;
  expectedProjectId: string;
  defaultBranchId: string;
}): void;
export function maskLine(value: string): string;
export function assertCiProject(project: { id?: string; name?: string } | null | undefined): void;
