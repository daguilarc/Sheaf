export type ShutdownControllerDeps =
{
  stopPoller: () => void;
  closeServer: () => Promise<void>;
  exitProcess?: (code?: number) => void;
};

export type ShutdownController =
{
  requestShutdown: () => Promise<void>;
  wasShutdownRequested: () => boolean;
};

export function createShutdownController(deps: ShutdownControllerDeps): ShutdownController
{
  let shutdownRequested = false;

  return {
    async requestShutdown(): Promise<void>
    {
      if (shutdownRequested)
      {
        return;
      }

      shutdownRequested = true;
      deps.stopPoller();
      await deps.closeServer();

      if (deps.exitProcess)
      {
        deps.exitProcess(0);
      }
    },

    wasShutdownRequested(): boolean
    {
      return shutdownRequested;
    },
  };
}
