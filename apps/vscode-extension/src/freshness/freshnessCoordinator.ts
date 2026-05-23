import type { FreshnessHooks, AgentMutationGuard } from "./types.js";
import type { FreshnessService } from "./freshnessService.js";

export class FreshnessCoordinator
{
  private m_current: FreshnessService | null = null;

  readonly hooks: FreshnessHooks = {
    markFileObserved: (file) =>
    {
      this.m_current?.markFileObserved(file);
    },
    markViewportObserved: (file) =>
    {
      this.m_current?.markViewportObserved(file);
    },
    markCursorObserved: (file) =>
    {
      this.m_current?.markCursorObserved(file);
    },
    beginAgentMutation: (): AgentMutationGuard =>
    {
      return this.m_current !== null ? this.m_current.beginAgentMutation() : { end: () => {} };
    },
  };

  attach(service: FreshnessService): void
  {
    this.m_current = service;
  }

  detach(): void
  {
    this.m_current?.dispose();
    this.m_current = null;
  }
}
