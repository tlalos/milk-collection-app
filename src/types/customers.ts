// Matches the ERP_Customer model returned by ERP_CustomersList
export interface ERP_Customer {
  cus_id: number
  cus_code: string
  cus_name: string
  cus_afm: string
  cus_address: string
  cus_city: string
  cus_phone?: string
  cus_email?: string
}
