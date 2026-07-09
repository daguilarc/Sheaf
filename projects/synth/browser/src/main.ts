import { AudioBridge, AudioBridgeOptions, BrowserAudioWorker } from "./audio.js";

export function installBrowserAudioActivation(
  target: EventTarget,
  worker: BrowserAudioWorker,
  options: AudioBridgeOptions = {},
): AudioBridge {
  const bridge = new AudioBridge(worker, options);
  target.addEventListener("pointerdown", () => { void bridge.startFromUserActivation(); }, { once: true });
  return bridge;
}
