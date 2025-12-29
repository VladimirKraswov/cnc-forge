import { BaseConnection } from './BaseConnection';
import { IConnectionOptions } from '../interfaces/Connection';

export class MockConnection extends BaseConnection {
  public MOCK_send_response: string = 'ok';
  private responses: Map<string, string> = new Map([
    ['$H', 'ok'],
    ['$$', 'ok\n$0=10\n$1=25\n...'],
  ]);

  constructor(options: IConnectionOptions) {
    super(options);
  }

  async connect(): Promise<void> {
    this.connected = true;
    this.connectionQuality = 'excellent';
    this.emit('connected');
    return Promise.resolve();
  }

  async send(data: string): Promise<void> {
    this.logCommand(data);
    const response = this.responses.get(data.trim()) || this.MOCK_send_response;
    process.nextTick(() => {
      if (data.trim() === '?') {
        this.emit('data', this.MOCK_send_response);
      } else if (data.trim().startsWith('G38.2')) {
        this.emit('data', '[PRB:0.000,0.000,0.000:1]');
      } else {
        this.emit('data', response);
      }
      this.lastHeartbeat = new Date();
    });
  }

  async disconnect(): Promise<void> {
    this.onDisconnect();
  }

  // Method for testing failures
  simulateFailure(type: 'timeout' | 'noise' | 'disconnect'): void {
    switch (type) {
      case 'timeout':
        this.connectionQuality = 'poor';
        break;
      case 'disconnect':
        this.onDisconnect();
        break;
    }
  }
}
