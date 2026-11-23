const { copyFile, link, mkdtemp, rm } = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { constants: osConstants, setPriority } = require('node:os')
const sharp = require('sharp')
const media = require('../shared/media-formats.json')
const { videoInfo, createProgressParser } = require('./video-progress.cjs')

if (process.platform === 'win32') sharp.cache({ files: 0 })

const images = ['png', 'jpg', 'webp', 'avif', 'bmp', 'tiff', 'gif']
const imageOutputs = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'gif']
const extensions = (group) => Object.entries(group).flatMap(([name, entry]) => [name, ...(entry.aliases ?? [])])
const audio = extensions(media.audio)
const video = extensions(media.video)
const aliases = new Map([
  ['jpeg', 'jpg'], ['tif', 'tiff'],
  ...Object.entries({ ...media.audio, ...media.video })
    .flatMap(([name, entry]) => (entry.aliases ?? []).map((alias) => [alias, name])),
])
const imageDecoders = { png: 'png', jpg: 'jpeg', webp: 'webp', avif: 'heif', bmp: 'png', tiff: 'tiff', gif: 'gif' }
const imagePixelLimit = 80_000_000
const audioOptions = (entry) => ['-c:a', entry.codec, ...(entry.args ?? []),
  ...(entry.codec === 'aac' ? ['-af', 'aformat=sample_fmts=s32:channel_layouts=mono|stereo|5.1|7.1'] : [])]
const aac = audioOptions(media.audio.m4a)
const videoPresets = {
  avc: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', ...aac],
  vp9: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-ar', '48000'],
  avi: ['-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', ...audioOptions(media.audio.mp3)],
  wmv: ['-c:v', 'wmv2', '-q:v', '4', '-pix_fmt', 'yuv420p', ...audioOptions(media.audio.wma)],
  mpeg1: ['-c:v', 'mpeg1video', '-q:v', '4', '-r', '25', '-pix_fmt', 'yuv420p', ...audioOptions(media.audio.mp2)],
  mpeg2: ['-c:v', 'mpeg2video', '-q:v', '4', '-r', '25', '-pix_fmt', 'yuv420p', ...audioOptions(media.audio.ac3)],
  mxf: ['-c:v', 'mpeg2video', '-q:v', '4', '-r', '25', '-pix_fmt', 'yuv422p', '-c:a', 'pcm_s16le', '-ar', '48000'],
  dv: ['-c:v', 'dvvideo', '-r', '25', '-pix_fmt', 'yuv420p', '-chroma_sample_location', 'topleft',
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-af', 'aresample=48000:async=1:first_pts=0,apad=pad_dur=1', '-shortest'],
  mjpeg: ['-c:v', 'mjpeg', '-q:v', '4', '-pix_fmt', 'yuvj420p'],
  theora: ['-c:v', 'libtheora', '-q:v', '7', '-pix_fmt', 'yuv420p', ...audioOptions(media.audio.ogg)],
  hevc: ['-c:v', 'libx265', '-preset', 'fast', '-crf', '26', '-pix_fmt', 'yuv420p', '-x265-params', 'pools=1:frame-threads=1:log-level=error'],
  av1: ['-c:v', 'libaom-av1', '-cpu-used', '6', '-b:v', '0', '-crf', '32', '-pix_fmt', 'yuv420p'],
  raw: ['-c:v', 'wrapped_avframe', '-pix_fmt', 'yuv420p'],
}

function canonical(format) {
  return aliases.get(format) ?? format
}

function sourceFormat(file) {
  return canonical(path.extname(file).slice(1).toLowerCase())
}

function formatsFor(source) {
  if (source === 'webp') return ['png', 'jpg']
  if (images.includes(source)) {
    return imageOutputs.filter((format) => canonical(format) !== source &&
      (format !== 'webp' || ['png', 'jpg'].includes(source)))
  }
  if (Object.hasOwn(media.audio, source)) return [...audio, 'mp4'].filter((format) => canonical(format) !== source)
  if (Object.hasOwn(media.video, source)) {
    return [...video, ...(media.video[source].silent ? [] : audio)].filter((format) => canonical(format) !== source)
  }
  return []
}

function ffmpegPath() {
  const binary = require('ffmpeg-static')
  if (!binary) throw new Error('O conversor de mídia não está disponível nesta plataforma.')
  return binary.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
}

function needsFfmpeg(source, target) {
  return !images.includes(source) || source === 'bmp' || target === 'bmp'
}

const videoProfiles = ['automatic', 'compatible', 'light']
const padEven = 'pad=ceil(iw/2)*2:ceil(ih/2)*2'
const scaleLight = "scale=w='min(iw,if(gte(iw,ih),1280,720))':h='min(ih,if(gte(iw,ih),720,1280))':force_original_aspect_ratio=decrease:force_divisible_by=2"

function runFfmpeg(args, failure, executable, { inspect, progress, threads = 2 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable ?? ffmpegPath(), [
      '-hide_banner', '-loglevel', inspect ? 'info' : 'error', '-nostdin', '-n', '-protocol_whitelist', 'file',
      '-threads', String(threads), '-filter_threads', String(threads),
      ...(progress ? ['-progress', 'pipe:1', '-stats_period', '1', '-nostats'] : []), ...args,
    ], { stdio: ['ignore', progress ? 'pipe' : 'ignore', 'pipe'], windowsHide: true })
    if (child.pid) {
      try { setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL) } catch {}
    }
    if (progress) child.stdout.setEncoding('utf8').on('data', progress)
    let diagnostic = ''
    child.stderr.on('data', (chunk) => {
      diagnostic = inspect ? (diagnostic + chunk).slice(0, 64 * 1024) : (diagnostic + chunk).slice(-4096)
    })
    child.once('error', () => reject(new Error('Não foi possível iniciar o conversor.')))
    child.once('close', (code, signal) => {
      if (code === 0) return resolve(diagnostic)
      reject(new Error(failure(diagnostic), { cause: new Error(diagnostic || (signal ?? `FFmpeg status ${code}`)) }))
    })
  })
}

const mediaFailure = (diagnostic) => /matches no streams/i.test(diagnostic)
  ? 'O arquivo não tem a faixa necessária para essa saída.'
  : 'Não foi possível ler a mídia ou codificar no formato escolhido.'

async function encodeMedia(input, source, target, output, executable, { videoProfile = 'automatic', onProgress } = {}) {
  const outputName = canonical(target)
  const sourceAudio = Object.hasOwn(media.audio, source)
  const targetAudio = Object.hasOwn(media.audio, outputName)
  const origin = sourceAudio ? media.audio[source] : media.video[source]
  const destination = targetAudio ? media.audio[outputName] : media.video[outputName]
  const audioOnly = sourceAudio || targetAudio
  const silentOutput = !audioOnly && (origin.silent || destination.silent)
  const mappings = audioOnly ? ['-map', '0:a:0', '-vn'] : ['-map', '0:V:0', ...(silentOutput ? ['-an'] : ['-map', '0:a:0?'])]
  const inputOptions = typeof origin.input === 'string'
    ? ['-f', origin.input] : ['-format_whitelist', origin.input.join(',')]
  if (origin.decoder) inputOptions.push('-c:a', origin.decoder)
  const mp4Video = outputName === 'mp4' && !audioOnly
  const mayCopy = mp4Video && videoProfile === 'automatic' && ['mov', 'm4v', 'mkv'].includes(source)
  const light = mp4Video && videoProfile === 'light'
  let info
  if (mayCopy || (!audioOnly && onProgress)) {
    onProgress?.({ phase: 'analyzing' })
    const diagnostic = await runFfmpeg([
      ...inputOptions, '-i', input, ...mappings, '-c', 'copy', '-t', '0', '-f', 'null', '-',
    ], mediaFailure, executable, { inspect: true, threads: 1 }).catch(() => null)
    if (diagnostic) info = videoInfo(diagnostic)
  }

  const run = (options, mode) => {
    const threads = light ? 1 : 2
    const progress = !audioOnly && onProgress ? createProgressParser(info?.duration, mode, onProgress) : undefined
    if (progress) onProgress({ mode, phase: mode, total: info?.duration || undefined })
    return runFfmpeg([
      ...inputOptions, '-i', input, ...mappings, ...options, '-map_metadata', '-1',
      '-map_chapters', '-1', '-threads', String(threads), '-f', destination.mux, output,
    ], mediaFailure, executable, { progress, threads })
  }

  if (mayCopy && ['h264', 'hevc'].includes(info?.video)) {
    const copyAudio = !info.audio || ['aac', 'mp3'].includes(info.audio)
    try {
      // Não mover o índice para o início evita uma segunda leitura/escrita no MP4 local.
      return await run(['-c:v', 'copy', ...(info.videoTag === 'hvc1' ? ['-tag:v', 'hvc1'] : []),
        ...(copyAudio ? ['-c:a', 'copy'] : aac)], copyAudio ? 'copy' : 'copyVideo')
    } catch (error) {
      if (/no space left|permission denied|read-only file system|input\/output error/i.test(error.cause?.message ?? '')) throw error
      await rm(output, { force: true, maxRetries: 3 })
    }
  }

  if (audioOnly) return run(targetAudio ? audioOptions(destination) : [...aac, ...(destination.args ?? [])], 'encode')
  const preset = light ? ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p', ...aac] : videoPresets[destination.preset]
  return run(['-vf', light ? `${padEven},${scaleLight}` : destination.filter ?? padEven, ...preset, ...(destination.args ?? [])], 'encode')
}

function transcodeBitmap(input, inputCodec, output, outputCodec, executable, outputOptions = []) {
  return runFfmpeg([
    '-f', 'image2', '-pattern_type', 'none', '-c:v', inputCodec, '-max_pixels', String(imagePixelLimit), '-i', input,
    '-map', '0:v:0', '-frames:v', '1', '-map_metadata', '-1', '-c:v', outputCodec, ...outputOptions,
    '-threads', '2', '-f', 'image2', '-update', '1', output,
  ], () => 'Não foi possível processar a imagem BMP.', executable)
}

async function encodeImage(input, source, target, output, executable) {
  let imageInput = input
  if (source === 'bmp') {
    imageInput = path.join(path.dirname(output), 'entrada-bmp.png')
    await transcodeBitmap(input, 'bmp', imageInput, 'png', executable)
  }
  const image = sharp(imageInput, { limitInputPixels: imagePixelLimit, failOn: 'error' })
  const metadata = await image.metadata()
  if (metadata.format !== imageDecoders[source] || (source === 'avif' && metadata.compression !== 'av1')) {
    throw new Error('O conteúdo da imagem não corresponde à extensão.')
  }
  if (metadata.pages > 1) throw new Error('Imagens animadas ou com várias páginas ainda não são compatíveis.')
  const oriented = image.autoOrient()
  switch (canonical(target)) {
    case 'jpg': return oriented.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toFile(output)
    case 'png': return oriented.png().toFile(output)
    case 'webp': return oriented.webp({ quality: 90 }).toFile(output)
    case 'avif': return oriented.avif({ quality: 55 }).toFile(output)
    case 'tiff': return oriented.tiff({ compression: 'deflate' }).toFile(output)
    case 'gif': return oriented.gif().toFile(output)
    case 'bmp': {
      const intermediate = path.join(path.dirname(output), 'saida-bmp.png')
      await oriented.flatten({ background: '#ffffff' }).png().toFile(intermediate)
      return transcodeBitmap(intermediate, 'png', output, 'bmp', executable, ['-pix_fmt', 'bgr24'])
    }
  }
}

async function saveWithoutOverwrite(temp, destination, stem, target) {
  for (let count = 0; count < 10000; count++) {
    const name = `${stem}${count ? ` (${count})` : ''}.${target}`
    const output = path.join(destination, name)
    try {
      try {
        await link(temp, output)
      } catch (error) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS', 'EXDEV'].includes(error.code)) throw error
        await copyFile(temp, output, constants.COPYFILE_EXCL)
      }
      return name
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  throw new Error('Não há um nome livre para salvar a conversão.')
}

async function convertFile(input, target, destination, executable, options) {
  const source = sourceFormat(input)
  if (!formatsFor(source).includes(target)) throw new Error('Conversão não disponível para este arquivo.')
  const temporary = await mkdtemp(path.join(destination, '.reformato-'))
  const output = path.join(temporary, `saida.${target}`)
  try {
    if (images.includes(source)) await encodeImage(input, source, target, output, executable)
    else if (process.platform === 'win32' && source === 'tta' &&
      (target === 'mp4' || media.audio[canonical(target)]?.codec === 'aac')) {
      // FFmpeg 6 no Windows não aceita a mudança de layout de alguns fluxos TTA no filtro AAC.
      const pcm = path.join(temporary, 'entrada.wav')
      await runFfmpeg(['-f', 'tta', '-i', input, '-map', '0:a:0', '-c:a', 'pcm_s32le',
        '-map_metadata', '-1', '-f', 'wav', pcm], () => 'Não foi possível ler a mídia.', executable)
      await encodeMedia(pcm, 'wav', target, output, executable, options)
    } else await encodeMedia(input, source, target, output, executable, options)
    return await saveWithoutOverwrite(output, destination, path.parse(input).name, target)
  } finally {
    await rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}

module.exports = { convertFile, formatsFor, sourceFormat, needsFfmpeg, videoProfiles, supported: [...imageOutputs, ...audio, ...video] }
