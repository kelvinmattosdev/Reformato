const assert = require('node:assert/strict')
const { execFile, execFileSync } = require('node:child_process')
const { mkdir, mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { _electron } = require('playwright-core')
const ffmpeg = require('ffmpeg-static')
const sharp = require('sharp')
const { version } = require('../package.json')
const run = promisify(execFile)

async function testRelease(binary) {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-release-'))
  let app
  try {
    const image = path.join(folder, 'teste.png')
    const sound = path.join(folder, 'som.wav')
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#89334c' } }).png().toFile(image)
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.3', sound])
    app = await _electron.launch({
      executablePath: path.resolve(binary),
      args: [`--user-data-dir=${path.join(folder, 'profile')}`],
      timeout: 30000,
    })
    const page = await app.firstWindow({ timeout: 30000 })
    page.setDefaultTimeout(15000)
    await page.getByRole('heading', { name: 'Conversor de arquivos' }).waitFor()
    await page.getByText(`v${version}`, { exact: true }).waitFor()
    assert.equal((await page.evaluate(() => window.reformato.engineStatus())).state, 'missing')
    if (process.env.REFORMATO_SCREENSHOTS) {
      const destination = path.resolve(process.env.REFORMATO_SCREENSHOTS)
      await mkdir(destination, { recursive: true })
      for (const [label, file] of [['Claro', 'tema-claro.png'], ['Escuro', 'tema-escuro.png']]) {
        await page.getByRole('button', { name: 'Configurações', exact: true }).click()
        await page.getByRole('button', { name: label, exact: true }).click()
        await page.keyboard.press('Escape')
        await page.screenshot({ path: path.join(destination, file), animations: 'disabled' })
      }
    }
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, image)
    await page.getByRole('button', { name: 'Escolher arquivos' }).click()
    await page.getByRole('textbox', { name: 'Pasta de saída' }).fill(folder)
    const convert = page.getByRole('button', { name: 'Converter arquivos' })
    await convert.click()
    await page.getByText('teste.jpg', { exact: true }).waitFor()
    assert.equal((await sharp(path.join(folder, 'teste.jpg')).metadata()).format, 'jpeg')

    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, sound)
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click()
    await page.getByRole('combobox', { name: 'Formato de som.wav' }).selectOption('opus')
    await convert.click()
    const dialog = page.getByRole('dialog', { name: 'Motor de conversão' })
    await dialog.getByRole('button', { name: 'Baixar motor de conversão' }).click()
    await dialog.getByText('FFmpeg instalado. As conversões funcionam offline.', { exact: true }).waitFor({ timeout: 180000 })
    await dialog.getByRole('button', { name: 'Continuar' }).click()
    await convert.click()
    await page.getByText('som.opus', { exact: true }).waitFor()
    assert.equal((await readFile(path.join(folder, 'som.opus'))).subarray(0, 4).toString(), 'OggS')

    const movie = path.join(folder, 'camera.mov')
    await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1440x810:rate=25:duration=1',
      '-i', sound, '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-c:a', 'aac', movie])
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, movie)
    const add = page.getByRole('button', { name: 'Adicionar', exact: true })
    await add.click()
    const mode = page.getByRole('combobox', { name: 'Modo de vídeo MP4' })
    assert.equal(await mode.inputValue(), 'automatic')
    await page.evaluate(() => {
      window.releaseProgress = []
      window.reformato.onProgress((event) => window.releaseProgress.push(event))
    })
    await convert.click()
    await page.getByText('camera.mp4', { exact: true }).waitFor()
    let events = await page.evaluate(() => window.releaseProgress.splice(0))
    assert.ok(events.some((event) => event.detail?.phase === 'copy'))
    assert.ok(events.some((event) => event.detail?.phase === 'finalizing' && event.detail?.percent === 99))
    await page.getByRole('button', { name: 'Remover camera.mov' }).click()
    await page.getByText('camera.mov', { exact: true }).waitFor({ state: 'detached' })
    await add.click()
    await mode.selectOption('light')
    await convert.click()
    await page.getByText('camera (1).mp4', { exact: true }).waitFor()
    events = await page.evaluate(() => window.releaseProgress)
    assert.ok(events.some((event) => event.detail?.phase === 'encode'))
    const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', path.join(folder, 'camera (1).mp4'), '-c', 'copy', '-t', '0', '-f', 'null', '-'])
    assert.match(stderr, /\b1280x720\b/)
    console.log(`Reformato ${version}: pacote, instalação do motor, conversões e modos MP4 verificados.`)
  } finally {
    if (app) await app.close()
    await rm(folder, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}

if (!process.argv[2]) throw new Error('Informe o executável do pacote.')
testRelease(process.argv[2]).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
