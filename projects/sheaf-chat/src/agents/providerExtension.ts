import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../server/config.js";
import {
  BuildLocalProviderRegistration,
  type LocalProviderState,
  x_localProviderName,
} from "./localProvider.js";

export function CreateSheafProviderExtension(
  config: SheafChatConfig,
  localState: LocalProviderState,
): (pi: ExtensionAPI) => void
{
  const providerConfig = BuildLocalProviderRegistration(config, localState);

  return (pi: ExtensionAPI) =>
  {
    pi.registerProvider(x_localProviderName, providerConfig);
  };
}
