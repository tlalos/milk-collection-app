import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import { prepareFinalColumnCrop } from './ocrImageProcessing.js'

for (const [name, width, height] of [
  ['romanian-monthly-settlement-ocr-test.png', 1416, 4096],
  ['romanian-detailed-settlement-ocr-test.png', 1496, 3868],
]) {
  test(`prepares the sample ${name} for final-column verification`, async () => {
    const input = await readFile(new URL(`../test-documents/${name}`, import.meta.url))
    const output = await prepareFinalColumnCrop(input)
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, width)
    assert.equal(metadata.height, height)
    const stats = await sharp(output).stats()
    assert.ok(stats.channels.some((channel) => channel.stdev > 5), 'document crop must not be blank')
  })
}

for (const format of ['png', 'jpeg', 'webp']) {
  test(`crops only the rightmost totals and enlarges ${format} input`, async () => {
    // Red marks the excluded columns; green marks the final totals region.
    const pixels = Buffer.alloc(100 * 40 * 3)
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 100; x += 1) {
        pixels[(y * 100 + x) * 3 + (x >= 77 ? 1 : 0)] = 255
      }
    }
    const input = await sharp(pixels, { raw: { width: 100, height: 40, channels: 3 } })
      .toFormat(format).toBuffer()
    const output = await prepareFinalColumnCrop(input)
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.format, 'jpeg')
    assert.equal(metadata.width, 92)
    assert.equal(metadata.height, 160)
    const stats = await sharp(output).stats()
    assert.ok(stats.channels[1].mean > 230, 'final totals region must be retained')
    assert.ok(stats.channels[0].mean < 25, 'earlier totals region must be excluded')
  })
}

test('applies EXIF orientation before calculating the crop', async () => {
  const input = await sharp({ create: { width: 100, height: 40, channels: 3, background: 'white' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const output = await prepareFinalColumnCrop(input)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.width, 40)
  assert.equal(metadata.height, 400)
  assert.equal(metadata.orientation, undefined)
})

test('caps enlarged crop width at 2600 pixels', async () => {
  const input = await sharp({ create: { width: 4000, height: 100, channels: 3, background: 'white' } })
    .png().toBuffer()
  const metadata = await sharp(await prepareFinalColumnCrop(input)).metadata()
  assert.equal(metadata.width, 2600)
  assert.equal(metadata.height, 283)
})

test('rejects empty and non-image buffers without preventing later image processing', async () => {
  for (const input of [Buffer.alloc(0), Buffer.from('not an image')]) {
    await assert.rejects(prepareFinalColumnCrop(input), Error)
  }
  const valid = await sharp({ create: { width: 100, height: 40, channels: 3, background: 'white' } })
    .png().toBuffer()
  await assert.rejects(prepareFinalColumnCrop(valid.subarray(0, 40)), Error)
  const metadata = await sharp(await prepareFinalColumnCrop(valid)).metadata()
  assert.equal(metadata.format, 'jpeg')
})
