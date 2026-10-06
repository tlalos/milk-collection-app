import multer from 'multer'

const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

export const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 15 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const supported = supportedTypes.has(file.mimetype)
    callback(supported ? null : new Error(`Unsupported file type: ${file.mimetype}`), supported)
  },
})
