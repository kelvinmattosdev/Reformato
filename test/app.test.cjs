const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdir, mkdtemp, readFile, writeFile, rm } = require('node:fs/promises')
const { homedir, tmpdir } = require('node:os')
const path = require('node:path')
const { compare, getChangelog, createUpdates } = require('../electron/releases.cjs')
const { resolveDestination } = require('../electron/destination.cjs')

test('accepts typed destination folders and rejects paths that cannot be used', async (t) => {
  const home = homedir()
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-destination-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const withSpaces = path.join(folder, process.platform === 'win32' ? 'Pasta de saída' : 'Pasta de saída ')
  const file = path.join(folder, 'saida.txt')
  await mkdir(withSpaces)
  await writeFile(file, '')
  assert.deepEqual(await resolveDestination(withSpaces), { path: withSpaces })
  assert.deepEqual(await resolveDestination(`  ${folder}${path.sep}`), { path: folder })
  assert.deepEqual(await resolveDestination('~'), { path: home })
  assert.match((await resolveDestination('pasta-relativa')).error, /caminho completo/)
  assert.match((await resolveDestination(file)).error, /não é uma pasta/)
  assert.match((await resolveDestination(path.join(folder, 'inexistente'))).error, /não existe/)
  assert.match((await resolveDestination('\0')).error, /caminho de pasta válido/)
})

test('shows only the releases installed since the last acknowledged version', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-releases-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(path.join(folder, 'CHANGELOG.md'), '# Histórico\n\n## 1.1.0 — Futuro\n- Fora do intervalo\n\n## 1.0.1 — Correções\n- Corrige o seletor\n\n## 1.0.0 — Primeira versão\n- Adiciona o seletor\n')
  const app = { getAppPath: () => folder, getPath: () => folder, getVersion: () => '1.0.1' }
  const marker = path.join(folder, 'version-seen.txt')
  assert.deepEqual((await getChangelog(app)).fresh, [])
  assert.equal(await readFile(marker, 'utf8'), '1.0.1')
  await writeFile(marker, '1.0.0')
  const log = await getChangelog(app)
  assert.deepEqual(log.fresh, [{ version: '1.0.1', title: 'Correções', items: ['Corrige o seletor'] }])
  assert.equal(log.entries.length, 3)
  assert.ok(compare('0.10.0', '0.9.12') > 0)
})

test('development mode does not download or open update links', async () => {
  const unexpected = () => assert.fail('unexpected update action')
  const updates = createUpdates({ isPackaged: false }, unexpected, unexpected)
  assert.deepEqual(await updates.check(), { state: 'dev' })
  await updates.install()
  updates.installReady()
})

test('text, controls and focus indicators meet AA contrast for both palettes', async () => {
  const css = await readFile(path.join(__dirname, '..', 'src', 'style.css'), 'utf8')
  const palette = (block) => Object.fromEntries([...block.matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)].map((match) => match.slice(1)))
  const [light, dark, system] = [...css.matchAll(/:root[^{]*\{([^}]+)\}/g)].slice(0, 3).map((match) => palette(match[1]))
  assert.deepEqual(dark, system)
  function luminance(hex) {
    return hex.slice(1).match(/../g).map((digit, i) => {
      const value = parseInt(digit, 16) / 255
      return (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
    }).reduce((a, b) => a + b, 0)
  }
  for (const colors of [light, dark]) {
    for (const [fg, bg, min] of [
      ['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['ink', 'raised', 4.5], ['muted', 'surface', 4.5],
      ['muted', 'soft', 4.5], ['muted', 'bg', 4.5], ['muted', 'raised', 4.5], ['accent', 'tint', 4.5],
      ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['good', 'surface', 4.5], ['danger', 'surface', 4.5],
      ['on-button', 'button', 4.5], ['on-button', 'button-hover', 4.5], ['control', 'surface', 3],
      ['control', 'raised', 3], ['ring', 'surface', 3], ['ring', 'bg', 3],
    ]) {
      const values = [luminance(colors[fg]), luminance(colors[bg])]
      const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
      assert.ok(ratio >= min, `${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`)
    }
  }
})
