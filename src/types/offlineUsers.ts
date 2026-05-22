import type { UserSettings } from './auth'

export interface ERP_OfflineUser {
  user_id: number
  user_name: string
  user_password: string
  user_fullname: string
  user_isadmin: number
  user_settings: UserSettings | null
}
