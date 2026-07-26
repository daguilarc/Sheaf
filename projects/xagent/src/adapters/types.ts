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
  readonly permissionMode?: string;
};

export type AdapterTurnContext = {
  readonly text: string;
  readonly turnId: string;
  readonly inputSequence: number;
};

export type OwnedProcessIdentity = {
  readonly pid: number;
  readonly process_group_id?: number;
  readonly started_at: string;
  readonly start_identity: string;
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
  readonly ownedProcess?: OwnedProcessIdentity;
  submit(context: AdapterTurnContext): AsyncIterable<AdapterEvent>;
  interrupt?(): Promise<void>;
  close(): Promise<void>;
};

export type HarnessAdapter = {
  readonly harness: HarnessName;
  readonly capabilities: HarnessCapabilities;
  start(options: HarnessStartOptions): Promise<HarnessSession>;
};
