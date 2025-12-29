import { EventEmitter } from 'events';
import { IConnection, ConnectionConfig } from '../types';

export abstract class BaseConnection<T extends ConnectionConfig = ConnectionConfig>
  extends EventEmitter
  implements IConnection
{
  protected _isConnected: boolean = false;
  protected config: T;

  constructor(config: T) {
    super();
    this.config = config;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(data: string): Promise<void>;

  get isConnected(): boolean {
    return this._isConnected;
  }

  protected emitConnected(): void {
    this._isConnected = true;
    this.emit('connected');
  }

  protected emitDisconnected(): void {
    this._isConnected = false;
    this.emit('disconnected');
  }

  protected emitData(data: string): void {
    this.emit('data', data);
  }

  protected emitError(error: Error): void {
    this.emit('error', error);
  }

  // Типизация методов EventEmitter
  public on(event: 'connected', listener: () => void): this;
  public on(event: 'disconnected', listener: () => void): this;
  public on(event: 'data', listener: (data: string) => void): this;
  public on(event: 'error', listener: (error: Error) => void): this;
  public on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  public once(event: 'connected', listener: () => void): this;
  public once(event: 'disconnected', listener: () => void): this;
  public once(event: 'data', listener: (data: string) => void): this;
  public once(event: 'error', listener: (error: Error) => void): this;
  public once(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  public off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }

  public removeAllListeners(event?: string | symbol): this {
    return super.removeAllListeners(event);
  }
}