import { IConnection } from '../interfaces/Connection';
import { ICommandManager } from '../interfaces/CommandManager';

export class CommandManager implements ICommandManager {
  private queue: Array<{
    command: string;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout | null;
    timeoutValue: number;
    attempts: number;
    maxAttempts: number;
  }> = [];

  private isProcessing: boolean = false;
  private maxQueueSize: number = 50;
  private defaultTimeout: number = 5000; // 5 seconds

  async execute(
    command: string,
    connection: IConnection,
    timeout?: number
  ): Promise<string> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('Command queue is full');
    }

    const timeoutValue = timeout || this.defaultTimeout;

    return new Promise((resolve, reject) => {
      this.queue.push({
        command,
        resolve,
        reject,
        timeout: null, // This will be set in the processQueue method
        timeoutValue,
        attempts: 0,
        maxAttempts: 3,
      });

      this.processQueue(connection);
    });
  }

  private async processQueue(connection: IConnection): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue[0];

      try {
        const response = await new Promise<string>((resolve, reject) => {
          let responseBuffer = '';
          const responseTimeout = setTimeout(
            () => {
              connection.removeListener('data', dataHandler);
              reject(new Error('Response timeout'));
            },
            item.timeoutValue
          );
          item.timeout = responseTimeout;

          const dataHandler = (data: string) => {
            responseBuffer += data.trim();
            if (
              item.command.startsWith('?') &&
              responseBuffer.startsWith('<')
            ) {
              clearTimeout(responseTimeout);
              connection.removeListener('data', dataHandler);
              resolve(responseBuffer);
            } else if (
              responseBuffer.includes('ok') ||
              responseBuffer.includes('error') ||
              responseBuffer.includes('alarm') ||
              responseBuffer.includes('[PRB')
            ) {
              clearTimeout(responseTimeout);
              connection.removeListener('data', dataHandler);
              resolve(responseBuffer);
            }
          };

          connection.on('data', dataHandler);
          connection.send(item.command).catch(err => {
            clearTimeout(responseTimeout);
            connection.removeListener('data', dataHandler);
            reject(err);
          });
        });

        item.resolve(response);
        this.queue.shift();
      } catch (error) {
        item.attempts++;

        if (item.attempts >= item.maxAttempts) {
          if (item.timeout) clearTimeout(item.timeout);
          item.reject(error as Error);
          this.queue.shift();
        } else {
          const delay = Math.min(100 * Math.pow(2, item.attempts), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.isProcessing = false;
  }

  clear(): void {
    this.queue.forEach(item => {
      if (item.timeout) clearTimeout(item.timeout);
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
  }

  getQueueStatus(): { length: number; processing: boolean } {
    return {
      length: this.queue.length,
      processing: this.isProcessing,
    };
  }
}
