import { IConnectionOptions } from './Connection';
import { IGrblStatus, IAlarm, IPosition, IJobProgress } from '../types';

// Controller Core
export interface ICncControllerCore {
  // Connection
  connect(options: IConnectionOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Basic commands
  sendCommand(cmd: string, timeout?: number): Promise<string>;
  getStatus(): Promise<IGrblStatus>;

  // Safety
  emergencyStop(): Promise<void>;
  feedHold(): Promise<void>;
  softReset(): Promise<void>;
}

// Event System
export interface ICncEventEmitter {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'status', listener: (status: IGrblStatus) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'alarm', listener: (alarm: IAlarm) => void): this;
  on(event: 'positionUpdate', listener: (pos: IPosition) => void): this;
  on(event: 'jobProgress', listener: (progress: IJobProgress) => void): this;
  on(event: 'jobComplete', listener: () => void): this;
}
