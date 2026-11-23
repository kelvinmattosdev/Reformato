const { createHash } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { chmod, mkdir, mkdtemp, rename, rm, stat } = require('node:fs/promises')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const path = require('node:path')

const base = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1'
const builds = {
  'linux-x64': { size: 79826272, hash: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99' },
  'win32-x64': { size: 82797568, hash: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00' },
}

function createEngine(app, send) {
  const platform = `${process.platform}-${process.arch}`
  const build = builds[platform]
  const directory = path.join(app.getPath('userData'), 'engine')
  const executable = path.join(directory, `ffmpeg-${build?.hash.slice(0, 12) ?? 'unknown'}${process.platform === 'win32' ? '.exe' : ''}`)
  let pending
  let verified = false
  let status = { state: 'missing' }
  const show = (state, percent) => {
    status = percent === undefined ? { state } : { state, percent }
    send('engine:status', status)
    return status
  }
  const matches = async (file) => {
    if ((await stat(file)).size !== build.size) return false
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(file)) digest.update(chunk)
    return digest.digest('hex') === build.hash
  }
  async function locate() {
    if (!app.isPackaged) return require('ffmpeg-static') || null
    if (!build) return null
    if (!verified) verified = await matches(executable).catch(() => false)
    return verified ? executable : null
  }

  return {
    locate,
    async status() {
      if (pending || status.state === 'error') return status
      return { state: (await locate()) ? 'ready' : build ? 'missing' : 'unsupported' }
    },
    install() {
      if (pending) return pending
      pending = (async () => {
        let temporary
        try {
          if (await locate()) return show('ready')
          if (!build) return show('unsupported')
          show('downloading', 0)
          await mkdir(directory, { recursive: true })
          temporary = await mkdtemp(path.join(directory, 'download-'))
          const candidate = path.join(temporary, 'ffmpeg')
          const signal = AbortSignal.timeout(300000)
          const response = await fetch(`${base}/ffmpeg-${platform}`, { signal })
          if (!response.ok || !response.body) throw new Error('Download indisponível.')
          const digest = createHash('sha256')
          let size = 0
          let percent = 0
          const check = new Transform({
            transform(chunk, _encoding, callback) {
              size += chunk.length
              if (size > build.size) return callback(new Error('Tamanho inesperado.'))
              digest.update(chunk)
              const next = Math.floor((size / build.size) * 100)
              if (next !== percent) show('downloading', percent = next)
              callback(null, chunk)
            },
          })
          await pipeline(Readable.fromWeb(response.body), check, createWriteStream(candidate, { flags: 'wx' }), { signal })
          if (size !== build.size || digest.digest('hex') !== build.hash) throw new Error('SHA-256 inesperado.')
          await chmod(candidate, 0o755)
          await rename(candidate, executable)
          verified = true
          return show('ready')
        } catch {
          return show('error')
        } finally {
          if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => {})
        }
      })().finally(() => { pending = null })
      return pending
    },
  }
}

module.exports = { createEngine }
