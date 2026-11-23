import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, Check, ChevronDown, CircleAlert, FileArchive, FileAudio, FileImage, FileVideo, FolderClosed, History, Layers, LoaderCircle, LockKeyhole, Monitor, Moon, Plus, RefreshCw, Settings2, Sun, X } from 'lucide-react'
import type { Engine, Entry, ImportedFile, Progress, Update } from './desktop'
import mediaFormats from '../shared/media-formats.json'
import './style.css'

type Theme = 'system' | 'light' | 'dark'
type Row = ImportedFile & { target: string; state: 'waiting' | Progress['state']; output?: string; error?: string }
type View = 'settings' | 'changelog' | 'fresh' | 'engine'
const api = window.reformato
const themes = [{ id: 'system', label: 'Sistema', Icon: Monitor }, { id: 'light', label: 'Claro', Icon: Sun }, { id: 'dark', label: 'Escuro', Icon: Moon }] as const
const mediaExtensions = (formats: Record<string, { aliases?: string[]; input: string | string[] }>) =>
  Object.entries(formats).flatMap(([format, info]) => [format, ...(info.aliases ?? [])])
const groups = [
  { label: 'Imagem', values: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'gif'], Icon: FileImage },
  { label: 'Áudio', values: mediaExtensions(mediaFormats.audio), Icon: FileAudio },
  { label: 'Vídeo', values: mediaExtensions(mediaFormats.video), Icon: FileVideo },
]
const fileSize = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${fileSize.format(bytes / 1024)} KB`
  return `${fileSize.format(bytes / 1048576)} MB`
}

function getTheme(): Theme {
  const value = localStorage.getItem('reformato-theme')
  return value === 'light' || value === 'dark' ? value : 'system'
}

function FormatSelect({ value, formats, onChange, label, disabled, placeholder }: {
  value: string; formats: string[]; onChange: (value: string) => void; label: string; disabled?: boolean; placeholder?: string
}) {
  const buckets = groups.map((group) => ({ label: group.label, items: formats.filter((format) => group.values.includes(format)) }))
    .filter((group) => group.items.length)
    .sort((a, b) => formats.indexOf(a.items[0]) - formats.indexOf(b.items[0]))
  const option = (format: string) => <option key={format} value={format}>{format.toUpperCase()}</option>
  return <span className="select-wrap">
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {buckets.length > 1 ? buckets.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map(option)}</optgroup>) : formats.map(option)}
    </select>
    <ChevronDown size={14} aria-hidden="true" />
  </span>
}

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); close() }}>
    <div className="dialog-title"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Fechar"><X size={19} /></button></div>
    {children}
  </dialog>
}

function Changelog({ entries }: { entries: Entry[] }) {
  return entries.length ? <div className="log">
    {entries.map((entry) => <article key={entry.version}>
      <h3><span className="version">v{entry.version}</span>{entry.title}</h3>
      <ul>{entry.items.map((item) => <li key={item}>{item}</li>)}</ul>
    </article>)}
  </div> : <p className="muted">Nenhuma nota de versão disponível.</p>
}

function FormatLegend() {
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) setOpen(null)
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [open])

  return groups.map(({ label, Icon, values }, index) => {
    const tooltipId = `supported-formats-${index}`
    const close = () => setOpen((current) => current === label ? null : current)
    return <div className="format-legend-item" key={label}
      onMouseEnter={() => setOpen(label)}
      onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) close() }}>
      <button type="button" className="text-button format-trigger" aria-describedby={tooltipId}
        onFocus={() => setOpen(label)} onBlur={close} onClick={() => setOpen(label)}><Icon size={15} />{label}</button>
      <div className="format-tooltip" id={tooltipId} role="tooltip" hidden={open !== label}>
        <strong>Formatos de {label.toLowerCase()}</strong>
        <ul>{[...values].sort().map((format) => <li key={format}>.{format}</li>)}</ul>
      </div>
    </div>
  })
}

function App() {
  const [theme, setTheme] = useState(getTheme)
  const [rows, setRows] = useState<Row[]>([])
  const [destination, setDestination] = useState('')
  const [folderError, setFolderError] = useState('')
  const folderInput = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<View | null>(null)
  const [version, setVersion] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [fresh, setFresh] = useState<Entry[]>([])
  const [update, setUpdate] = useState<Update>({ state: 'idle' })
  const [engine, setEngine] = useState<Engine>({ state: 'missing' })
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const dragDepth = useRef(0)
  const preventDrops = useRef((event: globalThis.DragEvent) => event.preventDefault())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('reformato-theme', theme)
  }, [theme])

  useEffect(() => {
    const prevent = preventDrops.current
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  useEffect(() => {
    if (!api) return
    const stopProgress = api.onProgress(({ id, ...progress }) => {
      setRows((current) => current.map((row) => row.id === id ? { ...row, ...progress } : row))
    })
    const stopUpdates = api.onUpdate(setUpdate)
    const stopEngine = api.onEngine(setEngine)
    void api.updateStatus().then(setUpdate).catch(() => {})
    void api.engineStatus().then(setEngine).catch(() => {})
    void api.about().then((info) => {
      setVersion(info.version)
      setEntries(info.entries)
      setFresh(info.fresh)
      if (info.fresh.length) setView((current) => current ?? 'fresh')
    }).catch(() => {})
    return () => { stopProgress(); stopUpdates(); stopEngine() }
  }, [])

  const waiting = rows.filter((row) => row.state === 'waiting' || row.state === 'error')
  const commonFormats = waiting[0]?.formats.filter((format) => waiting.every((row) => row.formats.includes(format))) ?? []
  const shared = waiting[0]?.target && waiting.every((row) => row.target === waiting[0].target) ? waiting[0].target : ''
  const completed = rows.filter((row) => row.state === 'done').length
  const failed = rows.filter((row) => row.state === 'error').length
  const busy = running || update.state === 'downloading'
  const hasDestination = destination.trim().length > 0

  useEffect(() => {
    if (folderError && !busy) folderInput.current?.focus()
  }, [folderError, busy])

  async function addFiles(files?: File[]) {
    if (!api || busy) return
    setNotice('')
    try {
      const result = await (files ? api.dropFiles(files) : api.chooseFiles())
      if (result.skipped) setNotice(`${result.skipped} ${result.skipped === 1 ? 'item ignorado' : 'itens ignorados'}: formato não compatível, pasta ou limite da fila.`)
      setRows((previous) => [...previous, ...result.files.map((file): Row => ({ ...file, target: file.formats[0], state: 'waiting' }))])
    } catch {
      setNotice('Não foi possível adicionar os arquivos. Tente selecionar até 1.000 itens.')
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (event.dataTransfer.files.length) void addFiles(Array.from(event.dataTransfer.files))
  }

  async function chooseFolder() {
    try {
      const selected = await api?.chooseDestination(destination)
      if (selected) {
        setDestination(selected)
        setFolderError('')
      }
    } catch {
      setNotice('Não foi possível escolher a pasta de saída.')
    }
  }

  async function start() {
    if (!api || busy || !hasDestination || !waiting.length) return
    setNotice('')
    setFolderError('')
    setRunning(true)
    try {
      const result = await api.convert(waiting.map(({ id, target }) => ({ id, target })), destination)
      if ('engineRequired' in result) setView('engine')
      else if ('error' in result) setFolderError(result.error)
      else setDestination(result.destination)
    } catch {
      setNotice('Não foi possível iniciar a fila. Confira a pasta de saída.')
    } finally {
      setRunning(false)
    }
  }

  function setTarget(id: string, target: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, target, state: 'waiting', error: undefined } : row))
  }

  function setBatch(target: string) {
    if (!target) return
    setRows((current) => current.map((row) => (row.state === 'waiting' || row.state === 'error') && row.formats.includes(target)
      ? { ...row, target, state: 'waiting', error: undefined } : row))
  }

  async function closeDialog() {
    if (view === 'fresh') await api?.acknowledge().catch(() => {})
    setView(null)
  }

  const updateLabel = {
    idle: 'Consulte o GitHub para verificar a versão mais recente.',
    checking: 'Verificando no GitHub…',
    available: `A versão ${update.version ?? ''} está disponível.`,
    downloading: `Baixando a nova versão… ${update.percent ?? 0}%`,
    ready: 'Atualização pronta para instalar.',
    latest: 'Você já está na versão mais recente.',
    manual: update.version ? `A versão ${update.version} está disponível para download.` : 'Esta instalação requer atualização manual.',
    error: 'Não foi possível concluir a atualização. Verifique a conexão e tente novamente.',
    unpublished: 'Nenhuma versão estável foi publicada no GitHub ainda.',
    dev: 'A atualização é ativada nos pacotes de distribuição.',
  }[update.state]

  const updateButton = update.state === 'available' ? `Atualizar para v${update.version}` : update.state === 'manual' ? 'Abrir releases' : update.state === 'ready' ? 'Instalar e reiniciar' : 'Verificar agora'
  const engineLabel = {
    missing: 'Baixe o FFmpeg uma vez (cerca de 80 MB) para converter áudio, vídeo e BMP. Os arquivos não são enviados ao GitHub.',
    downloading: `Baixando e verificando o FFmpeg… ${engine.percent ?? 0}%`,
    ready: 'FFmpeg instalado. As conversões funcionam offline.',
    unsupported: 'O motor não está disponível para esta plataforma.',
    error: 'Não foi possível verificar ou baixar o FFmpeg. Verifique a conexão e tente novamente.',
  }[engine.state]
  function installEngine() {
    void api?.installEngine().then(setEngine).catch(() => setEngine({ state: 'error' }))
  }
  const engineControls = <><p role="status">{engineLabel}</p>
    {engine.state !== 'ready' && engine.state !== 'unsupported' && <button className="button secondary"
      disabled={!api || engine.state === 'downloading'} onClick={installEngine}><ArrowDownToLine size={16} />
      {engine.state === 'error' ? 'Tentar baixar novamente' : 'Baixar motor de conversão'}</button>}</>
  function actOnUpdate() {
    if (running) return
    if (update.state === 'ready') void api?.installReady().catch(() => setNotice('Não foi possível instalar a atualização.'))
    else if (update.state === 'available' || update.state === 'manual') void api?.installUpdate().catch(() => setNotice('Não foi possível iniciar a atualização.'))
    else void api?.checkUpdate().catch(() => {})
  }

  return <>
    <a className="skip" href="#workspace">Ir para a área de conversão</a>
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand"><img src="./reformato.svg" width="34" height="34" alt="" /><strong>Reformato</strong></div>
        <div className="top-actions">
          {(update.state === 'available' || update.state === 'ready' || (update.state === 'manual' && update.version)) &&
            <button className="button small update-pill" disabled={running} onClick={actOnUpdate}><ArrowDownToLine size={15} />{updateButton}</button>}
          {update.state === 'downloading' && <span className="update-progress" role="status">Atualizando… {update.percent ?? 0}%</span>}
          <button className="icon-button" onClick={() => setView('settings')} aria-label="Configurações" title="Configurações"><Settings2 size={19} /></button>
        </div>
      </div>
    </header>

    <main id="workspace" tabIndex={-1} className="workspace">
      <div className="intro" data-enter>
        <div className="overline"><span /> ESTÚDIO DE CONVERSÃO</div>
        <h1>Conversor de arquivos</h1>
        <p>Troque o formato de imagens, áudios e vídeos em lote.</p>
      </div>

      {!api && <p className="notice" role="status">Abra o Reformato pelo Electron para selecionar e converter arquivos.</p>}
      {notice && <p className="notice" role="status"><CircleAlert size={17} />{notice}<button className="icon-button" aria-label="Dispensar aviso" onClick={() => setNotice('')}><X size={16} /></button></p>}

      <div className="work-grid">
        <section className={`panel queue ${dragging ? 'is-dragging' : ''}`} aria-labelledby="queue-title"
          onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files') && !busy) { dragDepth.current++; setDragging(true) } }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) }}
          onDrop={onDrop}>
          <div className="panel-head">
            <div className="panel-heading"><Layers size={18} /><h2 id="queue-title">Fila de conversão</h2>{rows.length > 0 && <span className="count">{rows.length}</span>}</div>
            {rows.length > 0 && <button className="button quiet small" disabled={busy || !api} onClick={() => void addFiles()}><Plus size={16} /> Adicionar</button>}
          </div>
          {rows.length === 0 ? <div className="drop-zone">
            <div className="conversion-mark" aria-hidden="true">
              <span className="tile tile-source"><FileImage size={24} /></span>
              <span className="tile-arrow"><ArrowLeftRight size={21} /></span>
              <span className="tile tile-target"><FileAudio size={24} /></span>
            </div>
            <h3>{dragging ? 'Solte os arquivos aqui' : 'Arraste arquivos para cá'}</h3>
            <p>Você pode adicionar vários de uma só vez.</p>
            <button className="button secondary" disabled={busy || !api} onClick={() => void addFiles()}><Plus size={17} /> Escolher arquivos</button>
          </div> : <ul className="file-list" aria-label="Arquivos da fila">
            {rows.map((row) => {
              const Icon = groups.find((group) => group.values.includes(row.format))?.Icon ?? FileArchive
              return <li className={`file-row row-${row.state}`} key={row.id}>
                <div className="file-icon"><Icon size={19} /></div>
                <div className="file-meta">
                  <strong title={row.name}>{row.name}</strong>
                  <span title={row.error ?? row.output}>{row.error ?? row.output ?? `${row.format.toUpperCase()} · ${sizeLabel(row.size)}`}</span>
                </div>
                <FormatSelect value={row.target} formats={row.formats} disabled={busy || row.state === 'done'} label={`Formato de ${row.name}`} onChange={(value) => setTarget(row.id, value)} />
                <span className={`row-status ${row.state}`} role="status">
                  {row.state === 'error' ? <><CircleAlert size={15} />Falhou</> : row.state === 'done' ? <><Check size={16} />Pronto</> : row.state === 'running' ? <><LoaderCircle size={16} className="spin" />Convertendo</> : 'Na fila'}
                </span>
                <button className="icon-button remove" title="Remover arquivo" aria-label={`Remover ${row.name}`} disabled={busy} onClick={() => {
                  void api?.removeFile(row.id).then(() => setRows((current) => current.filter((item) => item.id !== row.id))).catch(() => setNotice('Não foi possível remover o arquivo.'))
                }}><X size={16} /></button>
              </li>
            })}
          </ul>}
          <div className="queue-foot">
            {rows.length ? <><span>{waiting.length} aguardando · {completed} concluído(s){failed ? ` · ${failed} com falha` : ''}</span>
              {completed > 0 && <button className="text-button" onClick={() => void api?.openDestination().then((error) => { if (error) setNotice('Não foi possível abrir a pasta.') }).catch(() => setNotice('Não foi possível abrir a pasta.'))}>Abrir última pasta <ArrowRight size={14} /></button>}</> :
              <FormatLegend />}
          </div>
        </section>

        <aside className="panel output" aria-labelledby="output-title">
          <div className="panel-head"><div className="panel-heading"><Settings2 size={18} /><h2 id="output-title">Saída</h2></div></div>
          <div className="output-body">
            <div className="field">
              <h3>Formato do lote</h3>
              <FormatSelect value={shared} formats={commonFormats} disabled={busy || !commonFormats.length} label="Formato do lote" onChange={setBatch}
                placeholder={!waiting.length ? 'Adicione arquivos' : !commonFormats.length ? 'Defina por arquivo' : 'Escolher formato'} />
              <p>Você também pode definir a saída de cada arquivo na fila.</p>
            </div>
            <div className="field">
              <label htmlFor="output-folder">Pasta de saída</label>
              <div className="folder-field">
                <input ref={folderInput} id="output-folder" type="text" value={destination}
                  placeholder="Digite o caminho" title={destination || undefined} disabled={busy || !api}
                  autoComplete="off" spellCheck={false} aria-invalid={!!folderError}
                  aria-describedby={folderError ? 'folder-error' : 'folder-hint'}
                  onChange={(event) => { setDestination(event.target.value); setFolderError('') }} />
                <button className="button secondary folder-picker" disabled={busy || !api} onClick={() => void chooseFolder()}
                  aria-label="Selecionar pasta de saída" title="Selecionar pasta de saída"><FolderClosed size={18} /></button>
              </div>
              {folderError
                ? <p id="folder-error" className="field-error" role="alert">{folderError}</p>
                : <p id="folder-hint">Digite o caminho ou clique no ícone da pasta.</p>}
            </div>
            <div className="output-action">
              <button className="button primary" onClick={() => void start()} disabled={busy || !hasDestination || !waiting.length || !api}>
                {running ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}
                {running ? 'Convertendo…' : 'Converter arquivos'}
              </button>
              <span className="action-hint">{running ? 'Acompanhe o status na fila.' : !waiting.length ? 'Adicione arquivos para começar.' : !hasDestination ? 'Informe uma pasta para continuar.' : `${waiting.length} ${waiting.length === 1 ? 'arquivo pronto' : 'arquivos prontos'} para converter.`}</span>
            </div>
          </div>
        </aside>
      </div>

      <footer className="workspace-footer">
        <span><LockKeyhole size={15} /> Seus arquivos ficam neste computador.</span>
        <button className="text-button" onClick={() => setView('changelog')}><History size={15} /> Histórico de versões{version && <span className="version">v{version}</span>}</button>
      </footer>
    </main>

    {view && <Dialog key={view} title={view === 'settings' ? 'Configurações' : view === 'engine' ? 'Motor de conversão' : view === 'fresh' ? 'O que mudou' : 'Histórico de versões'} close={() => void closeDialog()}>
      {view === 'settings' ? <div className="preferences">
        <section><h3>Aparência</h3><p>Escolha o tema do Reformato.</p>
          <div className="theme-switch" role="group" aria-label="Tema">
            {themes.map(({ id, label, Icon }) => <button key={id} className="button secondary" aria-pressed={theme === id} onClick={() => setTheme(id)}><Icon size={17} /> {label}</button>)}
          </div>
        </section>
        <section><h3>Atualizações {version && <span className="version">v{version}</span>}</h3><p role="status">{updateLabel}</p>
          <button className="button secondary" disabled={running || ['dev', 'checking', 'downloading'].includes(update.state) || !api} onClick={actOnUpdate}><RefreshCw size={16} /> {updateButton}</button>
        </section>
        <section><h3>Motor de conversão</h3>{engineControls}</section>
      </div> : view === 'engine' ? <div className="preferences"><section>{engineControls}
        {engine.state === 'ready' && <button className="button primary" onClick={() => void closeDialog()}>Continuar</button>}</section></div>
        : <Changelog entries={view === 'fresh' ? fresh : entries} />}
      {view === 'fresh' && <button className="button primary dialog-confirm" onClick={() => void closeDialog()}><Check size={17} /> Continuar</button>}
    </Dialog>}
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
