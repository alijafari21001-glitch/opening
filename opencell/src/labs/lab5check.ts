// Public build stand-in for the Lab 5 checklist.
export interface Check { step: string; title: string; ok: boolean; detail: string }
export const LAB5_STEP1: [string, string][] = [];
export function lab5Checks(_s: unknown, _bodies: (o: never[]) => unknown, _tipZ: number | null): Check[] { return []; }
