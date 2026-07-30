import type { WatchdogRequest } from "../../src/supervision/types.js";

export function withWatchdogInputBytes(
  value: Omit<WatchdogRequest, "input_bytes">,
): WatchdogRequest {
  return {
    ...value,
    input_bytes: watchdogSnapshotByteLength(value),
  };
}

function watchdogSnapshotByteLength(value: Omit<WatchdogRequest, "input_bytes">): number {
  const inputBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  const propertyBytes = Buffer.byteLength(',"input_bytes":', "utf8");
  let totalBytes = inputBytes + propertyBytes + 1;
  while (true) {
    const next = inputBytes + propertyBytes + String(totalBytes).length;
    if (next === totalBytes) {
      return totalBytes;
    }
    totalBytes = next;
  }
}
