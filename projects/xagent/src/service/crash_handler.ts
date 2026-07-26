// Last-resort guard against an unhandled error taking down the whole
// xagent service before owned provider process groups are cleaned up.
//
// The supervisor runs in-process with every active run, so an uncaught
// exception (e.g. a stray stream `error` event that escaped the per-spawn
// stdin guards) would otherwise crash the process and orphan every
// detached provider process group until the next manual restart plus
// reconciliation. This handler logs, attempts an orderly close of owned
// runs, and then exits non-zero. It is exported so service_main can
// install it on `process` and so tests can drive it with a fake run
// manager and a stubbed exit.
//
export type CrashHandlerRunManager = {
  closeAll(): Promise<void>;
};

export type CrashHandlerOptions = {
  readonly runManager: CrashHandlerRunManager;
  readonly log?: (message: string, error: unknown) => void;
  readonly exit?: (code: number) => void;
};

export function createUncaughtExceptionHandler(
  options: CrashHandlerOptions,
): (error: unknown) => void {
  const log = options.log ?? defaultLog;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;
  return (error: unknown) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log("xagent service uncaughtException:", error);
    void options.runManager
      .closeAll()
      .catch((closeError: unknown) => {
        log("xagent service closeAll during uncaughtException failed:", closeError);
      })
      .finally(() => {
        exit(1);
      });
  };
}

function defaultLog(message: string, error: unknown): void {
  console.error(message, error);
}
