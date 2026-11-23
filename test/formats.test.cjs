const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdir, mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const ffmpeg = require('ffmpeg-static')
const sharp = require('sharp')
const { convertFile, formatsFor, sourceFormat, supported } = require('../electron/conversion.cjs')

const run = promisify(execFile)
const imageTypes = { png: 'png', jpg: 'jpeg', webp: 'webp', avif: 'heif', bmp: 'bmp', tiff: 'tiff', gif: 'gif' }
const imageExtensions = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tiff', 'tif', 'gif']
const audioTypes = {
  wav: { input: 'pcm_s24le', output: 'pcm_s16le', demuxer: 'wav' },
  mp3: { input: 'libmp3lame', output: 'mp3', demuxer: 'mp3' },
  flac: { input: 'flac', output: 'flac', demuxer: 'flac' },
  ogg: { input: 'libopus', output: 'vorbis', demuxer: 'ogg' },
  m4a: { input: 'aac', output: 'aac', demuxer: 'mov,mp4,m4a,3gp,3g2,mj2', brand: 'M4A ' },
}
const videoTypes = {
  mp4: { input: ['mpeg4', 'aac'], output: ['h264', 'aac'], demuxer: 'mov,mp4,m4a,3gp,3g2,mj2', brand: 'isom' },
  webm: { input: ['libvpx', 'libopus'], output: ['vp9', 'opus'], demuxer: 'matroska,webm', docType: 'webm' },
  mov: { input: ['mpeg4', 'pcm_s16le'], output: ['h264', 'aac'], demuxer: 'mov,mp4,m4a,3gp,3g2,mj2', brand: 'qt  ' },
  mkv: { input: ['mpeg4', 'flac'], output: ['h264', 'aac'], demuxer: 'matroska,webm', docType: 'matroska' },
}
const fixtures = [
  ...imageExtensions, ...Object.keys(audioTypes), ...Object.keys(videoTypes),
]

function canonical(format) {
  return { jpeg: 'jpg', tif: 'tiff' }[format] ?? format
}

function expectedTargets(source) {
  if (source === 'webp') return ['png', 'jpg']
  if (source in imageTypes) return imageExtensions
    .filter((target) => canonical(target) !== source && (target !== 'webp' || ['png', 'jpg'].includes(source)))
  if (source in audioTypes) return [...Object.keys(audioTypes).filter((target) => target !== source), 'mp4']
  return [...Object.keys(videoTypes).filter((target) => target !== source), ...Object.keys(audioTypes)]
}

async function generateInput(file, source) {
  if (source === 'bmp') {
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=32x24:rate=1',
      '-frames:v', '1', '-c:v', 'bmp', '-threads', '2', '-pix_fmt', 'bgr24', '-update', '1', file])
    return
  }
  if (source in imageTypes) {
    const image = sharp({ create: { width: 32, height: 24, channels: 3, background: '#89334c' } })
    if (source === 'avif') await image.avif().toFile(file)
    else await image.toFormat(imageTypes[source]).toFile(file)
    return
  }
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.3']
  if (source in audioTypes) args.push('-c:a', audioTypes[source].input)
  else args.push('-f', 'lavfi', '-i', 'testsrc2=size=48x32:rate=12:duration=0.3',
    '-map', '1:v:0', '-map', '0:a:0', '-c:v', videoTypes[source].input[0], '-c:a', videoTypes[source].input[1])
  await run(ffmpeg, [...args, '-threads', '2', file])
}

async function verifyOutput(file, source, target) {
  const targetFormat = canonical(target)
  if (targetFormat === 'bmp') {
    const bmp = await readFile(file)
    assert.equal(bmp.subarray(0, 2).toString(), 'BM')
    assert.equal(bmp.readInt32LE(18), 32)
    assert.equal(bmp.readInt32LE(22), 24)
    const { stdout } = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-xerror', '-i', file,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-threads', '2', '-'], { encoding: 'buffer' })
    assert.equal(stdout.length, 32 * 24 * 3)
    return
  }
  if (targetFormat in imageTypes) {
    const image = sharp(file)
    const { format, width, height, compression } = await image.metadata()
    assert.deepEqual({ format, width, height }, { format: imageTypes[targetFormat], width: 32, height: 24 })
    if (targetFormat === 'avif') assert.equal(compression, 'av1')
    assert.equal((await image.toColourspace('srgb').removeAlpha().raw().toBuffer()).length, 32 * 24 * 3)
    return
  }

  // Decodes every stored stream and fails if recoverable codec errors are encountered.
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-xerror', '-i', file, '-map', '0', '-f', 'null', '-'])
  const input = stderr.split('Stream mapping:')[0]
  const expected = audioTypes[target] ?? videoTypes[target]
  assert.ok(input.includes(`Input #0, ${expected.demuxer}, from`), input)
  const video = [...input.matchAll(/Stream #0:[^\r\n]*Video: ([\w]+)/g)].map((match) => match[1])
  const audio = [...input.matchAll(/Stream #0:[^\r\n]*Audio: ([\w]+)/g)].map((match) => match[1])

  if (target in audioTypes) {
    assert.deepEqual(video, [])
    assert.deepEqual(audio, [expected.output])
  } else if (source in audioTypes) {
    assert.equal(target, 'mp4')
    assert.deepEqual(video, [])
    assert.deepEqual(audio, ['aac'])
  } else {
    assert.deepEqual(video, [expected.output[0]])
    assert.deepEqual(audio, [expected.output[1]])
  }

  if (expected.brand || expected.docType) {
    const header = (await readFile(file)).subarray(0, 128)
    if (expected.brand) {
      assert.equal(header.subarray(4, 8).toString(), 'ftyp')
      assert.equal(header.subarray(8, 12).toString(), expected.brand)
    } else {
      assert.equal(header.subarray(0, 4).toString('hex'), '1a45dfa3')
      assert.ok(header.includes(expected.docType), `EBML header did not contain ${expected.docType}`)
    }
  }
}

test('image and original media combinations produce decodable media', async (t) => {
  for (const extension of fixtures) assert.ok(supported.includes(extension), extension)
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-matrix-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 4 }))
  const destination = path.join(folder, 'outputs')
  await mkdir(destination)
  let total = 0

  for (const ext of fixtures) {
    const file = path.join(folder, `from-${ext}.${ext}`)
    const source = sourceFormat(file)
    const targets = expectedTargets(source)
    const advertised = formatsFor(source)
    if (source in imageTypes) assert.deepEqual([...advertised].sort(), [...targets].sort())
    else for (const target of targets) assert.ok(advertised.includes(target), `${source} → ${target}`)
    await generateInput(file, source)
    for (const target of targets) {
      await t.test(`${ext.toUpperCase()} → ${target.toUpperCase()}`, async () => {
        const result = await convertFile(file, target, destination)
        assert.equal(result, `from-${ext}.${target}`)
        await verifyOutput(path.join(destination, result), source, target)
      })
      total++
    }
  }
  assert.equal(total, 114)
})
