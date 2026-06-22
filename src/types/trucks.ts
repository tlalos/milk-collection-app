export interface ERP_Truck {
  truck_id: number
  truck_name: string
  truck_code: string
}

export interface LocalTruck extends ERP_Truck {
  syncedAt: string
}
