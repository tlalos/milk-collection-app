export type ItemOfflineType = 'supplies' | 'milkcollection' | string

export interface ERP_Item {
  item_id: number
  item_code: string
  item_descr: string
  item_mu1_name: string
  item_mu1_shortcut: string
  item_mu1_decimals: number
  item_mu2_name: string
  item_mu2_shortcut: string
  item_mu2_decimals: number
  item_mu21_rel: number
  item_labelweightperiexomeno: number
  lot_scenario: string
  item_utbl04: string
  item_offline_type: ItemOfflineType
}

export interface LocalItem extends ERP_Item {
  syncedAt: string
}
