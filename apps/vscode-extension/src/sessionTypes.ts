export interface SessionControllerHost
{
  globalStoragePath: string;
}

export interface SessionSecrets
{
  getOpenAiApiKey(): Promise<string | undefined>;
}

export interface SessionPreferences
{
  getModel(): string;
  getSystemPrompt(): string;
  getInputDevice(): string | undefined;
  getSafetyIdentifier(): string | undefined;
}

export interface SessionUi
{
  showErrorMessage(message: string): unknown;
  setStatusBarMessage(message: string, timeoutMs: number): unknown;
}
