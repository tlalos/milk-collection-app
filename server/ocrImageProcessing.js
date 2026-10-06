import sharp from 'sharp'

export async function prepareFinalColumnCrop(buffer) {
  const rotated = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true })
  // The repeated totals occupy the far-right edge. Exclude the first TOTAL L
  // column so verification can only read the final totals.
  const cropLeft = Math.floor(rotated.info.width * 0.77)
  const cropWidth = rotated.info.width - cropLeft
  const targetWidth = Math.min(2600, Math.max(cropWidth, cropWidth * 4))
  return sharp(rotated.data)
    .extract({ left: cropLeft, top: 0, width: cropWidth, height: rotated.info.height })
    .resize({ width: targetWidth })
    .sharpen()
    .jpeg({ quality: 94 })
    .toBuffer()
}
