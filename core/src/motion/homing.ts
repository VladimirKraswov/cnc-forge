import { CncController } from '../controller/CncController';
import { HomeCommand } from '../types';

/**
 * Класс для управления процедурой референса (homing)
 */
export class HomingManager {
  private controller: CncController;

  constructor(controller: CncController) {
    this.controller = controller;
  }

  /**
   * Выполнить процедуру референса для указанных осей
   * @param command Конфигурация homing
   * @returns Promise<string[]> Массив ответов от станка
   */
  async executeHoming(command: HomeCommand = {}): Promise<string[]> {
    const responses: string[] = [];
    
    // Определяем оси для референса
    const axes = command.axes || ['x', 'y', 'z'];
    const sequence = command.sequence || 'zxy'; // Стандартная последовательность: Z, потом X, потом Y

    console.log(`Starting homing sequence: ${sequence}, axes: ${axes.join(', ')}`);

    // Выполняем референс в указанной последовательности
    for (const axisLetter of sequence) {
      const axis = axisLetter.toLowerCase();
      
      if (axes.includes(axis as any)) {
        try {
          // Проверяем, поддерживается ли команда $H для этой оси
          // В GRBL обычно $H для всех осей сразу, но можно адаптировать
          const response = await this.controller.sendCommand('$H');
          responses.push(response);
          console.log(`Homing for axis ${axis.toUpperCase()} completed`);
          
          // Небольшая пауза между осями
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.error(`Homing failed for axis ${axis.toUpperCase()}:`, error);
          throw error;
        }
      }
    }

    return responses;
  }

  /**
   * Проверить, выполнено ли референсирование всех осей
   * @returns Promise<boolean>
   */
  async isHomed(): Promise<boolean> {
    try {
      const status = await this.controller.getStatus();
      // В GRBL статус 'Home' означает что референс выполнен
      return status.state.toLowerCase().includes('home') || 
             status.state.toLowerCase().includes('idle');
    } catch (error) {
      console.error('Error checking homing status:', error);
      return false;
    }
  }

  /**
   * Выполнить референс только если он еще не был выполнен
   * @returns Promise<boolean> true если референс был выполнен
   */
  async homeIfNeeded(): Promise<boolean> {
    const isHomed = await this.isHomed();
    
    if (!isHomed) {
      console.log('Machine not homed, starting homing procedure...');
      await this.executeHoming();
      return true;
    }
    
    console.log('Machine already homed');
    return false;
  }

  /**
   * Установить нулевую точку (set home position)
   * @param axes Оси для установки нуля
   */
  async setHomePosition(axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']): Promise<void> {
    for (const axis of axes) {
      await this.controller.sendCommand(`G92 ${axis.toUpperCase()}0`);
    }
    console.log(`Home position set for axes: ${axes.join(', ')}`);
  }

  /**
   * Переместиться в нулевую точку
   * @param feedRate Скорость перемещения
   */
  async goToHome(feedRate: number = 1000): Promise<void> {
    try {
      // Используем абсолютные координаты для перемещения в нулевую точку
      await this.controller.sendCommand(`G90 G1 X0 Y0 Z0 F${feedRate}`);
      console.log('Moved to home position');
    } catch (error) {
      console.error('Error moving to home:', error);
      throw error;
    }
  }
}