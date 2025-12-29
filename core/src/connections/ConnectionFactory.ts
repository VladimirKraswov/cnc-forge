import { SerialConnection } from './SerialConnection';
import { WiFiConnection } from './WiFiConnection';
import { BluetoothConnection } from './BluetoothConnection';
import { 
  IConnection, 
  ConnectionType, 
  ConnectionConfig,
  IConnectionOptions,
  SerialConfig,
  WiFiConfig,
  BluetoothConfig 
} from '../types';

export class ConnectionFactory {
  static create(options: IConnectionOptions): IConnection {
    // Преобразуем IConnectionOptions в ConnectionConfig
    const config = this.convertOptionsToConfig(options);
    
    switch (config.type) {
      case ConnectionType.Serial:
        return new SerialConnection(config as SerialConfig);
      case ConnectionType.WiFi:
        return new WiFiConnection(config as WiFiConfig);
      case ConnectionType.Bluetooth:
        return new BluetoothConnection(config as BluetoothConfig);
      default:
        const _exhaustiveCheck: never = config;
        throw new Error(`Unsupported connection type: ${(config as any).type}`);
    }
  }

  private static convertOptionsToConfig(options: IConnectionOptions): ConnectionConfig {
    switch (options.type) {
      case ConnectionType.Serial:
        return {
          type: ConnectionType.Serial,
          port: options.port!,
          baudRate: options.baudRate || 115200,
          dataBits: 8,
          stopBits: 1,
          parity: 'none'
        } as SerialConfig;
        
      case ConnectionType.WiFi:
        return {
          type: ConnectionType.WiFi,
          host: options.host!,
          port: options.portNumber || 23,
          timeout: options.timeout || 5000
        } as WiFiConfig;
        
      case ConnectionType.Bluetooth:
        return {
          type: ConnectionType.Bluetooth,
          address: options.address!,
          channel: 1
        } as BluetoothConfig;
        
      default:
        throw new Error(`Unsupported connection type: ${options.type}`);
    }
  }
}