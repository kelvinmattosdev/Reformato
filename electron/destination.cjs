const { stat } = require('node:fs/promises')
const { homedir } = require('node:os')
const path = require('node:path')

async function resolveDestination(value) {
  if (typeof value !== 'string' || value.includes('\0')) return { error: 'Digite um caminho de pasta válido.' }
  let folder = value.trimStart()
  if (folder === '~') folder = homedir()
  else if (folder.startsWith('~/') || (process.platform === 'win32' && folder.startsWith('~\\'))) {
    folder = path.join(homedir(), folder.slice(2))
  }
  if (!path.isAbsolute(folder)) return { error: 'Digite o caminho completo ou selecione uma pasta.' }
  folder = path.resolve(folder)
  try {
    if (!(await stat(folder)).isDirectory()) return { error: 'O caminho informado não é uma pasta.' }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { error: 'A pasta informada não existe.' }
    return { error: 'Não foi possível acessar a pasta informada.' }
  }
  return { path: folder }
}

module.exports = { resolveDestination }
