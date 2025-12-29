import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { BaseConnection } from './BaseConnection';
import { SerialConfig } from '../types';

export class SerialConnection extends BaseConnection<SerialConfig> {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;

  constructor(config: SerialConfig) {
    super(config);
  }

  async connect(): Promise<void> {
    try {
      const { port, baudRate = 115200 } = this.config;

      this.port = new SerialPort({
        path: port,
        baudRate,
        dataBits: this.config.dataBits || 8,
        stopBits: this.config.stopBits || 1,
        parity: this.config.parity || 'none',
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      this.setupListeners();

      // В новых версиях SerialPort использует Promise-based API
      await this.port.open();
      
      console.log(`Serial port ${port} opened at ${baudRate} baud`);
      this.emitConnected();

    } catch (error) {
      this.emitError(error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.port) {
      return;
    }

    try {
      await this.port.close();
      this.emitDisconnected();
    } catch (error) {
      this.emitError(error as Error);
      throw error;
    }
  }

  async send(data: string): Promise<void> {
    if (!this.port || !this._isConnected) {
      throw new Error('Serial port is not connected');
    }

    try {
      await this.port.write(data + '\n');
      await this.port.drain();
    } catch (error) {
      this.emitError(error as Error);
      throw error;
    }
  }

  private setupListeners(): void {
    if (this.parser) {
      this.parser.on('data', (data: string) => {
        this.emitData(data);
      });
    }

    if (this.port) {
      this.port.on('close', () => {
        this.emitDisconnected();
      });

      this.port.on('error', (error: Error) => {
        this.emitError(error);
      });
    }
  }
}