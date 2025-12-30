import { BaseConnection } from './BaseConnection';
import { IConnectionOptions } from '../interfaces/Connection';

export class MockConnection extends BaseConnection {
  public MOCK_send_response: string = 'ok';
  public responses: Map<string, string> = new Map([
    ['$H', 'ok'],
    ['$$', '$0=10\n$1=25\nok'],
    ['$I', '[VER:1.1f.20230414]\nok'],
    ['?', '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|F:0>'],
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
    return new Promise((resolve) => {
      this.logCommand(data);
      const trimmedData = data.trim();
      let response: string;
      
      if (trimmedData === '?') {
        response = this.responses.get(trimmedData) || this.MOCK_send_response;
      } else if (trimmedData.startsWith('G38.2')) {
        response = this.responses.get(trimmedData) || '[PRB:0.000,0.000,0.000:1]';
      } else {
        response = this.responses.get(trimmedData) || this.MOCK_send_response;
      }
      
      process.nextTick(() => {
        this.emit('data', response);
        this.lastHeartbeat = new Date();
        resolve(); // Разрешаем промис после отправки
      });
    });
  }

  async disconnect(): Promise<void> {
    this.onDisconnect();
    return Promise.resolve();
  }

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