const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { randomUUID } = require('node:crypto')
const { stat, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { convertFile, sourceFormat, formatsFor, needsFfmpeg, videoProfiles, supported } = require('./conversion.cjs')
const { resolveDestination } = require('./destination.cjs')
const { createEngine } = require('./engine.cjs')
const { createUpdates, getChangelog } = require('./releases.cjs')

const inputFiles = new Map()
const knownPaths = new Map()
const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
const rendererUrl = pathToFileURL(indexPath).href
let window
let destination
let running = false

function send(channel, message) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, message)
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, args) => {
    const frame = event.senderFrame
    if (event.sender !== window?.webContents || !frame || frame.parent || frame.url.split('#', 1)[0] !== rendererUrl) {
      throw new Error('Origem não permitida.')
    }
    return callback(args)
  })
}

async function importFiles(paths) {
  if (running) return { files: [], skipped: 0 }
  if (!Array.isArray(paths) || paths.length > 1000 || paths.some((file) => typeof file !== 'string' || !path.isAbsolute(file))) {
    throw new Error('Seleção de arquivos inválida.')
  }
  const files = []
  let skipped = 0
  for (const file of new Set(paths)) {
    if (knownPaths.has(file)) continue
    const format = sourceFormat(file)
    const formats = formatsFor(format)
    const metadata = formats.length ? await stat(file).catch(() => null) : null
    if (!metadata?.isFile() || inputFiles.size >= 1000) {
      skipped++
      continue
    }
    if (knownPaths.has(file)) continue
    const id = randomUUID()
    inputFiles.set(id, file)
    knownPaths.set(file, id)
    files.push({ id, name: path.basename(file), format: path.extname(file).slice(1).toLowerCase(), formats, size: metadata.size })
  }
  return { files, skipped }
}

async function createWindow(updates) {
  window = new BrowserWindow({
    width: 1120, height: 790, minWidth: 610, minHeight: 540,
    title: 'Reformato', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  })
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.on('close', (event) => {
    if (running) event.preventDefault()
  })
  window.on('closed', () => {
    window = null
    destination = null
    inputFiles.clear()
    knownPaths.clear()
  })
  window.once('ready-to-show', () => window?.show())
  await window.loadFile(indexPath)
  if (app.isPackaged && updates.status().state === 'idle') void updates.check()
}

app.whenReady().then(async () => {
  const updates = createUpdates(app, send, (url) => shell.openExternal(url))
  const engine = createEngine(app, send)
  handle('files:choose', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Adicionar arquivos', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Formatos compatíveis', extensions: supported }, { name: 'Todos os arquivos', extensions: ['*'] }],
    })
    return importFiles(result.filePaths)
  })
  handle('files:drop', importFiles)
  handle('files:remove', (id) => {
    if (!running && inputFiles.has(id)) {
      knownPaths.delete(inputFiles.get(id))
      inputFiles.delete(id)
    }
  })
  handle('destination:choose', async (current) => {
    if (running) return null
    const { path: defaultPath } = await resolveDestination(current)
    const result = await dialog.showOpenDialog(window, {
      title: 'Escolher pasta de saída',
      defaultPath: defaultPath ?? destination,
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  handle('destination:open', async () => destination ? shell.openPath(destination) : '')
  handle('engine:status', engine.status)
  handle('engine:install', engine.install)
  handle('conversion:start', async ({ jobs, outputFolder, videoProfile = 'automatic' } = {}) => {
    if (running || updates.status().state === 'downloading' || !Array.isArray(jobs) || !jobs.length || jobs.length > 1000) throw new Error('Fila inválida.')
    if (!videoProfiles.includes(videoProfile)) throw new Error('Perfil de vídeo inválido.')
    const ids = new Set()
    for (const job of jobs) {
      const file = inputFiles.get(job?.id)
      if (!file || ids.has(job.id) || !formatsFor(sourceFormat(file)).includes(job.target)) throw new Error('Conversão inválida.')
      ids.add(job.id)
    }
    running = true
    try {
      const output = await resolveDestination(outputFolder)
      if (output.error) return { error: output.error }
      const folder = output.path
      const requiresEngine = jobs.some(({ id, target }) => needsFfmpeg(sourceFormat(inputFiles.get(id)), target))
      const executable = requiresEngine ? await engine.locate() : undefined
      if (requiresEngine && !executable) return { engineRequired: true }
      destination = folder
      for (const { id, target } of jobs) {
        send('conversion:progress', { id, state: 'running', error: null, detail: null })
        try {
          const output = await convertFile(inputFiles.get(id), target, folder, executable, {
            videoProfile,
            onProgress: (detail) => send('conversion:progress', { id, state: 'running', detail }),
          })
          send('conversion:progress', { id, state: 'done', output })
        } catch (error) {
          const diagnostic = {
            EACCES: 'Sem permissão para ler o arquivo ou gravar na pasta de saída.',
            EPERM: 'Sem permissão para ler o arquivo ou gravar na pasta de saída.',
            ENOSPC: 'Não há espaço suficiente na pasta de saída.',
            ENOENT: 'O arquivo ou a pasta de saída não existe mais.',
          }[error.code] ?? (/no space left/i.test(error.cause?.message ?? '')
            ? 'Não há espaço suficiente na pasta de saída.' : undefined)
          const publicMessage = /^(O arquivo não tem|O conteúdo da imagem|Imagens animadas|Não foi possível (ler a mídia|iniciar o conversor|processar a imagem BMP))/.test(error.message)
          send('conversion:progress', { id, state: 'error', error: diagnostic || (publicMessage ? error.message : 'Não foi possível converter este arquivo.') })
        }
      }
      return { destination: folder }
    } finally {
      running = false
    }
  })
  handle('updates:status', updates.status)
  handle('updates:check', updates.check)
  handle('updates:install', () => { if (!running) return updates.install() })
  handle('updates:ready', () => { if (!running) updates.installReady() })
  handle('app:about', async () => ({ version: app.getVersion(), ...(await getChangelog(app)) }))
  handle('app:acknowledge', () => writeFile(path.join(app.getPath('userData'), 'version-seen.txt'), app.getVersion()))
  app.on('activate', () => { if (!window) void createWindow(updates) })
  await createWindow(updates)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
