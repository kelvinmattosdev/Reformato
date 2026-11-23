const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { mkdtemp, mkdir, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const ffmpeg = require('ffmpeg-static')
const { convertFile } = require('../electron/conversion.cjs')
const { videoInfo, createProgressParser } = require('../electron/video-progress.cjs')

const run = promisify(execFile)

async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'reformato-video-performance-'))
  t.after(() => rm(folder, { recursive: true, force: true, maxRetries: 4 }))
  const destination = path.join(folder, 'saida')
  await mkdir(destination)
  return { folder, destination }
}

async function mov(file, { size = '160x120', codec = 'libx264', extra = [], audio = 'aac' } = {}) {
  await run(ffmpeg, ['-v', 'error', '-filter_threads', '2', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25:duration=0.48`,
    '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=0.48', '-c:v', codec, '-threads', '2', ...extra, '-c:a', audio, file])
}

async function fingerprints(file, stream) {
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', file, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'framehash', '-'])
  return stdout.split(/\r?\n/).filter((line) => /^\d+,/.test(line)).map((line) => line.split(',').at(-1).trim())
}

async function inspect(file) {
  const { stderr } = await run(ffmpeg, ['-hide_banner', '-i', file, '-c', 'copy', '-t', '0', '-f', 'null', '-'])
  return stderr.split('Stream mapping:')[0]
}

test('MP4 automático preserva a orientação armazenada no MOV', async (t) => {
  const { folder, destination } = await fixture(t)
  const input = path.join(folder, 'camera.mov')
  const rotated = path.join(folder, 'vertical.mov')
  await mov(input)
  await run(ffmpeg, ['-v', 'error', '-display_rotation:v:0', '90', '-i', input, '-map', '0', '-c', 'copy', rotated])
  const output = path.join(destination, await convertFile(rotated, 'mp4', destination, ffmpeg))
  const rotation = (text) => /rotation of (-?[\d.]+) degrees/.exec(text)?.[1]
  const intended = rotation(await inspect(rotated))
  assert.equal(Math.abs(Number(intended)), 90)
  assert.equal(rotation(await inspect(output)), intended)
  assert.deepEqual(await fingerprints(output, 'v'), await fingerprints(rotated, 'v'))
})

test('MP4 automático reaproveita as faixas MOV compatíveis sem alteração dos pacotes', async (t) => {
  const { folder, destination } = await fixture(t)
  const original = path.join(folder, 'gravacao.mov')
  await mov(original)
  const events = []
  const output = path.join(destination, await convertFile(original, 'mp4', destination, ffmpeg, {
    onProgress: (event) => events.push(event),
  }))
  assert.ok(events.some((event) => event.phase === 'copy'))
  assert.ok(events.some((event) => event.phase === 'finalizing' && event.elapsed > 0 && event.percent >= 90))
  for (const stream of ['v', 'a']) {
    const source = await fingerprints(original, stream)
    assert.ok(source.length > 0)
    assert.deepEqual(await fingerprints(output, stream), source)
  }
})

test('MP4 automático mantém HEVC e recodifica só o áudio PCM; modo compatível usa H.264', async (t) => {
  const { folder, destination } = await fixture(t)
  const input = path.join(folder, 'hevc.mov')
  await mov(input, { codec: 'libx265', audio: 'pcm_s16le', extra: ['-x265-params', 'pools=1:frame-threads=1:log-level=error', '-tag:v', 'hvc1'] })
  const events = []
  const output = path.join(destination, await convertFile(input, 'mp4', destination, ffmpeg, {
    onProgress: (event) => events.push(event),
  }))
  assert.ok(events.some(({ phase }) => phase === 'copyVideo'))
  assert.deepEqual(await fingerprints(output, 'v'), await fingerprints(input, 'v'))
  const info = videoInfo(await inspect(output))
  assert.equal(info.video, 'hevc')
  assert.equal(info.videoTag, 'hvc1')
  assert.equal(info.audio, 'aac')
  const compatible = path.join(destination, await convertFile(input, 'mp4', destination, ffmpeg, { videoProfile: 'compatible' }))
  assert.equal(videoInfo(await inspect(compatible)).video, 'h264')
})

test('MP4 automático recodifica vídeo não elegível e modo leve reduz sem distorcer nem ampliar', async (t) => {
  const { folder, destination } = await fixture(t)
  for (const [size, expected] of [['1440x810', '1280x720'], ['900x1600', '720x1280'], ['160x120', '160x120']]) {
    const input = path.join(folder, `${size}.mov`)
    await mov(input, { size, codec: 'mpeg4' })
    const events = []
    const light = path.join(destination, await convertFile(input, 'mp4', destination, ffmpeg, {
      videoProfile: 'light', onProgress: (event) => events.push(event),
    }))
    assert.ok(events.some(({ phase }) => phase === 'encode'))
    const description = await inspect(light)
    assert.equal(videoInfo(description).video, 'h264')
    assert.match(description, new RegExp(`\\b${expected}\\b`))
    if (size === '160x120') {
      const events = []
      await convertFile(input, 'mp4', destination, ffmpeg, { onProgress: (event) => events.push(event) })
      assert.ok(events.some(({ phase }) => phase === 'encode'))
    }
  }
})

test('progresso aceita fragmentos e preserva 100% para depois de salvar', () => {
  const events = []
  const feed = createProgressParser(120, 'copy', (event) => events.push(event))
  feed('out_time_us=60000000\r\nspeed=2.5x\r\npro')
  feed('gress=continue\r\nout_time_us=121000000\nprogress=end\n')
  assert.equal(events[0].percent, 50)
  assert.equal(events[0].speed, 2.5)
  assert.equal(events[1].phase, 'finalizing')
  assert.equal(events[1].percent, 99)
})
