export interface AgentQuietWindow {
  start: string
  end: string
  title: string
}

export function buildAgentSnapshot<T, C>({
  tasks,
  completions,
  quietWindows,
  now,
  timeZone,
}: {
  tasks: T[]
  completions: C[]
  quietWindows: AgentQuietWindow[]
  now: Date
  timeZone: string
}): {
  tasks: T[]
  completions: C[]
  quietWindows: AgentQuietWindow[]
  now: string
  timezone: string
} {
  return {
    tasks,
    completions,
    quietWindows,
    now: now.toISOString(),
    timezone: timeZone,
  }
}
