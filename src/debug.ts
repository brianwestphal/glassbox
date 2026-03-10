let debugEnabled = false;
let aiServiceTestEnabled = false;
let demoMode: number | null = null;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function isDebug(): boolean {
  return debugEnabled;
}

export function setAIServiceTest(enabled: boolean): void {
  aiServiceTestEnabled = enabled;
}

export function isAIServiceTest(): boolean {
  return aiServiceTestEnabled;
}

export function setDemoMode(scenario: number | null): void {
  demoMode = scenario;
}

export function getDemoMode(): number | null {
  return demoMode;
}

export function debugLog(...args: unknown[]): void {
  if (debugEnabled) {
    console.log('[debug]', ...args);
  }
}
