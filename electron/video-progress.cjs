function timestampSeconds(timestamp) {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(timestamp ?? '')
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

function videoInfo(diagnostic) {
  const input = diagnostic.split('Stream mapping:')[0]
  const duration = timestampSeconds(/^\s*Duration: ([\d:.]+),/m.exec(input)?.[1])
  const streams = [...input.matchAll(/^\s*Stream #0:\d+(?:\[[^\]]+\])?(?:\([^)]+\))?: (Video|Audio): ([\w-]+)([^\r\n]*)/gm)]
  const video = streams.find((stream) => stream[1] === 'Video' && !/\(attached pic\)|\(timed thumbnails\)/i.test(stream[3]))
  return {
    duration,
    video: video?.[2],
    videoTag: /\b(hvc1|hev1)\s*\//.exec(video?.[3] ?? '')?.[1],
    audio: streams.find((stream) => stream[1] === 'Audio')?.[2],
  }
}

function createProgressParser(duration, mode, callback) {
  let pending = ''
  let fields = {}
  return (chunk) => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      const [name, value] = line.split('=')
      if (name !== 'progress') {
        if (['out_time_us', 'out_time', 'speed'].includes(name)) fields[name] = value
        continue
      }
      const elapsed = fields.out_time_us && Number.isFinite(Number(fields.out_time_us))
        ? Math.max(0, Number(fields.out_time_us) / 1_000_000)
        : timestampSeconds(fields.out_time)
      const parsedSpeed = Number.parseFloat(fields.speed)
      const finished = value === 'end'
      callback({
        mode, phase: finished ? 'finalizing' : mode,
        elapsed: elapsed ?? undefined, total: duration || undefined,
        percent: duration > 0 && finished ? 99
          : duration > 0 && elapsed !== null ? Math.min(99, Math.floor((elapsed / duration) * 100)) : undefined,
        speed: parsedSpeed > 0 && Number.isFinite(parsedSpeed) ? parsedSpeed : undefined,
      })
      fields = {}
    }
  }
}

module.exports = { videoInfo, createProgressParser }
