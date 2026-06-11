# Sheaf Agent macOS VM

This directory tracks the source for Sheaf's local Tart-based macOS agent VM.
The Tart image itself is local machine state and is not committed.

## Recommended Workflow

1. Edit the provisioning scripts in this directory when Sheaf gains a new
   system dependency.
2. Run a fast reprovision of the existing golden VM:

   ```bash
   projects/quest-runner/vm/agent-macos/bin/rebuild-golden
   ```

3. Run an agent in a disposable clone with the current worktree mounted:

   ```bash
   projects/quest-runner/vm/agent-macos/bin/agent-run /Users/joyo/Sheaf
   ```

4. Delete disposable clones after use:

   ```bash
   projects/quest-runner/vm/agent-macos/bin/agent-clean <vm-name>
   ```

Use a fresh base image only when you want to pick up the latest upstream macOS
base image:

```bash
projects/quest-runner/vm/agent-macos/bin/rebuild-golden --fresh
```

`--fresh` deletes the existing golden VM and pulls `BASE_IMAGE` again, so it is
much slower than the normal reprovision path.

## What Is Included

The golden VM installs:

- Homebrew
- Git, Git LFS, GitHub CLI, jq, ripgrep, fd, tree, shellcheck
- Python, uv, cached wheels for the quest-runner Python requirements
- Node, pnpm, native build helpers for Node modules
- SQLite and PortAudio for `better-sqlite3` and `naudiodon`
- whisper-cpp for `projects/dictator`
- Cursor, Codex CLI/app, and Claude Code

The repo remains the source of truth for language-level dependencies:

- Node packages come from each `package.json` and lockfile via `npm install`.
- Python packages come from `projects/quest-runner/requirements.txt`.
- Swift packages come from `projects/dictator/Package.swift`.

Browser binaries for Playwright are not installed by the generic dependency
layer. Projects that add Playwright browser tests must either run their own
`npm exec playwright install <browser>` setup in the VM or bake the matching
Playwright browser cache into the golden image.

## Xcode Boundary

`projects/dictator` includes iOS Simulator tests via `xcodebuild`. Homebrew
cannot fully provision Xcode and iOS simulator runtimes. To run the complete
`dictator` target inside the VM, use a base image that already includes Xcode
or install/sign into Xcode manually in the golden VM before cloning agents.

Swift package builds can run with Command Line Tools if `swift` and the linked
Homebrew libraries are available.

## Files

- `profile.env`: VM name, base image, sizing, and host tool paths.
- `scripts/guest-bootstrap.sh`: top-level idempotent guest provisioner.
- `scripts/guest-sheaf-deps.sh`: Sheaf system dependency layer.
- `scripts/guest-agent-tools.sh`: Cursor, Codex, and Claude Code layer.
- `bin/rebuild-golden`: create or reprovision the golden VM.
- `bin/agent-run`: clone, mount a worktree, and optionally run a command.
- `bin/agent-ssh`: SSH into a running VM.
- `bin/agent-clean`: stop/delete disposable VMs.
