import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import express from 'express'
import multer from 'multer'
import { ocrUpload } from './ocrUpload.js'

let server
let baseUrl

before(async () => {
  // Exercise the production parser without databases, OCR providers, or ERP calls.
  const app = express()
  const respond = (request, response) => response.json({
    category: request.body.category,
    files: (request.files || [request.file]).filter(Boolean).map((file) => ({
      name: file.originalname,
      type: file.mimetype,
      size: file.size,
      inMemory: Buffer.isBuffer(file.buffer),
    })),
  })
  app.post('/compare', ocrUpload.single('document'), respond)
  app.post('/jobs', ocrUpload.array('documents', 10), respond)
  app.use((error, _request, response, _next) => {
    response.status(error instanceof multer.MulterError ? 400 : 500)
      .json({ code: error.code, message: error.message })
  })
  server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  if (!server) return
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
})

function filesForm(count = 1, field = 'documents', size = 32, type = 'image/png') {
  const form = new FormData()
  form.append('category', 'daily_routes')
  for (let index = 0; index < count; index += 1) {
    form.append(field, new Blob([Buffer.alloc(size)], { type }), `document-${index}`)
  }
  return form
}

async function post(path, body, headers) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', body, headers, signal: AbortSignal.timeout(10000),
  })
  return { status: response.status, body: await response.json() }
}

for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
  test(`single upload accepts ${type} and preserves the file buffer`, async () => {
    const result = await post('/compare', filesForm(1, 'document', 32, type))
    assert.equal(result.status, 200)
    assert.equal(result.body.category, 'daily_routes')
    assert.deepEqual(result.body.files, [{ name: 'document-0', type, size: 32, inMemory: true }])
  })
}

test('multiple upload accepts ten documents', async () => {
  const result = await post('/jobs', filesForm(10))
  assert.equal(result.status, 200)
  assert.equal(result.body.files.length, 10)
})

test('multiple upload rejects eleven documents', async () => {
  const result = await post('/jobs', filesForm(11))
  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'LIMIT_FILE_COUNT')
})

test('single upload rejects a second document and incorrect field names', async () => {
  for (const body of [filesForm(2, 'document'), filesForm(1, 'unexpected')]) {
    const result = await post('/compare', body)
    assert.equal(result.status, 400)
    assert.equal(result.body.code, 'LIMIT_UNEXPECTED_FILE')
  }
})

test('unsupported file type is rejected by the existing filter', async () => {
  const result = await post('/jobs', filesForm(1, 'documents', 32, 'text/plain'))
  assert.equal(result.status, 500)
  assert.equal(result.body.message, 'Unsupported file type: text/plain')
})

test('15 MiB file limit accepts the boundary and rejects one byte over', async () => {
  const allowed = await post('/jobs', filesForm(1, 'documents', 15 * 1024 * 1024))
  assert.equal(allowed.status, 200)
  assert.equal(allowed.body.files[0].size, 15 * 1024 * 1024)
  const rejected = await post('/jobs', filesForm(1, 'documents', 15 * 1024 * 1024 + 1))
  assert.equal(rejected.status, 400)
  assert.equal(rejected.body.code, 'LIMIT_FILE_SIZE')
})

test('truncated multipart request reaches the error handler and subsequent uploads still work', async () => {
  const result = await post('/jobs',
    '--upload-test\r\nContent-Disposition: form-data; name="documents"; filename="test.png"\r\nContent-Type: image/png\r\n\r\npartial',
    { 'Content-Type': 'multipart/form-data; boundary=upload-test' })
  assert.equal(result.status, 500)
  assert.match(result.body.message, /Unexpected end of form/)
  assert.equal((await post('/jobs', filesForm())).status, 200)
})

test('crafted array field names cannot crash the upload parser', async () => {
  const form = filesForm()
  form.append('items[4294967294]', 'value')
  form.append('items[]', 'value')
  const result = await post('/jobs', form)
  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'INVALID_FIELD_NAME')
  assert.equal((await post('/jobs', filesForm())).status, 200)
})
