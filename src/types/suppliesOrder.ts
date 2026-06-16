export interface ERP_SuppliesPickingOrder {
  order_id: number
  ftr_row_id: number
  cus_id: number
  username: string
  salespickingseries: number
  store: string
  store_id: string
  position: string
  position_id: string
  item_id: number
  item_code: string
  qty1: number
  qty2: number
  price: number
  disc1prc: number
  disc2prc: number
  lot_id: number
  lot_lot: string
  pal_code: string
  item_extra_field: string
  item_comments: string
  frombranch: string
  fromstore: string
  fromposition: string
  tobranch: string
  tostore: string
  toposition: string
  transportnum: string
  comments: string
  sampleid: string
  countryid: string
  compartmentid: string
  buyerid: string
  internalnum: string
  setdate: string
  origin_supid: number
  carrierid: string
  shipkindid: string
  shipmentid: string
}

export interface ERP_RetFunc {
  status: boolean
  status_message: string
  newid?: string
  qr_ok?: boolean
  qr_qr?: string
}
