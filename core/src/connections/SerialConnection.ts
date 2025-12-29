import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { BaseConnection } from './BaseConnection';
import { IConnectionOptions } from '../interfaces/Connection';

export class SerialConnection extends BaseConnection {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;

  constructor(options: IConnectionOptions) {
    super(options);
  }

  async connect(): Promise<void> {
    const portPath = this.options.port;
    if (!portPath) {
      throw new Error('Serial port path is not defined');
    }

    try {
      this.port = new SerialPort({
        path: portPath,
        baudRate: this.options.baudRate || 115200,
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.port.on('open', () => {
        this.connected = true;
        this.startConnectionMonitoring();
        this.emit('connected');
      });

      this.parser.on('data', (data: string) => {
        this.emit('data', data);
        this.lastHeartbeat = new Date();
      });

      this.port.on('error', (err: Error) => {
        this.emit('error', err);
        this.scheduleReconnect();
      });

      this.port.on('close', () => {
        this.onDisconnect();
      });
    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  async send(data: string): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Not connected');
    }
    this.logCommand(data);
    return new Promise((resolve, reject) => {
      this.port!.write(data + '\n', (err) => {
        if (err) {
          this.emit('error', err);
          return reject(err);
        }
        this.port!.drain((err) => {
          if (err) {
            this.emit('error', err);
            return reject(err);
          }
          this.lastHeartbeat = new Date();
          resolve();
        });
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.port && this.port.isOpen) {
      this.port.close();
    }
    this.port = null;
    this.connected = false;
  }
}
