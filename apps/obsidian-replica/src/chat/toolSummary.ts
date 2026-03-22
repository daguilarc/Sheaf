import type { ChatJSONValue, ChatToolCall } from "../types.js";

const FILE_TOOL_LABELS: Record<string, { verb: string; fallback: string }> = {
  read_file: { verb: "Read", fallback: "Read file" },
  create_file: { verb: "Created", fallback: "Created file" },
  create_directory: { verb: "Created", fallback: "Created directory" },
  apply_patch: { verb: "Applied patch to", fallback: "Applied patch" },
  delete_path: { verb: "Deleted", fallback: "Deleted path" },
};

const PATH_KEYS = ["relative_path", "path", "file_path", "filepath", "target_path", "note_path"];
const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;

function asString(value: ChatJSONValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function basename(path: string): string {
  const trimmed = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_RE.test(path);
}

function pickPath(args: Record<string, ChatJSONValue>): string | null {
  for (const key of PATH_KEYS) {
    const candidate = asString(args[key]);
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function formatPath(path: string, currentVaultName?: string): string {
  const normalized = normalizePath(path);
  const trimmedVaultName = currentVaultName?.trim();

  if (trimmedVaultName) {
    const vaultRoot = `data/vaults/${trimmedVaultName}`;
    if (normalized === vaultRoot) {
      return "/";
    }
    const vaultPrefix = `${vaultRoot}/`;
    if (normalized.endsWith(`/${vaultRoot}`)) {
      return "/";
    }
    const prefixIndex = normalized.lastIndexOf(vaultPrefix);
    if (prefixIndex >= 0) {
      return normalized.slice(prefixIndex + vaultPrefix.length) || "/";
    }
  }

  if (/(?:^|\/)data\/vaults\/[^/]+(?:\/|$)/.test(normalized)) {
    return basename(normalized);
  }

  if (!isAbsolutePath(normalized)) {
    return normalized;
  }
  return basename(normalized);
}

export function summarizeToolCall(call: ChatToolCall, currentVaultName?: string): string {
  const label = FILE_TOOL_LABELS[call.name];
  const path = pickPath(call.args);

  if (label) {
    if (path) {
      return `${label.verb} ${formatPath(path, currentVaultName)}`;
    }
    return label.fallback;
  }

  if (call.name === "list_directory") {
    const dir = asString(call.args.relative_dir) ?? asString(call.args.path);
    if (dir && dir.trim()) {
      return `Listed ${formatPath(dir.trim(), currentVaultName)}`;
    }
    return "Listed directory";
  }

  if (call.name === "move_path") {
    const sourcePath = asString(call.args.source_path);
    const destinationPath = asString(call.args.destination_path) ?? asString(call.args.new_path);
    if (sourcePath?.trim() && destinationPath?.trim()) {
      return `Moved ${formatPath(sourcePath.trim(), currentVaultName)} to ${formatPath(destinationPath.trim(), currentVaultName)}`;
    }
    return "Moved path";
  }

  const fallbackName = call.name.replace(/_/g, " ").trim() || "tool";
  return `${call.isError ? "Tool failed" : "Used"} ${fallbackName}`;
}
