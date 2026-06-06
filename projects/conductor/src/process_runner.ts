import { spawn as nodeSpawn } from "node:child_process";

export type SpawnedProcess =
{
  pid: number;
  command: string;
  argv: string[];
};

export type SpawnFailure =
{
  message: string;
  command: string;
  argv: string[];
  code?: string;
};

export type ProcessRunner =
{
  spawn: (command: string, cwd: string) => SpawnedProcess;
};

export function parseCommand(command: string): string[]
{
  const argv: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < command.length; index += 1)
  {
    const character = command[index]!;

    if (character === "'" && !inDoubleQuote)
    {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (character === "\"" && !inSingleQuote)
    {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && /\s/.test(character))
    {
      if (current.length > 0)
      {
        argv.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (current.length > 0)
  {
    argv.push(current);
  }

  return argv;
}

export function needsShellExecution(command: string): boolean
{
  return /[|&;<>]/.test(command);
}

export function spawnCommand(
  command: string,
  cwd: string,
  spawnFn: typeof nodeSpawn = nodeSpawn,
): SpawnedProcess
{
  if (needsShellExecution(command))
  {
    const child = spawnFn(command, {
      cwd,
      shell: true,
      detached: true,
      stdio: "ignore",
    });

    if (child.pid === undefined)
    {
      throw createSpawnFailure(command, [command], "spawn returned no pid");
    }

    child.unref();

    return {
      pid: child.pid,
      command,
      argv: [command],
    };
  }

  const argv = parseCommand(command);

  if (argv.length === 0)
  {
    throw createSpawnFailure(command, argv, "empty command");
  }

  const child = spawnFn(argv[0]!, argv.slice(1), {
    cwd,
    detached: true,
    stdio: "ignore",
  });

  if (child.pid === undefined)
  {
    throw createSpawnFailure(command, argv, "spawn returned no pid");
  }

  child.unref();

  return {
    pid: child.pid,
    command,
    argv,
  };
}

function createSpawnFailure(command: string, argv: string[], message: string): Error
{
  const failure: SpawnFailure =
  {
    message,
    command,
    argv,
  };

  return Object.assign(new Error(message), failure);
}

export function createProcessRunner(spawnFn: typeof nodeSpawn = nodeSpawn): ProcessRunner
{
  return {
    spawn(command: string, cwd: string): SpawnedProcess
    {
      try
      {
        return spawnCommand(command, cwd, spawnFn);
      }
      catch (error: unknown)
      {
        if (error instanceof Error && "command" in error)
        {
          throw error;
        }

        const message = error instanceof Error ? error.message : "spawn failed";
        throw createSpawnFailure(command, parseCommand(command), message);
      }
    },
  };
}
