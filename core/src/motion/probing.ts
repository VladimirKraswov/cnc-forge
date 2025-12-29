import { CncController } from '../controller/CncController';
import { ProbeCommand } from '../types';

/**
 * Класс для управления процедурой probing (зондирование)
 */
export class ProbingManager {
  private controller: CncController;
  private probeResults: Map<string, number> = new Map();

  constructor(controller: CncController) {
    this.controller = controller;
  }

  /**
   * Выполнить зондирование
   * @param command Команда зондирования
   * @returns Promise<number> Позиция срабатывания датчика
   */
  async probe(command: ProbeCommand): Promise<number> {
    this.validateProbeCommand(command);

    const { axis, direction, feedRate, maxDistance } = command;
    const axisUpper = axis.toUpperCase();
    
    // Сохраняем текущую позицию
    const initialStatus = await this.controller.getStatus();
    const initialPosition = initialStatus.position[axis];
    
    // Формируем команду зондирования
    const directionSign = direction === 'positive' ? '' : '-';
    const probeCommand = `G38.2 ${axisUpper}${directionSign}${maxDistance} F${feedRate}`;
    
    console.log(`Probing ${axisUpper}-axis in ${direction} direction at ${feedRate}mm/min`);
    
    try {
      const response = await this.controller.sendCommand(probeCommand);
      
      // Получаем позицию после зондирования
      const finalStatus = await this.controller.getStatus();
      const probePosition = finalStatus.position[axis];
      
      // Сохраняем результат
      const resultKey = `${axis}_${direction}`;
      this.probeResults.set(resultKey, probePosition);
      
      console.log(`Probing successful. Trigger position: ${probePosition}mm`);
      console.log(`Traveled: ${Math.abs(probePosition - initialPosition)}mm`);
      
      return probePosition;
      
    } catch (error) {
      // Проверяем, это ошибка срабатывания датчика или другая ошибка
      const errorMessage = (error as Error).message;
      
      if (errorMessage.includes('error:1') || errorMessage.includes('probe fail')) {
        // Датчик не сработал в пределах maxDistance
        console.warn(`Probe did not trigger within ${maxDistance}mm`);
        throw new Error(`Probe failed to trigger within specified distance`);
      }
      
      console.error(`Probing failed:`, error);
      throw error;
    }
  }

  /**
   * Автоматическое определение нулевой точки детали
   * @param feedRate Скорость зондирования
   * @param clearance Зазор для отхода после зондирования
   * @returns Promise<{x: number, y: number, z: number}>
   */
  async findWorkZero(
    feedRate: number = 100,
    clearance: number = 5
  ): Promise<{ x: number; y: number; z: number }> {
    console.log('Starting work zero probing procedure...');
    
    const zeroPoint = { x: 0, y: 0, z: 0 };
    
    try {
      // Зондирование по Z (сверху вниз)
      console.log('Probing Z-axis...');
      const zProbe = await this.probe({
        axis: 'z',
        direction: 'negative',
        feedRate,
        maxDistance: 50
      });
      zeroPoint.z = zProbe;
      
      // Поднимаемся на clearance мм
      await this.controller.sendCommand(`G91 G0 Z${clearance}`);
      await this.controller.sendCommand('G90');
      
      // Зондирование по X (слева направо)
      console.log('Probing X-axis...');
      const xProbeLeft = await this.probe({
        axis: 'x',
        direction: 'positive',
        feedRate,
        maxDistance: 100
      });
      
      // Отходим и зондируем с другой стороны
      await this.controller.sendCommand(`G91 G0 X-${clearance}`);
      await this.controller.sendCommand('G90');
      
      const xProbeRight = await this.probe({
        axis: 'x',
        direction: 'negative',
        feedRate,
        maxDistance: 100
      });
      
      // Вычисляем середину по X
      zeroPoint.x = (xProbeLeft + xProbeRight) / 2;
      
      // Возвращаемся к середине по X
      await this.controller.sendCommand(`G90 G0 X${zeroPoint.x}`);
      
      // Зондирование по Y
      console.log('Probing Y-axis...');
      const yProbeFront = await this.probe({
        axis: 'y',
        direction: 'positive',
        feedRate,
        maxDistance: 100
      });
      
      await this.controller.sendCommand(`G91 G0 Y-${clearance}`);
      await this.controller.sendCommand('G90');
      
      const yProbeBack = await this.probe({
        axis: 'y',
        direction: 'negative',
        feedRate,
        maxDistance: 100
      });
      
      zeroPoint.y = (yProbeFront + yProbeBack) / 2;
      
      // Устанавливаем нулевую точку
      await this.controller.sendCommand(`G92 X0 Y0 Z0`);
      
      // Поднимаемся на безопасную высоту
      await this.controller.sendCommand(`G91 G0 Z${clearance}`);
      await this.controller.sendCommand('G90');
      
      console.log(`Work zero established at: X=${zeroPoint.x.toFixed(3)}, Y=${zeroPoint.y.toFixed(3)}, Z=${zeroPoint.z.toFixed(3)}`);
      
      return zeroPoint;
      
    } catch (error) {
      console.error('Failed to establish work zero:', error);
      throw error;
    }
  }

  /**
   * Получить сохраненные результаты зондирования
   * @param axis Ось (опционально)
   * @param direction Направление (опционально)
   * @returns number | Map<string, number> | undefined
   */
  getProbeResults(axis?: string, direction?: string): number | Map<string, number> | undefined {
    if (axis && direction) {
      const key = `${axis}_${direction}`;
      return this.probeResults.get(key);
    } else if (axis) {
      // Возвращаем все результаты для указанной оси
      const results = new Map();
      for (const [key, value] of this.probeResults) {
        if (key.startsWith(`${axis}_`)) {
          results.set(key, value);
        }
      }
      return results;
    }
    
    // Возвращаем все результаты
    return new Map(this.probeResults);
  }

  /**
   * Очистить сохраненные результаты зондирования
   */
  clearProbeResults(): void {
    this.probeResults.clear();
    console.log('Probe results cleared');
  }

  /**
   * Валидация команды зондирования
   * @param command Команда для проверки
   */
  private validateProbeCommand(command: ProbeCommand): void {
    const validAxes = ['x', 'y', 'z'];
    const validDirections = ['positive', 'negative'];
    
    if (!validAxes.includes(command.axis.toLowerCase())) {
      throw new Error(`Invalid axis: ${command.axis}. Must be one of: ${validAxes.join(', ')}`);
    }
    
    if (!validDirections.includes(command.direction)) {
      throw new Error(`Invalid direction: ${command.direction}. Must be 'positive' or 'negative'`);
    }
    
    if (command.feedRate <= 0 || isNaN(command.feedRate)) {
      throw new Error('Feed rate must be a positive number');
    }
    
    if (command.maxDistance <= 0 || isNaN(command.maxDistance)) {
      throw new Error('Max distance must be a positive number');
    }
  }

  /**
   * Проверить состояние датчика
   * @returns Promise<boolean> true если датчик сработал
   */
  async checkProbeStatus(): Promise<boolean> {
    try {
      // В GRBL можно проверить состояние пинов
      const status = await this.controller.getStatus();
      // Здесь нужно парсить статус для получения состояния датчика
      // Это зависит от реализации GRBL
      console.log('Probe status check not fully implemented');
      return false;
    } catch (error) {
      console.error('Error checking probe status:', error);
      return false;
    }
  }
}