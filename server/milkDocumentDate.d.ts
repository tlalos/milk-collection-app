export function currentMilkDate(now?: Date): string;
export function milkDocumentDateError(value: unknown, label: string, now?: Date): string;
export function assertMilkDocumentDate(value: unknown, label: string, now?: Date): void;
export function assertCurrentMilkDateAccess(existingDate: unknown, requestedDate: unknown, currentDateOnly: boolean, now?: Date): void;
