# Scripts

Projects can expose useful commands in the top-level `scripts/` directory.

Entries in `scripts/` should be one of:

- short bash dispatch scripts that locate the owning project and invoke its real
  entrypoint with the right interpreter or environment
- symlinks to stable project-local scripts when no environment setup is needed

Keep dispatch scripts thin. Project-specific logic belongs in the owning project
under `projects/<project>/`.
