export function nextOcrRowNumber(...groups: Array<ReadonlyArray<{ rowNumber: number }> | undefined>) {
  return groups.flatMap(group => group || []).reduce((highest, row) => Math.max(highest, row.rowNumber), 0) + 1
}
