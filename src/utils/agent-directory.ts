import { AGENT_DEFINITIONS, getAgent, type AgentId } from './agent-registry';

import type { IRemoteAgent, IRemoteWindow } from '../pure-interface';

export type AgentBindings = Record<string, AgentId>;

export interface AgentEntry extends IRemoteAgent {
  discovered: boolean;
  windows: IRemoteWindow[];
}

export const windowContext = (source: IRemoteWindow) =>
  source.contextId || source.id;

export function buildAgentDirectory(
  applications: IRemoteAgent[],
  windows: IRemoteWindow[],
  bindings: AgentBindings
) {
  const opened = new Set(applications.map((application) => application.id));
  const assigned = new Map(
    windows.map((source) => [
      source.id,
      getAgent(source.agentId)?.id ||
        getAgent(bindings[windowContext(source)])?.id,
    ])
  );
  const agents: AgentEntry[] = AGENT_DEFINITIONS.map(({ id, name }) => ({
    id,
    name,
    discovered:
      opened.has(id) || windows.some((source) => source.agentId === id),
    windows: windows.filter((source) => assigned.get(source.id) === id),
  })).filter((agent) => agent.discovered || agent.windows.length);
  return {
    agents,
    otherWindows: windows.filter((source) => !assigned.get(source.id)),
  };
}
