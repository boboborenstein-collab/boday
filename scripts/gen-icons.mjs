// Dependency-free PNG icon generator for the Cadence PWA.
// Draws a "focus ring" mark on the brand indigo. Placeholder art — swap freely.
import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dirname, '..', 'public')
mkdirSync(PUBLIC, { recursive: true })

function crc32(buf) {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const lerp = (a, b, t) => a + (b - a) * t
// Soft 1.5px edge so the ring isn't jagged.
function edge(value, threshold, rising) {
  const aa = 1.5
  const d = rising ? value - threshold : threshold - value
  return Math.max(0, Math.min(1, d / aa + 0.5))
}

function drawIcon(N) {
  const rgba = Buffer.alloc(N * N * 4)
  const cx = N / 2
  const cy = N / 2
  const outerR = N * 0.34
  const innerR = N * 0.205
  const dotR = N * 0.062
  const top = [99, 102, 241] // #6366f1
  const bot = [79, 70, 229] // #4f46e5
  const white = [255, 255, 255]

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4
      const t = y / N
      let r = lerp(top[0], bot[0], t)
      let g = lerp(top[1], bot[1], t)
      let b = lerp(top[2], bot[2], t)

      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      const ringA = edge(dist, innerR, true) * edge(dist, outerR, false)
      const dotA = edge(dotR, dist, false)
      const a = Math.max(ringA, dotA)
      if (a > 0) {
        r = lerp(r, white[0], a)
        g = lerp(g, white[1], a)
        b = lerp(b, white[2], a)
      }
      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = 255
    }
  }
  return encodePNG(N, N, rgba)
}

writeFileSync(join(PUBLIC, 'pwa-192.png'), drawIcon(192))
writeFileSync(join(PUBLIC, 'pwa-512.png'), drawIcon(512))
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), drawIcon(180))

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#4f46e5"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <circle cx="32" cy="32" r="14.5" fill="none" stroke="#fff" stroke-width="6.5"/>
  <circle cx="32" cy="32" r="4" fill="#fff"/>
</svg>
`
writeFileSync(join(PUBLIC, 'favicon.svg'), favicon)

console.log('Generated: pwa-192.png, pwa-512.png, apple-touch-icon.png, favicon.svg')
