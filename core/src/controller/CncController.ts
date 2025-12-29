import { EventEmitter } from 'eventemitter3';
import { 
  IConnection,
  IConnectionOptions, 
  IGrblStatus, 
} from '../types';
import fs from 'fs/promises';
import { ConnectionFactory } from '../connections';

export class CncController extends EventEmitter {
  private connection: IConnection | null = null;
  private connected: boolean = false;
  private responseBuffer: string = '';
  private responsePromise: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null;

  async connect(options: IConnectionOptions): Promise<void> {
    try {
      // Используем ConnectionFactory
      this.connection = ConnectionFactory.create(options);
      
      // Настраиваем обработчики событий
      this.connection.on('connected', () => {
        this.connected = true;
        this.emit('connected');
      });
      
      this.connection.on('disconnected', () => {
        this.connected = false;
        this.emit('disconnected');
      });
      
      this.connection.on('data', (data: string) => {
        this.handleIncomingData(data);
      });
      
      this.connection.on('error', (error: Error) => {
        this.emit('error', error);
      });
      
      // Подключаемся
      await this.connection.connect();
      
    } catch (error) {
      throw new Error(`Ошибка соединения: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) throw new Error('Не соединено');
    await this.connection.disconnect();
    this.connection = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && (this.connection?.isConnected || false);
  }

  async sendCommand(command: string, timeout: number = 5000): Promise<string> {
    if (!this.connection || !this.isConnected()) {
      throw new Error('Не соединено');
    }

    this.responseBuffer = ''; // Очистка буфера перед новой командой
    
    return new Promise(async (resolve, reject) => {
      try {
        // Отправляем команду
        await this.connection!.send(command + '\n');
        
        // Настраиваем обработчик ответа
        this.responsePromise = { resolve, reject };
        
        // Таймаут
        const timeoutId = setTimeout(() => {
          if (this.responsePromise) {
            this.responsePromise.reject(new Error('Таймаут ответа'));
            this.responsePromise = null;
          }
        }, timeout);

        // Временный обработчик для очистки таймаута
        const originalResolve = this.responsePromise.resolve;
        this.responsePromise.resolve = (value: string) => {
          clearTimeout(timeoutId);
          originalResolve(value);
        };

      } catch (error) {
        reject(error as Error);
      }
    });
  }

  private handleIncomingData(data: string): void {
    const trimmedData = data.trim();
    
    // Добавляем в буфер
    this.responseBuffer += trimmedData;
    
    // Эмитируем событие обновления статуса
    this.emit('statusUpdate', trimmedData);
    
    // Проверяем, является ли это ответом на команду
    if (this.responsePromise && 
        (trimmedData.includes('ok') || 
         trimmedData.includes('error') || 
         trimmedData.includes('alarm'))) {
      
      const response = this.responseBuffer.trim();
      this.responsePromise.resolve(response);
      this.responsePromise = null;
      this.responseBuffer = '';
    }
    
    // Также пытаемся парсить статус GRBL
    if (trimmedData.startsWith('<')) {
      try {
        const status = this.parseGrblStatus(trimmedData);
        this.emit('machineStatus', status);
      } catch (error) {
        // Игнорируем ошибки парсинга
      }
    }
  }

  private parseGrblStatus(response: string): IGrblStatus {
    const match = response.match(/<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)\|(?:WPos:[\d.-]+,[\d.-]+,[\d.-]+)?\|?(?:F:([\d.-]+))?/);
    if (match) {
      return {
        state: match[1],
        position: { 
          x: parseFloat(match[2]), 
          y: parseFloat(match[3]), 
          z: parseFloat(match[4]) 
        },
        feed: match[5] ? parseFloat(match[5]) : undefined,
      };
    }
    throw new Error(`Невозможно распарсить статус: ${response}`);
  }

  async getStatus(): Promise<IGrblStatus> {
    const response = await this.sendCommand('?');
    return this.parseGrblStatus(response);
  }

  async home(): Promise<string> {
    return this.sendCommand('$H'); // Команда homing
  }

  async jog(axis: 'X' | 'Y' | 'Z', distance: number, feed: number): Promise<string> {
    if (!['X', 'Y', 'Z'].includes(axis)) {
      throw new Error('Неверная ось: должна быть X, Y или Z');
    }
    return this.sendCommand(`$J=G91 ${axis}${distance} F${feed}`); // Джоггинг в относительных координатах
  }

  async streamGCode(gcodeOrFile: string, isFile: boolean = false): Promise<void> {
    let gcode: string;
    if (isFile) {
      try {
        gcode = await fs.readFile(gcodeOrFile, 'utf8'); // Чтение файла асинхронно
      } catch (err) {
        throw new Error(`Ошибка чтения файла: ${(err as Error).message}`);
      }
    } else {
      gcode = gcodeOrFile;
    }

    const lines = gcode.split('\n')
      .filter(line => line.trim() && !line.startsWith(';')); // Фильтр пустых строк и комментариев
    
    let processed = 0;
    const total = lines.length;
    
    for (const line of lines) {
      const response = await this.sendCommand(line);
      if (response.includes('error') || response.includes('alarm')) {
        throw new Error(`Ошибка при отправке G-code: ${response}`);
      }
      processed++;
      this.emit('jobProgress', { 
        current: processed, 
        total, 
        line,
        percentage: Math.round((processed / total) * 100)
      }); // Событие прогресса
    }
    this.emit('jobComplete');
  }

  async softReset(): Promise<void> {
    await this.sendCommand('\x18'); // Ctrl+X - мягкий сброс GRBL
  }

  async getSettings(): Promise<string[]> {
    const response = await this.sendCommand('$$');
    return response.split('\n').filter(line => line.trim());
  }

  async getInfo(): Promise<string[]> {
    const response = await this.sendCommand('$I');
    return response.split('\n').filter(line => line.trim());
  }

  async checkGCode(gcode: string): Promise<string> {
    await this.sendCommand('$C'); // Войти в режим проверки
    const result = await this.sendCommand(gcode);
    await this.sendCommand('$C'); // Выйти из режима проверки
    return result;
  }
}