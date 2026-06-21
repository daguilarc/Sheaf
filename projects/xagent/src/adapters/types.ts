import type {
  ErrorEvent,
  HarnessName,
  MessageCompletedEvent,
  MessageDeltaEvent,
  RawProviderEvent,
  StatusEvent,
  ThinkingLevel,
  ToolCompletedEvent,
  ToolStartedEvent,
  TurnCompletedEvent,
  TurnFailedEvent,
} from "../events.js";

export type HarnessCapabilities = {
  readonly forwardsModel: boolean;
  readonly forwardsThinkingLevel: boolean;
  readonly streamsDeltas: boolean;
};

export type HarnessStartOptions = {
  readonly cwd: string;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
};

export type AdapterTurnContext = {
  readonly text: string;
  readonly turnId: string;
  readonly inputSequence: number;
};

type AdapterTurnScopedEvent =
  | WithOptionalTurnId<MessageDeltaEvent>
  | WithOptionalTurnId<MessageCompletedEvent>
  | WithOptionalTurnId<ToolStartedEvent>
  | WithOptionalTurnId<ToolCompletedEvent>
  | WithOptionalTurnId<TurnCompletedEvent>
  | WithOptionalTurnId<TurnFailedEvent>;

export type AdapterEvent = (AdapterTurnScopedEvent | StatusEvent | ErrorEvent | RawProviderEvent) & {
  readonly rawProvider?: unknown;
};

type WithOptionalTurnId<T extends { turn_id: string }> = Omit<T, "turn_id"> & {
  readonly turn_id?: string;
};

export type HarnessSession = {
  readonly providerThreadId?: string;
  submit(context: AdapterTurnContext): AsyncIterable<AdapterEvent>;
  close(): Promise<void>;
};

export type HarnessAdapter = {
  readonly harness: HarnessName;
  readonly capabilities: HarnessCapabilities;
  start(options: HarnessStartOptions): Promise<HarnessSession>;
};
