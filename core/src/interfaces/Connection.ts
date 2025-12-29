export enum ConnectionType {
  Serial = 'serial',
  WiFi = 'wifi',
  Bluetooth = 'bluetooth'
}

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

export interface IConnection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: string): Promise<void>;
  readonly isConnected: boolean;

  // EventEmitter methods
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'data', listener: (data: string) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}
