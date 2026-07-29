import type { SupervisionScheduler } from "../supervision/types.js";

// Cadence sits under the tightest plausible client idle timeout (SDK default
// 60s; harness and undici body timers ~300s). One ping resets every layer.
//
export const x_AwaitLivenessPingIntervalMs = 30_000;

export type AwaitLivenessProgressNotification = {
  readonly method: "notifications/progress";
  readonly params: {
    readonly progressToken: string | number;
    readonly progress: number;
    readonly message: string;
  };
};

export type AwaitLivenessPingOptions = {
  readonly progressToken: string | number;
  readonly intervalMs: number;
  readonly isVouching: () => boolean;
  readonly sendNotification: (
    notification: AwaitLivenessProgressNotification,
  ) => Promise<void>;
  readonly signal: AbortSignal;
  readonly scheduler?: SupervisionScheduler;
};

// Drive request-scoped progress notifications while the caller-supplied
// vouching predicate holds. Stopping vouching stops the ticker with no
// goodbye ping and no synthesized error — the client's own timeout then
// carries the information that vouching ended.
//
export function StartAwaitLivenessPings(
  options: AwaitLivenessPingOptions,
): () => void {
  const scheduler = options.scheduler ?? systemScheduler;
  let stopped = false;
  let progress = 0;
  let handle: unknown;

  const clear = (): void => {
    if (handle !== undefined) {
      scheduler.clearTimeout(handle);
      handle = undefined;
    }
  };

  const schedule = (): void => {
    clear();
    if (stopped || options.signal.aborted) {
      return;
    }
    handle = scheduler.setTimeout(() => {
      void tick();
    }, options.intervalMs);
  };

  const tick = async (): Promise<void> => {
    if (stopped || options.signal.aborted) {
      return;
    }
    if (!options.isVouching()) {
      return;
    }
    progress += 1;
    try {
      await options.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: options.progressToken,
          progress,
          message: "await_liveness",
        },
      });
    } catch {
      // Client gone or transport closed — stop rather than retry forever.
      //
      return;
    }
    if (stopped || options.signal.aborted || !options.isVouching()) {
      return;
    }
    schedule();
  };

  schedule();

  return () => {
    stopped = true;
    clear();
  };
}

const systemScheduler: SupervisionScheduler = {
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
