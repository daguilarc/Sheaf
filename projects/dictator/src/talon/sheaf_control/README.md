# Sheaf Talon Control

This Talon user-script package is owned by the Sheaf repository. Install it
with:

```bash
make -C projects/dictator install-talon-bridge
```

The Make target creates `~/.talon/user/sheaf_control` as a symlink to this
directory so edits in the repo are the source of truth. After installing,
reload Talon scripts or restart Talon.

The bridge listens only on `127.0.0.1:28579` and exposes:

- `GET /status`
- `POST /wake`
- `POST /sleep`

Manual smoke check:

```bash
curl -sS http://127.0.0.1:28579/status
curl -sS -X POST http://127.0.0.1:28579/sleep
curl -sS -X POST http://127.0.0.1:28579/wake
```
