import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const scrypt = promisify(scryptCallback)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const authDir = path.join(rootDir, 'data', 'auth')
const databasePath = path.join(authDir, 'auth.json')
const seedUser = {
  id: 'lactea',
  username: 'lactea',
  passwordSalt: '41d4e80886e20bdfbee46e463becc0b5',
  passwordHash: '39449d4f3c921620ce3bfe4ec9967d3394597b0bcfe21c33d495edbb6e386b0cd6077862e0f8c4eab7b8ce41ef8e0ae5882dafd9e224644d478ad155222089b2',
  createdAt: new Date().toISOString(),
}
let mutationChain = Promise.resolve()

async function readDatabase() {
  return JSON.parse(await readFile(databasePath, 'utf8'))
}

async function writeDatabase(database) {
  const temporary = `${databasePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(database, null, 2), 'utf8')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temporary, databasePath)
      return
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
  await copyFile(temporary, databasePath)
  await rm(temporary, { force: true })
}

function mutateDatabase(mutator) {
  const operation = mutationChain.then(async () => {
    const database = await readDatabase()
    const result = await mutator(database)
    await writeDatabase(database)
    return result
  })
  mutationChain = operation.catch(() => undefined)
  return operation
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function publicUser(user) {
  return { id: user.id, username: user.username }
}

export async function initializeAuthStore() {
  await mkdir(authDir, { recursive: true })
  try {
    await readDatabase()
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeDatabase({ users: [seedUser], sessions: [] })
  }
}

export async function login(username, password, sessionDays = 30) {
  const database = await readDatabase()
  const user = database.users.find((item) => item.username.toLowerCase() === String(username).trim().toLowerCase())
  if (!user) return null
  const candidate = await scrypt(String(password), Buffer.from(user.passwordSalt, 'hex'), 64)
  const expected = Buffer.from(user.passwordHash, 'hex')
  if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null

  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = new Date(now + sessionDays * 86400000).toISOString()
  await mutateDatabase((current) => {
    current.sessions = current.sessions.filter((session) => Date.parse(session.expiresAt) > now)
    current.sessions.push({ tokenHash: tokenHash(token), userId: user.id, createdAt: new Date(now).toISOString(), expiresAt })
  })
  return { token, expiresAt, user: publicUser(user) }
}

export async function getSessionUser(token) {
  if (!token) return null
  const database = await readDatabase()
  const session = database.sessions.find((item) => item.tokenHash === tokenHash(token) && Date.parse(item.expiresAt) > Date.now())
  const user = session && database.users.find((item) => item.id === session.userId)
  return user ? publicUser(user) : null
}

export async function logout(token) {
  if (!token) return
  await mutateDatabase((database) => {
    const hash = tokenHash(token)
    database.sessions = database.sessions.filter((session) => session.tokenHash !== hash)
  })
}
