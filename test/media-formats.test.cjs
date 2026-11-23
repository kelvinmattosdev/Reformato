const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdir, mkdtemp, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const ffmpeg = require('ffmpeg-static')
const media = require('../shared/media-formats.json')
const { convertFile, formatsFor, sourceFormat, supported } = require('../electron/conversion.cjs')

const run = promisify(execFile)
const allExtensions = (group) => Object.entries(group)
  .flatMap(([name, entry]) => [name, ...(entry.aliases ?? [])])
const audioExtensions = allExtensions(media.audio)
const videoExtensions = allExtensions(media.video)
const audioDecoder = {
  libmp3lame: 'mp3', libvorbis: 'vorbis', libopencore_amrnb: 'amr_nb', dca: 'dts',
  libopus: 'opus', libspeex: 'speex', wavpack: 'wavpack',
}
const videoCodecs = {
  avc: ['h264', 'aac'], vp9: ['vp9', 'opus'], avi: ['mpeg4', 'mp3'], wmv: ['wmv2', 'wmav2'],
  mpeg1: ['mpeg1video', 'mp2'], mpeg2: ['mpeg2video', 'ac3'], mxf: ['mpeg2video', 'pcm_s16le'],
  dv: ['dvvideo', 'pcm_s16le'], theora: ['theora', 'vorbis'], hevc: ['hevc'], av1: ['av1'],
  raw: ['rawvideo'], mjpeg: ['mjpeg'],
}
const equivalentDemuxers = {
  dts: 'dts', ac3: 'ac3', eac3: 'eac3', m4v: 'mov', mov: 'mov', matroska: 'matroska',
  mpegvideo: 'mpegvideo', aac: 'aac', mp2: 'mp3',
}

async function decode(file, forceDemuxer) {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-xerror', '-threads', '2',
    ...(forceDemuxer ? ['-f', forceDemuxer] : []),
    '-i', file, '-map', '0:v:0?', '-map', '0:a:0?', '-f', 'null', '-'])
  const input = stderr.split('Stream mapping:')[0]
  const codecs = (type) => [...input.matchAll(new RegExp(`Stream #0:[^\\r\\n]*${type}: ([\\w]+)`, 'g'))].map((match) => match[1])
  return { audio: codecs('Audio'), video: codecs('Video'), input }
}

function verifyContainer(input, extension, entry) {
  const demuxer = equivalentDemuxers[extension] ??
    (Array.isArray(entry.input) ? entry.input[0] : entry.input)
  assert.match(input, new RegExp(`Input #0, ${demuxer}(?:,| )`), input)
}

async function generateReference(folder) {
  const sound = path.join(folder, 'sample.wav')
  const clip = path.join(folder, 'clip.mp4')
  await run(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=0.65',
    '-c:a', 'pcm_s24le', sound])
  await run(ffmpeg, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=25:duration=0.65',
    '-i', sound, '-c:v', 'libx264', '-threads', '2', '-c:a', 'aac', clip])
  return { sound, clip }
}

test('all audio extensions can be written, decoded, reimported and extracted from a video', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-audio-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const { sound, clip } = await generateReference(folder)
  for (const extension of audioExtensions) {
    await t.test(extension.toUpperCase(), async () => {
      const source = sourceFormat(`file.${extension}`)
      const entry = media.audio[source]
      assert.ok(supported.includes(extension))
      assert.ok(formatsFor('mp4').includes(extension))
      assert.ok(formatsFor('wav').includes(extension) || extension === 'wav')
      assert.ok(!formatsFor(source).includes(extension))
      const expectedAudio = entry.mux === 'latm' ? 'aac_latm' : audioDecoder[entry.codec] ?? entry.codec
      for (const reference of extension === 'wav' ? [clip] : [sound, clip]) {
        const output = path.join(folder, await convertFile(reference, extension, folder))
        const { audio, video, input } = await decode(output)
        assert.deepEqual(video, [])
        assert.deepEqual(audio, [expectedAudio])
        verifyContainer(input, extension, entry)
        const reimport = path.join(folder, await convertFile(output, extension === 'wav' ? 'flac' : 'wav', folder))
        assert.ok((await stat(reimport)).size > 0)
      }
    })
  }
})

test('all video extensions can be written, decoded and reimported', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-video-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const { clip } = await generateReference(folder)
  const reference = path.join(folder, await convertFile(clip, 'mov', folder))
  for (const extension of videoExtensions) {
    await t.test(extension.toUpperCase(), async () => {
      const source = sourceFormat(`file.${extension}`)
      const entry = media.video[source]
      assert.ok(supported.includes(extension))
      assert.equal(formatsFor(source).includes('mp3'), !entry.silent)
      assert.ok(!formatsFor(source).includes(extension))
      const inputFile = source === 'mp4' ? reference : clip
      const output = path.join(folder, await convertFile(inputFile, extension, folder))
      const { audio, video, input } = await decode(output, entry.preset === 'mjpeg' ? entry.input : undefined)
      const [expectedVideo, expectedAudio] = videoCodecs[entry.preset]
      assert.deepEqual(video, [expectedVideo])
      assert.deepEqual(audio, entry.silent ? [] : [expectedAudio])
      verifyContainer(input, extension, entry)
      const reimport = path.join(folder, await convertFile(output, source === 'mp4' ? 'mov' : 'mp4', folder))
      assert.ok((await stat(reimport)).size > 0)
    })
  }
})

test('handles raw M4V and normalizes audio layout and timing for AAC and DV', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-media-regression-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const { sound, clip } = await generateReference(folder)
  for (const extension of ['sbc', 'spx', 'tta']) {
    await t.test(`${extension} → AAC`, async () => {
      const input = path.join(folder, await convertFile(sound, extension, folder))
      const output = path.join(folder, await convertFile(input, 'aac', folder))
      assert.deepEqual((await decode(output)).audio, ['aac'])
    })
  }
  for (const extension of ['webm', 'ogv', 'wmv']) {
    const input = path.join(folder, await convertFile(clip, extension, folder))
    const output = path.join(folder, await convertFile(input, 'dv', folder))
    const { audio, video } = await decode(output)
    assert.deepEqual(video, ['dvvideo'])
    assert.deepEqual(audio, ['pcm_s16le'])
  }
  const raw = path.join(folder, 'raw.m4v')
  await run(ffmpeg, ['-loglevel', 'error', '-i', clip, '-an', '-c:v', 'mpeg4', '-f', 'm4v', raw])
  const output = path.join(folder, await convertFile(raw, 'mp4', folder))
  assert.deepEqual((await decode(output)).video, ['h264'])
})

test('a silent video can be converted to other video formats without inventing audio', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-silent-video-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const { clip } = await generateReference(folder)
  const silent = path.join(folder, 'silent.mov')
  await run(ffmpeg, ['-loglevel', 'error', '-i', clip, '-c:v', 'copy', '-an', silent])
  for (const extension of videoExtensions.filter((format) => format !== 'mov')) {
    const output = path.join(folder, await convertFile(silent, extension, folder))
    const { video, audio } = await decode(output, sourceFormat(output) === 'mjpeg' ? 'mjpeg' : undefined)
    assert.equal(video.length, 1, extension)
    assert.deepEqual(audio, [], extension)
  }
})

test('complete media conversion matrix', { skip: !process.env.REFORMATO_FULL_MATRIX, concurrency: 2 }, async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-all-media-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const { sound, clip } = await generateReference(folder)
  const sources = []
  for (const [reference, extensions] of [[sound, audioExtensions], [clip, videoExtensions]]) {
    const dir = path.join(folder, path.basename(reference, path.extname(reference)))
    await mkdir(dir)
    for (const extension of extensions) {
      const canonical = sourceFormat(`media.${extension}`)
      const file = extension === path.extname(reference).slice(1)
        ? reference : path.join(dir, await convertFile(reference, extension, dir))
      sources.push({ extension, canonical, file })
    }
  }

  await Promise.all(sources.map(({ extension, canonical, file }) =>
    t.test(extension.toUpperCase(), async () => {
      const destination = path.join(folder, `matrix-${extension}`)
      await mkdir(destination)
      const targets = formatsFor(canonical)
      const errors = []
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async (_, slot) => {
        for (let index = slot; index < targets.length; index += 3) {
          const target = targets[index]
          try {
            const output = path.join(destination, await convertFile(file, target, destination))
            assert.ok((await stat(output)).size > 0)
          } catch (error) {
            errors.push(`${extension} → ${target}: ${error.message}`)
          }
        }
      }))
      assert.deepEqual(errors, [])
    })))
  t.diagnostic(`${sources.reduce((sum, { canonical }) => sum + formatsFor(canonical).length, 0)} combinations`)
})
