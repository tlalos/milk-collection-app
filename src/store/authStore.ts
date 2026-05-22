import type { AuthUser, LoginResponse } from '../types/auth'

const TOKEN_KEY = 'auth_token'
const USER_KEY = 'auth_user'
const EXPIRY_KEY = 'auth_expiry'
// Intentionally never cleared — survives logout and token expiry
const LAST_USERNAME_KEY = 'auth_last_username'
const LAST_PASSWORD_KEY = 'auth_last_password'
const LAST_FISCAL_YEAR_KEY = 'auth_last_fiscal_year'
// Marks that the current session was authenticated locally (no JWT)
const OFFLINE_SESSION_KEY = 'auth_offline_session'

export const authStore = {
  /** Save a server-authenticated session (JWT). */
  save(response: LoginResponse, fiscalYear?: string): void {
    localStorage.removeItem(OFFLINE_SESSION_KEY)
    localStorage.setItem(TOKEN_KEY, response.access_token)
    localStorage.setItem(EXPIRY_KEY, response.expiration_Time)
    localStorage.setItem(LAST_USERNAME_KEY, response.user_name)
    localStorage.setItem(LAST_PASSWORD_KEY, response.user_password)
    if (fiscalYear) localStorage.setItem(LAST_FISCAL_YEAR_KEY, fiscalYear)
    const user: AuthUser = {
      id: response.user_id,
      username: response.user_name,
      fullName: response.user_fullname,
      isAdmin: response.user_isadmin === 1,
      settings: response.user_settings,
    }
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },

  /** Save a locally-authenticated session (offline users, no JWT). */
  saveOfflineSession(user: AuthUser, password?: string): void {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(EXPIRY_KEY)
    localStorage.setItem(OFFLINE_SESSION_KEY, 'true')
    localStorage.setItem(LAST_USERNAME_KEY, user.username)
    if (password !== undefined) localStorage.setItem(LAST_PASSWORD_KEY, password)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  },

  isOfflineSession(): boolean {
    return localStorage.getItem(OFFLINE_SESSION_KEY) === 'true'
  },

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY)
  },

  getUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as AuthUser
    } catch {
      return null
    }
  },

  getLastUsername(): string {
    return localStorage.getItem(LAST_USERNAME_KEY) ?? ''
  },

  getLastPassword(): string {
    return localStorage.getItem(LAST_PASSWORD_KEY) ?? ''
  },

  getLastFiscalYear(): string {
    return localStorage.getItem(LAST_FISCAL_YEAR_KEY) ?? ''
  },

  isLoggedIn(): boolean {
    // Offline session: valid as long as user data exists
    if (localStorage.getItem(OFFLINE_SESSION_KEY) === 'true') {
      return !!localStorage.getItem(USER_KEY)
    }
    // Online session: requires non-expired JWT
    const token = localStorage.getItem(TOKEN_KEY)
    const expiry = localStorage.getItem(EXPIRY_KEY)
    if (!token || !expiry) return false
    return new Date(expiry) > new Date()
  },

  clear(): void {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(EXPIRY_KEY)
    localStorage.removeItem(OFFLINE_SESSION_KEY)
    // LAST_USERNAME_KEY, LAST_PASSWORD_KEY, LAST_FISCAL_YEAR_KEY are intentionally kept
  },
}
