import { apiPost } from './client'
import type { LoginRequest, LoginResponse } from '../types/auth'

export function login(payload: LoginRequest, signal?: AbortSignal): Promise<LoginResponse> {
  return apiPost<LoginRequest, LoginResponse>('Accounts/Login', payload, { signal })
}
