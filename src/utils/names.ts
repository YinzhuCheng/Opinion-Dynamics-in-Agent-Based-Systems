import type { AgentSpec } from '../types';

export const resolveAgentNameMap = (agents: AgentSpec[]): Record<string, string> => {
  return agents.reduce<Record<string, string>>((map, agent) => {
    map[agent.id] = agent.name;
    return map;
  }, {});
};
