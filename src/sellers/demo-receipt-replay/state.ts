interface ReplayDemoRun {
  firstClaimed: boolean;
  replayBlocked: boolean;
  resolveReplay: (blocked: boolean) => void;
  replayResult: Promise<boolean>;
}

const runs = new Map<string, ReplayDemoRun>();

function isRunId(value: string | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function findOrCreateRun(runId: string): ReplayDemoRun {
  const existing = runs.get(runId);
  if (existing) return existing;
  let resolveReplay!: (blocked: boolean) => void;
  const replayResult = new Promise<boolean>((resolve) => { resolveReplay = resolve; });
  const created = { firstClaimed: false, replayBlocked: false, resolveReplay, replayResult };
  runs.set(runId, created);
  setTimeout(() => runs.delete(runId), 60_000).unref?.();
  return created;
}

export function markFirstReplayDemoClaimed(runIdValue: string | undefined): void {
  if (isRunId(runIdValue)) findOrCreateRun(runIdValue).firstClaimed = true;
}

export function hasFirstReplayDemoClaimed(runIdValue: string): boolean {
  return isRunId(runIdValue) && runs.get(runIdValue)?.firstClaimed === true;
}

export function markReplayDemoBlocked(runIdValue: string | undefined): void {
  if (!isRunId(runIdValue)) return;
  const run = findOrCreateRun(runIdValue);
  run.replayBlocked = true;
  run.resolveReplay(true);
}

export async function waitForReplayDemoBlock(runIdValue: string | undefined): Promise<boolean> {
  if (!isRunId(runIdValue)) return false;
  const run = findOrCreateRun(runIdValue);
  if (run.replayBlocked) return true;
  let timeout: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), 20_000);
  });
  try {
    return await Promise.race([run.replayResult, timedOut]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
