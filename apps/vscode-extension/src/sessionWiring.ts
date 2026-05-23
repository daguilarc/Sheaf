import * as vscode from "vscode";

import {
  getInputDevice,
  getModel,
  getOpenAiApiKey,
  getSafetyIdentifier,
  getSystemPrompt,
} from "./config.js";
import type { SessionControllerHost, SessionPreferences, SessionSecrets, SessionUi } from "./sessionTypes.js";

export function CreateSessionHostFromExtensionContext(context: vscode.ExtensionContext): SessionControllerHost
{
  return {
    globalStoragePath: context.globalStorageUri.fsPath,
  };
}

export function CreateSessionSecretsFromContext(context: vscode.ExtensionContext): SessionSecrets
{
  return {
    getOpenAiApiKey: () => getOpenAiApiKey(context),
  };
}

export function CreateWorkspaceSessionPreferences(): SessionPreferences
{
  return {
    getModel,
    getSystemPrompt,
    getInputDevice,
    getSafetyIdentifier,
  };
}

export function CreateVscodeSessionUi(): SessionUi
{
  return {
    showErrorMessage: (message) => vscode.window.showErrorMessage(message),
    setStatusBarMessage: (message, timeoutMs) => vscode.window.setStatusBarMessage(message, timeoutMs),
  };
}
