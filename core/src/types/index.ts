// Импортируем только типы, которые не будем объявлять здесь
import { EventEmitter } from 'eventemitter3';

// GRBL Status - базовый интерфейс для парсинга статуса GRBL
export interface IGrblStatus {
  state: string; // e.g., 'Idle', 'Run', 'Alarm'
  position: { x: number; y: number; z: number };
  feed?: number;
  // Добавьте поля по мере нужды, на основе GRBL-документации
}

// Connection types
export enum ConnectionType {
  Serial = 'serial',
  WiFi = 'wifi',
  Bluetooth = 'bluetooth'
}

// Basic connection interfaces (упрощенные)
export interface IConnection extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: string): Promise<void>;
  readonly isConnected: boolean;
  
  // EventEmitter методы
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'data', listener: (data: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string | symbol): this;
}

export interface SerialConfig {
  type: ConnectionType.Serial;
  port: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 1.5 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
}

export interface WiFiConfig {
  type: ConnectionType.WiFi;
  host: string;
  port: number;
  timeout?: number;
}

export interface BluetoothConfig {
  type: ConnectionType.Bluetooth;
  address: string;
  channel?: number;
}

export type ConnectionConfig = SerialConfig | WiFiConfig | BluetoothConfig;

// Для обратной совместимости оставляем IConnectionOptions
export interface IConnectionOptions {
  type: ConnectionType;
  port?: string;
  baudRate?: number;
  host?: string;
  portNumber?: number;
  address?: string;
  timeout?: number;
  retries?: number;
}

// Machine state types
export interface IPosition {
  x: number;
  y: number;
  z: number;
  a?: number;
  b?: number;
  c?: number;
}

export enum MachineStatus {
  Idle = 'Idle',
  Run = 'Run',
  Hold = 'Hold',
  Alarm = 'Alarm',
  Home = 'Home',
  Check = 'Check',
  Door = 'Door',
  Sleep = 'Sleep',
  Disconnected = 'Disconnected'
}

export interface IMachineState {
  status: MachineStatus;
  machinePosition: IPosition;
  workPosition: IPosition;
  feedRate: number;
  spindleSpeed: number;
  buffer: {
    available: number;
    used: number;
  };
}

// GCode types
export interface IGCodeCommand {
  line: number;
  command: string;
  comment?: string;
  modalGroup?: number;
}

export interface IGCodeExecutionResult {
  success: boolean;
  command: string;
  response?: string;
  error?: string;
  executionTime?: number;
}

// Controller events
export enum ControllerEvent {
  Connected = 'connected',
  Disconnected = 'disconnected',
  StatusUpdate = 'statusUpdate',
  MachineStatus = 'machineStatus',
  Error = 'error',
  GCodeSent = 'gcodeSent',
  GCodeResponse = 'gcodeResponse',
  Progress = 'progress',
  JobComplete = 'jobComplete'
}

export interface IJobProgress {
  current: number;
  total: number;
  line: string;
  percentage: number;
}

// Job types
export interface IJob {
  id: string;
  name: string;
  gcode: string[];
  totalLines: number;
  progress: number;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  startTime?: Date;
  endTime?: Date;
}

// Settings types
export interface ISettings {
  machine: {
    maxFeedRate: number;
    maxSpindleSpeed: number;
    stepsPerMm: IPosition;
    softLimits: {
      enabled: boolean;
      min: IPosition;
      max: IPosition;
    };
  };
  communication: {
    commandTimeout: number;
    maxRetries: number;
    enableQueue: boolean;
    queueSize: number;
  };
  safety: {
    enableHoming: boolean;
    enableLimits: boolean;
    enableProbing: boolean;
    autoDisconnect: boolean;
  };
}

// Error types
export enum ErrorCode {
  ConnectionFailed = 'CONNECTION_FAILED',
  ConnectionTimeout = 'CONNECTION_TIMEOUT',
  CommandTimeout = 'COMMAND_TIMEOUT',
  MachineNotReady = 'MACHINE_NOT_READY',
  InvalidGCode = 'INVALID_G_CODE',
  BufferOverflow = 'BUFFER_OVERFLOW',
  HardwareError = 'HARDWARE_ERROR'
}

export interface ICncError extends Error {
  code: ErrorCode;
  details?: any;
}

// GCode types (альтернативные, более детальные)
export interface GCodeBlock {
  lineNumber: number;
  raw: string;
  comment?: string;
  modalGroups: {
    [group: number]: string;
  };
  coordinates?: {
    [axis: string]: number;
  };
  feedRate?: number;
  spindleSpeed?: number;
}

export interface GCodeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  parsed?: GCodeBlock;
}

// Motion types
export interface JogCommand {
  axis: 'x' | 'y' | 'z' | 'a' | 'b' | 'c';
  distance: number;
  feedRate?: number;
  relative?: boolean;
}

export interface HomeCommand {
  axes?: ('x' | 'y' | 'z' | 'a' | 'b' | 'c')[];
  sequence?: 'xyz' | 'zxy' | 'zyx' | 'xzy' | 'yxz' | 'yzx';
}

export interface ProbeCommand {
  axis: 'x' | 'y' | 'z';
  direction: 'positive' | 'negative';
  feedRate: number;
  maxDistance: number;
}

export interface MotionConfig {
  maxFeedRate: number;
  maxJogFeedRate: number;
  maxProbeFeedRate: number;
  acceleration: number;
  jerk: number;
}

export interface IProbeResult {
  x: number;
  y: number;
  z: number;
}

export interface IAlarm {
  code: number;
  message: string;
}