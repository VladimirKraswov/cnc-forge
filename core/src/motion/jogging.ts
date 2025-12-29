import { CncController } from '../controller/CncController';
import { JogCommand } from '../types';

/**
 * Класс для управления джоггингом (ручным перемещением)
 */
export class JoggingManager {
  private controller: CncController;
  private jogFeedRate: number = 1000; // Скорость по умолчанию мм/мин

  constructor(controller: CncController, defaultFeedRate: number = 1000) {
    this.controller = controller;
    this.jogFeedRate = defaultFeedRate;
  }

  /**
   * Выполнить джоггинг
   * @param command Команда джоггинга
   * @returns Promise<string> Ответ от станка
   */
  async jog(command: JogCommand): Promise<string> {
    // Валидация параметров
    this.validateJogCommand(command);

    const { axis, distance, feedRate = this.jogFeedRate, relative = true } = command;
    
    // Формируем команду
    const mode = relative ? 'G91' : 'G90'; // Относительный или абсолютный режим
    const jogCommand = `$J=${mode} ${axis.toUpperCase()}${distance} F${feedRate}`;
    
    console.log(`Jogging: ${axis.toUpperCase()} ${distance}mm at ${feedRate}mm/min`);
    
    try {
      const response = await this.controller.sendCommand(jogCommand);
      return response;
    } catch (error) {
      console.error(`Jogging failed:`, error);
      throw error;
    }
  }

  /**
   * Джоггинг по нескольким осям одновременно
   * @param commands Массив команд джоггинга
   * @returns Promise<string[]> Массив ответов
   */
  async jogMultiple(commands: JogCommand[]): Promise<string[]> {
    const responses: string[] = [];
    
    // Проверяем, что все команды в одном режиме (относительном или абсолютном)
    const relativeMode = commands[0]?.relative ?? true;
    if (commands.some(cmd => (cmd.relative ?? true) !== relativeMode)) {
      throw new Error('All jog commands must use the same mode (relative or absolute)');
    }

    const mode = relativeMode ? 'G91' : 'G90';
    let jogCommand = `$J=${mode}`;
    
    // Добавляем перемещения по осям
    for (const cmd of commands) {
      this.validateJogCommand(cmd);
      const feedRate = cmd.feedRate || this.jogFeedRate;
      jogCommand += ` ${cmd.axis.toUpperCase()}${cmd.distance}`;
      
      // Используем feedRate из первой команды
      if (cmd === commands[0]) {
        jogCommand += ` F${feedRate}`;
      }
    }

    console.log(`Multi-axis jogging: ${jogCommand}`);
    
    try {
      const response = await this.controller.sendCommand(jogCommand);
      responses.push(response);
    } catch (error) {
      console.error(`Multi-axis jogging failed:`, error);
      throw error;
    }

    return responses;
  }

  /**
   * Установить скорость джоггинга по умолчанию
   * @param feedRate Скорость в мм/мин
   */
  setDefaultFeedRate(feedRate: number): void {
    if (feedRate <= 0) {
      throw new Error('Feed rate must be positive');
    }
    this.jogFeedRate = feedRate;
    console.log(`Default jog feed rate set to: ${feedRate}mm/min`);
  }

  /**
   * Получить текущую скорость джоггинга
   * @returns number Скорость в мм/мин
   */
  getDefaultFeedRate(): number {
    return this.jogFeedRate;
  }

  /**
   * Валидация команды джоггинга
   * @param command Команда для проверки
   */
  private validateJogCommand(command: JogCommand): void {
    const validAxes = ['x', 'y', 'z', 'a', 'b', 'c'];
    
    if (!validAxes.includes(command.axis.toLowerCase())) {
      throw new Error(`Invalid axis: ${command.axis}. Must be one of: ${validAxes.join(', ')}`);
    }
    
    if (typeof command.distance !== 'number' || isNaN(command.distance)) {
      throw new Error('Distance must be a valid number');
    }
    
    if (command.feedRate && (command.feedRate <= 0 || isNaN(command.feedRate))) {
      throw new Error('Feed rate must be a positive number');
    }
  }

  /**
   * Быстрые команды джоггинга
   */
  async jogX(distance: number, feedRate?: number): Promise<string> {
    return this.jog({ axis: 'x', distance, feedRate });
  }

  async jogY(distance: number, feedRate?: number): Promise<string> {
    return this.jog({ axis: 'y', distance, feedRate });
  }

  async jogZ(distance: number, feedRate?: number): Promise<string> {
    return this.jog({ axis: 'z', distance, feedRate });
  }

  /**
   * Остановить джоггинг (экстренная остановка)
   */
  async stopJog(): Promise<string> {
    console.log('Stopping jog...');
    return this.controller.sendCommand('\x18'); // Ctrl+X - остановка в GRBL
  }
}