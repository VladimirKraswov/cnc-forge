import { IPosition } from '../types';

// Типы для системы хоминга
export interface HomingStep {
  id: string;
  description: string;
  action: () => Promise<void>;
  critical: boolean;
  retryable: boolean;
  maxRetries?: number;
}

export interface HomingStepResult {
  stepId: string;
  success: boolean;
  duration: number;
  error: Error | null;
}

export interface HomingResult {
  success: boolean;
  duration: number;
  axesHomed: string[];
  steps: HomingStepResult[];
  error?: Error;
  warnings?: string[];
  recoveryInstructions?: string[];
}

// Типы для системы джогинга
export interface JogResult {
  success: boolean;
  duration: number;
  axes: string[];
  distance: { x?: number; y?: number; z?: number };
  feed: number;
  response?: string;
  error?: Error;
  recoveryNeeded?: boolean;
}

// Типы для системы зондирования
export type ProbeFailureType =
  | 'initial_state'   // Датчик уже сработан в начале
  | 'no_contact'      // Не было контакта
  | 'limit_triggered' // Сработал концевик
  | 'timeout'         // Таймаут
  | 'unknown';        // Неизвестная ошибка

export interface ProbeResult {
  success: boolean;
  axis: 'X' | 'Y' | 'Z';
  feedRate: number;
  distance: number;
  position: IPosition;
  rawResponse: string;
  duration: number;
  contactDetected: boolean;
  error?: Error;
  probeFailure?: ProbeFailureType;
}

export interface GridProbeResult {
  success: boolean;
  duration: number;
  gridSize: { x: number; y: number };
  stepSize: number;
  pointsProbed: number;
  pointsSuccessful: number;
  grid: Array<{ x: number; y: number; z?: number }>;
  results: ProbeResult[];
  averageHeight?: number;
  flatness?: number;
  warnings?: string[];
  error?: Error;
  recoveryNeeded?: boolean;
}
