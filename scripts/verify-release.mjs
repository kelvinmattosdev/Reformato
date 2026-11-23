import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
assert.ok(process.argv.length > 2, 'Informe os arquivos latest*.yml a verificar.')

for (const manifest of process.argv.slice(2)) {
  const contents = await readFile(manifest, 'utf8')
  const fields = (name, pattern = '\\S+') => contents.match(new RegExp(`^${name}: (${pattern})$`, 'm'))?.[1]
  assert.equal(fields('version'), version, manifest)
  const name = fields('path', '[A-Za-z0-9._-]+')
  assert.ok(name?.includes(version), `Nome inválido em ${manifest}.`)
  const file = path.join(path.dirname(manifest), name)
  const digest = createHash('sha512')
  for await (const chunk of createReadStream(file)) digest.update(chunk)
  assert.equal(digest.digest('base64'), fields('sha512'), `SHA-512 divergente: ${name}.`)
  const size = contents.match(/^\s+size: (\d+)$/m)?.[1]
  assert.equal((await stat(file)).size, Number(size), `Tamanho divergente: ${name}.`)
  console.log(`${name}: versão, SHA-512 e tamanho verificados.`)
}
