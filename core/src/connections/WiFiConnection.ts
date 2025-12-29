import { BaseConnection } from './BaseConnection';
import { WiFiConfig } from '../types';

export class WiFiConnection extends BaseConnection<WiFiConfig> {
  private socket: any = null;
  // УДАЛИТЬ эту строку: private config: WiFiConfig;

  constructor(config: WiFiConfig) {
    super(config);
    // УДАЛИТЬ эту строку: this.config = config;
  }

  async connect(): Promise<void> {
    // this.config уже доступен из родительского класса
    console.log(`WiFi connecting to ${this.config.host}:${this.config.port}`);
    this.emitConnected();
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    this.emitDisconnected();
    return Promise.resolve();
  }

  async send(data: string): Promise<void> {
    if (!this._isConnected) {
      throw new Error('WiFi connection is not established');
    }
    console.log(`WiFi send: ${data}`);
    return Promise.resolve();
  }
}