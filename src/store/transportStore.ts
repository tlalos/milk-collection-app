import { db } from '../db/database'
import type { TransportDetails } from '../types/transport'

const CURRENT_TRANSPORT_ID = 'current'

export type TransportFormValues = Pick<
  TransportDetails,
  'transporterName' | 'truckNumber' | 'driverName'
>

export async function getTransportDetails(): Promise<TransportDetails | undefined> {
  return db.transportDetails.get(CURRENT_TRANSPORT_ID)
}

export async function saveTransportDetails(values: TransportFormValues): Promise<TransportDetails> {
  const details: TransportDetails = {
    id: CURRENT_TRANSPORT_ID,
    transporterName: values.transporterName.trim(),
    truckNumber: values.truckNumber.trim(),
    driverName: values.driverName.trim(),
    updatedAt: new Date().toISOString(),
  }

  await db.transportDetails.put(details)
  return details
}
