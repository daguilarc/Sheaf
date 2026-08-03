export const MAX_BROWSER_AUDIO_INPUT_CHANNELS = 32;

export function browserAudioInputLimitDiagnostic(requestedChannels: number): string {
  return `browser-audio-input-channel-limit-exceeded: requested ${requestedChannels}, limit ${MAX_BROWSER_AUDIO_INPUT_CHANNELS}`;
}
