export interface LoginRequest {
  Username: string
  Password: string
  fiscalyear?: string
}

export interface UserSettings {
  [key: string]: unknown
}

export interface LoginResponse {
  access_token: string
  expires_in: number
  token_type: string
  creation_Time: string
  expiration_Time: string
  user_id: number
  user_name: string
  user_isadmin: number
  user_password: string
  user_fullname: string
  user_settings: UserSettings | null
}

export interface AuthUser {
  id: number
  username: string
  fullName: string
  isAdmin: boolean
  settings: UserSettings | null
}
