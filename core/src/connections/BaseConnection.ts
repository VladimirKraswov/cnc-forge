import { EventEmitter } from 'events';
import { IConnection, IConnectionOptions } from '../interfaces/Connection';
import { ConnectionQuality } from '../types';

export abstract class BaseConnection extends EventEmitter implements IConnection {
  protected options: IConnectionOptions;
  protected connected: boolean = false;
  protected connectionQuality: ConnectionQuality = 'unknown';
  protected lastHeartbeat: Date | null = null;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = 5;
  protected commandBuffer: Array<{ cmd: string; timestamp: Date }> = [];
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor(options: IConnectionOptions) {
    super();
    this.options = options;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(data: string): Promise<void>;

  protected startConnectionMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.monitoringInterval = setInterval(() => {
      this.updateConnectionQuality();
      this.checkHeartbeat();
    }, 1000);
  }

  protected stopConnectionMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  protected updateConnectionQuality(): void {
    // Logic for evaluating connection quality
    // Based on: timeouts, errors, delays
  }

  protected checkHeartbeat(): void {
    if (!this.lastHeartbeat) return;
    const diff = Date.now() - this.lastHeartbeat.getTime();
    if (diff > 5000) {
      // 5 seconds without data
      this.emit('error', new Error('Heartbeat timeout'));
      this.scheduleReconnect();
    }
  }

  protected onDisconnect(): void {
    this.connected = false;
    this.stopConnectionMonitoring();
    this.emit('disconnected');
    this.scheduleReconnect();
  }

  protected scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  protected async reconnect(): Promise<void> {
    try {
      await this.disconnect();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.connect();
      this.reconnectAttempts = 0;
    } catch (error) {
      this.scheduleReconnect();
    }
  }

  protected logCommand(cmd: string): void {
    this.commandBuffer.push({
      cmd,
      timestamp: new Date(),
    });

    // Store only the last 100 commands
    if (this.commandBuffer.length > 100) {
      this.commandBuffer.shift();
    }
  }

  get isConnected(): boolean {
    return this.connected && this.connectionQuality !== 'poor';
  }

  getConnectionQuality(): ConnectionQuality {
    return this.connectionQuality;
  }

  getCommandHistory(): Array<{ cmd: string; timestamp: Date }> {
    return [...this.commandBuffer];
  }
}
