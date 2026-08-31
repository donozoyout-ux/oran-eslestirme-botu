export type ProviderDiagnosticValue = string | number | boolean | null | string[];

export interface ProviderDiagnosticSnapshot {
  [key: string]: ProviderDiagnosticValue;
}

const diagnostics = new Map<string, ProviderDiagnosticSnapshot>();

export function setProviderDiagnostic(name: string, snapshot: ProviderDiagnosticSnapshot): void {
  diagnostics.set(name, { ...snapshot });
}

export function getProviderDiagnostics(): Record<string, ProviderDiagnosticSnapshot> {
  return Object.fromEntries([...diagnostics.entries()].map(([name, snapshot]) => [name, { ...snapshot }]));
}

export function resetProviderDiagnosticsForTests(): void {
  diagnostics.clear();
}
