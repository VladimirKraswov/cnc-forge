export interface IGrblStatus {
  state: 'Idle' | 'Run' | 'Hold' | 'Alarm' | 'Home' | 'Check' | 'Door' | 'Sleep';
  position: { x: number; y: number; z: number };
  feed?: number;
  spindleSpeed?: number;
  buffer?: { available: number; used: number };
}

export interface IPosition {
  x: number;
  y: number;
  z: number;
}

export interface IAlarm {
  code: number;
  message: string;
}

export interface IJobProgress {
  current: number;
  total: number;
  line: string;
  percentage: number;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warning?: string;
}

export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'unknown';
