import { BaseConnection } from './BaseConnection';
import { BluetoothConfig } from '../types';

export class BluetoothConnection extends BaseConnection<BluetoothConfig> {
  constructor(config: BluetoothConfig) {
    super(config);
    // Больше не нужно сохранять config отдельно - он уже в родительском классе
  }

  async connect(): Promise<void> {
    // TODO: Реализовать Bluetooth подключение
    console.log(`Bluetooth connecting to ${this.config.address}`); // this.config уже имеет тип BluetoothConfig
    this.emitConnected();
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    // TODO: Реализовать отключение
    this.emitDisconnected();
    return Promise.resolve();
  }

  async send(data: string): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Bluetooth connection is not established');
    }
    // TODO: Реализовать отправку
    console.log(`Bluetooth send: ${data}`);
    return Promise.resolve();
  }
}