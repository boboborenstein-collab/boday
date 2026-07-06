// Export / import of the user's data as a portable JSON file. Keeps a stable
// envelope so future versions can migrate on import.

import type { Task, TaskCompletion } from '../types'

export interface BoDayExport {
  app: 'boday'
  version: 1
  exportedAt: string
  tasks: Task[]
  completions: TaskCompletion[]
}

export function buildExport(tasks: Task[], completions: TaskCompletion[]): BoDayExport {
  return {
    app: 'boday',
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    completions,
  }
}

/** Trigger a browser download of the export as `boday-backup-YYYY-MM-DD.json`. */
export function downloadExport(tasks: Task[], completions: TaskCompletion[]) {
  const data = buildExport(tasks, completions)
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `boday-backup-${data.exportedAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

/** Parse + validate an uploaded file. Throws on anything that isn't a BoDay export. */
export function parseImport(json: string): { tasks: Task[]; completions: TaskCompletion[] } {
  const data = JSON.parse(json) as Partial<BoDayExport> & { app?: string }
  // 'cadence' accepted for backups made before the rename.
  if ((data.app !== 'boday' && data.app !== 'cadence') || !Array.isArray(data.tasks) || !Array.isArray(data.completions)) {
    throw new Error('Not a valid BoDay backup file.')
  }
  return { tasks: data.tasks, completions: data.completions }
}
