import { IConnection } from './Connection';

export interface ICommandManager {
  execute(command: string, connection: IConnection, timeout?: number): Promise<string>;
  clear(): void;
  getQueueStatus(): { length: number; processing: boolean };
}
