export interface ERP_ZgParam {
  par_invoiceheaderline1: string
  par_invoiceheaderline2: string
  par_invoiceheaderline3: string
  par_invoiceheaderline4: string
  par_invoiceheaderline5: string
  par_printformsupplier: string
  par_printformbuyer: string
  par_supplies_series1: string
  par_from_branch: string
  par_from_store: string
  par_to_branch: string
  par_to_store: string
}

export interface LocalZgParam extends ERP_ZgParam {
  id: 'current'
  username: string
  syncedAt: string
}
