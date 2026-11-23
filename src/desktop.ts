export type ImportedFile = { id: string; name: string; format: string; formats: string[]; size: number }
export type Job = { id: string; target: string }
export type Progress = { id: string; state: 'running' | 'done' | 'error'; error?: string; output?: string }
export type Update = {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'latest' | 'manual' | 'error' | 'unpublished' | 'dev'
  version?: string
  percent?: number
}
export type Entry = { version: string; title: string; items: string[] }
export type Engine = { state: 'missing' | 'downloading' | 'ready' | 'unsupported' | 'error'; percent?: number }
type ImportResult = { files: ImportedFile[]; skipped: number }

declare global {
  interface Window {
    reformato?: {
      chooseFiles(): Promise<ImportResult>
      dropFiles(files: File[]): Promise<ImportResult>
      removeFile(id: string): Promise<void>
      chooseDestination(current: string): Promise<string | null>
      openDestination(): Promise<string>
      convert(jobs: Job[], outputFolder: string): Promise<{ destination: string } | { error: string } | { engineRequired: true }>
      onProgress(callback: (event: Progress) => void): () => void
      engineStatus(): Promise<Engine>
      installEngine(): Promise<Engine>
      onEngine(callback: (event: Engine) => void): () => void
      updateStatus(): Promise<Update>
      checkUpdate(): Promise<Update>
      installUpdate(): Promise<void>
      installReady(): Promise<void>
      onUpdate(callback: (event: Update) => void): () => void
      about(): Promise<{ version: string; entries: Entry[]; fresh: Entry[] }>
      acknowledge(): Promise<void>
    }
  }
}
