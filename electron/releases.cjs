const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const releasesUrl = 'https://github.com/kelvinmattosdev/Reformato/releases'

function compare(a, b) {
  const parts = a.split('.').map(Number)
  const other = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (parts[i] !== other[i]) return parts[i] - other[i]
  return 0
}

async function getChangelog(app) {
  const log = await readFile(path.join(app.getAppPath(), 'CHANGELOG.md'), 'utf8')
  const entries = log.split(/^## /m).slice(1).flatMap((section) => {
    const [heading, ...body] = section.trim().split('\n')
    const match = /^(\d+\.\d+\.\d+) — (.+)$/.exec(heading)
    if (!match) return []
    return [{ version: match[1], title: match[2], items: body.filter((line) => line.startsWith('- ')).map((line) => line.slice(2)) }]
  })
  const marker = path.join(app.getPath('userData'), 'version-seen.txt')
  const seen = (await readFile(marker, 'utf8').catch(() => '')).trim()
  if (!seen) await writeFile(marker, app.getVersion()).catch(() => {})
  return {
    entries,
    fresh: /^\d+\.\d+\.\d+$/.test(seen)
      ? entries.filter((entry) => compare(entry.version, seen) > 0 && compare(entry.version, app.getVersion()) <= 0)
      : [],
  }
}

function createUpdates(app, send, openExternal) {
  const compatible = process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE)
  const autoUpdater = app.isPackaged && compatible ? require('electron-updater').autoUpdater : null
  let current = { state: app.isPackaged ? 'idle' : 'dev' }
  let busy = false
  function show(state, extras = {}) {
    current = { state, ...extras }
    send('updates:status', current)
    return current
  }
  if (autoUpdater) {
    // O atalho gráfico pode deixar o app sem uma saída de terminal válida.
    autoUpdater.logger = null
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false
    autoUpdater.on('error', () => {})
    autoUpdater.on('update-available', ({ version }) => show('available', { version }))
    autoUpdater.on('update-not-available', () => show('latest'))
    autoUpdater.on('download-progress', ({ percent }) => show('downloading', { version: current.version, percent: Math.round(percent) }))
    autoUpdater.on('update-downloaded', ({ version }) => show('ready', { version }))
  }
  return {
    status: () => current,
    async check() {
      if (!app.isPackaged || busy || current.state === 'ready') return current
      busy = true
      show('checking')
      try {
        if (autoUpdater) {
          const result = await autoUpdater.checkForUpdates()
          if (!result && current.state === 'checking') return show('manual')
        } else {
          const response = await fetch('https://api.github.com/repos/kelvinmattosdev/Reformato/releases/latest', {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Reformato' },
            signal: AbortSignal.timeout(15000),
          })
          if (response.status === 404) return show('unpublished')
          if (!response.ok) throw new Error()
          const version = /^v?(\d+\.\d+\.\d+)$/.exec((await response.json()).tag_name)?.[1]
          if (!version) throw new Error()
          return compare(version, app.getVersion()) > 0 ? show('manual', { version }) : show('latest')
        }
      } catch (error) {
        return show(error.code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' ? 'unpublished' : 'error')
      } finally {
        busy = false
      }
      return current
    },
    async install() {
      if (current.state === 'manual') return openExternal(releasesUrl)
      if (busy || current.state !== 'available') return
      busy = true
      show('downloading', { version: current.version, percent: 0 })
      try {
        await autoUpdater.downloadUpdate()
        if (current.state === 'ready') autoUpdater.quitAndInstall()
      } catch {
        show('error')
      } finally {
        busy = false
      }
    },
    installReady() {
      if (!busy && current.state === 'ready') autoUpdater.quitAndInstall()
    },
  }
}

module.exports = { compare, createUpdates, getChangelog }
