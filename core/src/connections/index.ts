import { IConnection, IConnectionOptions, ConnectionType } from '../interfaces/Connection';
import { SerialConnection } from './SerialConnection';
import { BaseConnection } from './BaseConnection';

// Stub classes for WiFi and Bluetooth connections
class WiFiConnection extends BaseConnection {
  constructor(options: IConnectionOptions) {
    super(options);
    throw new Error('WiFi connection is not yet implemented.');
  }
  connect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  disconnect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  send(data: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

class BluetoothConnection extends BaseConnection {
  constructor(options: IConnectionOptions) {
    super(options);
    throw new Error('Bluetooth connection is not yet implemented.');
  }
  connect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  disconnect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  send(data: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
}


export class ConnectionFactory {
  static create(options: IConnectionOptions): IConnection {
    switch (options.type) {
      case ConnectionType.Serial:
        return new SerialConnection(options);
      case ConnectionType.WiFi:
        return new WiFiConnection(options);
      case ConnectionType.Bluetooth:
        return new BluetoothConnection(options);
      default:
        throw new Error(`Unsupported connection type: ${options.type}`);
    }
  }
}
