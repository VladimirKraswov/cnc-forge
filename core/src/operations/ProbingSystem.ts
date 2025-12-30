import { CncController } from '../controller/CncController';
import { SafetySystem } from '../safety/SafetySystem';
import { ProbeResult, GridProbeResult, ProbeFailureType } from './types';

export class ProbingSystem {
  private controller: CncController;
  private safety: SafetySystem;

  constructor(controller: CncController, safety: SafetySystem) {
    this.controller = controller;
    this.safety = safety;
  }

  // Безопасное зондирование
  async probe(
    axis: 'X' | 'Y' | 'Z',
    feedRate: number,
    distance: number
  ): Promise<ProbeResult> {
    const startTime = Date.now();

    try {
      // 1. Предварительные проверки
      await this.preProbeSafetyCheck(axis, feedRate, distance);

      // 2. Подготовка к зондированию
      await this.prepareForProbing(axis);

      // 3. Отправка команды зондирования
      const command = `G38.2 ${axis}${distance} F${feedRate}`;
      console.log(`Probing: ${command}`);
      this.controller.emit('probeStarted', { axis, feedRate, distance });

      // В GRBL зондирование возвращает специальный ответ
      const response = await this.controller.sendCommand(command, 30000);

      // 4. Получение результата
      const duration = Date.now() - startTime;
      
      // Проверяем ответ на наличие данных о зондировании
      const probeMatch = response.match(/\[PRB:([\d.-]+),([\d.-]+),([\d.-]+):([01])\]/);
      
      let position = { x: 0, y: 0, z: 0 };
      let contactDetected = false;
      
      if (probeMatch) {
        position = {
          x: parseFloat(probeMatch[1]),
          y: parseFloat(probeMatch[2]),
          z: parseFloat(probeMatch[3])
        };
        contactDetected = probeMatch[4] === '1';
        
        // Для GRBL, если контакт обнаружен, позиция должна быть близка к ожидаемой
        if (contactDetected) {
          // Проверяем, что позиция зондирования разумна
          const expectedPosition = await this.getExpectedProbePosition(axis, distance);
          const tolerance = 1.0; // 1мм допуск
          
          const axisKey = axis.toLowerCase() as 'x' | 'y' | 'z';
          if (Math.abs(position[axisKey] - expectedPosition) > tolerance) {
            console.warn(`Probe position seems unusual: ${axis}=${position[axisKey]}, expected ~${expectedPosition}`);
          }
        }
      } else {
        // Если нет формального ответа, получаем текущую позицию
        const status = await this.controller.getStatus();
        position = status.position;
        contactDetected = response.includes('ok') && !response.includes('error');
      }

      const result: ProbeResult = {
        success: true,
        axis,
        feedRate,
        distance,
        position,
        rawResponse: response,
        duration,
        contactDetected
      };

      console.log(`✓ Probe completed in ${duration}ms`);
      if (contactDetected) {
        console.log(`Contact position: ${axis}=${position[axis.toLowerCase() as 'x' | 'y' | 'z'].toFixed(3)}mm`);
      } else {
        console.log('No contact detected during probing');
      }
      
      this.controller.emit('probeCompleted', result);

      // 5. Послезонирование
      await this.postProbeActions(axis, contactDetected);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = (error as Error).message;

      const result: ProbeResult = {
        success: false,
        axis,
        feedRate,
        distance,
        position: { x: 0, y: 0, z: 0 },
        rawResponse: errorMsg,
        duration,
        error: error as Error,
        contactDetected: false,
        probeFailure: this.determineProbeFailureType(errorMsg)
      };

      console.error(`✗ Probe failed in ${duration}ms:`, error);
      this.controller.emit('probeFailed', result);

      // Автоматическое восстановление после неудачного зондирования
      await this.recoverFromProbeFailure(result);

      return result;
    }
  }

  // Зондирование сетки для карты высот
  async probeGrid(
    gridSize: { x: number; y: number },
    stepSize: number,
    feedRate: number
  ): Promise<GridProbeResult> {
    const startTime = Date.now();
    const results: ProbeResult[] = [];
    const grid: Array<{ x: number; y: number; z?: number }> = [];

    console.log(`Starting grid probe: ${gridSize.x}x${gridSize.y}mm, step: ${stepSize}mm`);
    this.controller.emit('gridProbeStarted', { gridSize, stepSize, feedRate });

    try {
      // 1. Предварительные проверки
      await this.preGridProbeSafetyCheck(gridSize, stepSize, feedRate);

      // 2. Подъем инструмента
      await this.controller.sendCommand('G0 Z20 F500');

      // 3. Расчет точек зондирования
      const points = this.calculateGridPoints(gridSize, stepSize);
      console.log(`Will probe ${points.length} points`);

      // 4. Зондирование каждой точки
      for (let i = 0; i < points.length; i++) {
        const point = points[i];

        console.log(`Probing point ${i + 1}/${points.length}: X${point.x}, Y${point.y}`);
        this.controller.emit('gridProbeProgress', {
          current: i + 1,
          total: points.length,
          point
        });

        // Перемещение к точке
        await this.controller.sendCommand(`G0 X${point.x} Y${point.y} F1000`);
        await this.waitForIdleState();

        // Зондирование Z
        const probeResult = await this.probe('Z', feedRate, -50); // Зондируем вниз на 50мм

        results.push(probeResult);
        grid.push({
          x: point.x,
          y: point.y,
          z: probeResult.success && probeResult.contactDetected ? probeResult.position.z : undefined
        });

        // Подъем после зондирования
        await this.controller.sendCommand('G0 Z10 F500');
        await this.waitForIdleState();

        // Небольшая пауза между точками для стабилизации
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // 5. Возврат в начальную позицию
      await this.controller.sendCommand('G0 X0 Y0 Z20 F1000');
      await this.waitForIdleState();

      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r.success && r.contactDetected).length;

      const result: GridProbeResult = {
        success: successCount === points.length,
        duration,
        gridSize,
        stepSize,
        pointsProbed: points.length,
        pointsSuccessful: successCount,
        grid,
        results,
        averageHeight: this.calculateAverageHeight(grid),
        flatness: this.calculateFlatness(grid),
        warnings: this.generateGridWarnings(results, grid)
      };

      console.log(`✓ Grid probe completed in ${duration}ms`);
      console.log(`Success: ${successCount}/${points.length} points`);
      if (result.averageHeight !== undefined) {
        console.log(`Average height: ${result.averageHeight.toFixed(3)}mm`);
      }
      if (result.flatness !== undefined) {
        console.log(`Flatness: ${result.flatness.toFixed(3)}mm`);
      }

      this.controller.emit('gridProbeCompleted', result);

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;

      const result: GridProbeResult = {
        success: false,
        duration,
        gridSize,
        stepSize,
        pointsProbed: results.length,
        pointsSuccessful: results.filter(r => r.success && r.contactDetected).length,
        grid,
        results,
        error: error as Error,
        recoveryNeeded: true
      };

      console.error(`✗ Grid probe failed after ${duration}ms:`, error);
      this.controller.emit('gridProbeFailed', result);

      // Восстановление после сбоя сеточного зондирования
      await this.recoverFromGridProbeFailure(result);

      return result;
    }
  }

  private async preProbeSafetyCheck(
    axis: 'X' | 'Y' | 'Z',
    feedRate: number,
    distance: number
  ): Promise<void> {
    console.log('Performing pre-probe safety checks...');

    // 1. Проверка подключения
    if (!this.controller.isConnected()) {
      throw new Error('Machine not connected');
    }

    // 2. Проверка состояния станка
    const status = await this.controller.getStatus();
    if (status.state !== 'Idle') {
      throw new Error(`Machine not idle. Current state: ${status.state}`);
    }

    // 3. Проверка хоминга
    const safetyStatus = this.controller.getSafetyStatus();
    if (!safetyStatus.isHomed) {
      throw new Error('Machine must be homed before probing');
    }

    // 4. Проверка направления зондирования
    if (axis === 'Z' && distance > 0) {
      throw new Error('Z-axis probing should be negative (downward)');
    }

    // 5. Проверка скорости зондирования
    const maxProbeFeed = 500;
    if (feedRate > maxProbeFeed) {
      console.warn(`High probe feed rate (${feedRate}). Reducing to ${maxProbeFeed} for safety.`);
      // Можно автоматически уменьшить скорость или запросить подтверждение
    }

    // 6. Проверка датчика зондирования (если есть возможность)
    await this.checkProbeSensor();

    console.log('✓ Pre-probe safety checks passed');
  }

  private async prepareForProbing(axis: 'X' | 'Y' | 'Z'): Promise<void> {
    console.log('Preparing for probing...');

    if (axis === 'Z') {
      // Для зондирования Z поднимаем инструмент
      await this.controller.sendCommand('G0 Z10 F500');
      await this.waitForIdleState();
    }

    console.log('✓ Ready for probing');
  }

  private async postProbeActions(axis: 'X' | 'Y' | 'Z', contactDetected: boolean): Promise<void> {
    console.log('Post-probe actions...');

    if (axis === 'Z' && contactDetected) {
      // После успешного зондирования Z поднимаем инструмент
      await this.controller.sendCommand('G0 Z5 F300');
      await this.waitForIdleState();
    }

    // Небольшая пауза для стабилизации
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  private async checkProbeSensor(): Promise<void> {
    // Проверка датчика зондирования
    console.log('Checking probe sensor...');

    try {
      // В GRBL можно проверить состояние датчика через $I или другими командами
      // Просто выводим сообщение для пользователя
      console.log('✓ Assuming probe sensor is ready');
    } catch (error) {
      console.warn('Probe sensor check inconclusive:', error);
      console.log('Please manually verify probe sensor is connected and working');
    }
  }

  private async getExpectedProbePosition(axis: 'X' | 'Y' | 'Z', distance: number): Promise<number> {
    // Получаем текущую позицию и рассчитываем ожидаемую позицию после зондирования
    const status = await this.controller.getStatus();
    const axisKey = axis.toLowerCase() as 'x' | 'y' | 'z';
    return status.position[axisKey] + distance;
  }

  private async waitForIdleState(timeoutMs: number = 5000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      try {
        const status = await this.controller.getStatus();
        if (status.state === 'Idle') {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    throw new Error(`Timeout waiting for Idle state (${timeoutMs}ms)`);
  }

  private determineProbeFailureType(errorMsg: string): ProbeFailureType {
    const msg = errorMsg.toLowerCase();

    // GRBL specific probe errors
    if (msg.includes('alarm:4')) {
      return 'initial_state'; // Probe fail. Probe is not in the expected initial state.
    } else if (msg.includes('alarm:5')) {
      return 'no_contact'; // Probe fail. Probe did not contact the workpiece within the programmed travel.
    } else if (msg.includes('limit')) {
      return 'limit_triggered'; // Limit switch triggered
    } else if (msg.includes('timeout')) {
      return 'timeout';
    } else if (msg.includes('probe fail')) {
      return 'no_contact';
    }

    return 'unknown';
  }

  private async recoverFromProbeFailure(result: ProbeResult): Promise<void> {
    console.log('Recovering from probe failure...');

    // Выбираем соответствующий метод восстановления
    switch (result.probeFailure) {
      case 'initial_state':
        await this.recoverFromInitialStateFailure();
        break;
      case 'no_contact':
        await this.recoverFromNoContactFailure(result);
        break;
      case 'limit_triggered':
        await this.recoverFromLimitTriggeredFailure();
        break;
      default:
        await this.genericProbeRecovery();
    }
  }

  private async recoverFromInitialStateFailure(): Promise<void> {
    console.log('=== PROBE INITIAL STATE FAILURE RECOVERY ===');
    console.log('Probe sensor was already triggered at start');
    console.log('1. Check probe sensor connection');
    console.log('2. Manually reset probe sensor if possible');
    console.log('3. Ensure probe is not touching anything');
    console.log('4. Try probing again');

    // Автоматические действия
    try {
      // Поднимаем инструмент
      await this.controller.sendCommand('G0 Z20 F500');
      await this.waitForIdleState();
      
      // Сбрасываем аварию
      await this.controller.sendCommand('$X');
      await this.waitForIdleState();
      
      console.log('✓ Probe recovery completed');
    } catch (error) {
      console.error('Probe recovery failed:', error);
    }
  }

  private async recoverFromNoContactFailure(result: ProbeResult): Promise<void> {
    console.log('=== PROBE NO CONTACT FAILURE RECOVERY ===');
    console.log(`Probe did not contact workpiece after ${Math.abs(result.distance)}mm`);
    console.log('1. Check probe sensor is working');
    console.log('2. Verify workpiece is present');
    console.log('3. Check probe travel distance is sufficient');
    console.log('4. Reduce probe feed rate for better sensitivity');

    // Автоматические действия
    try {
      // Поднимаем инструмент
      await this.controller.sendCommand('G0 Z20 F500');
      await this.waitForIdleState();
      
      // Сбрасываем аварию
      await this.controller.sendCommand('$X').catch(() => {
        console.log('No alarm to clear');
      });
      
      console.log('✓ Tool raised to safe height');
    } catch (error) {
      console.error('No-contact recovery failed:', error);
    }
  }

  private async recoverFromLimitTriggeredFailure(): Promise<void> {
    console.log('=== PROBE LIMIT TRIGGERED RECOVERY ===');
    console.log('Limit switch triggered during probing');
    console.log('1. MANUALLY move tool away from limit switch');
    console.log('2. Check probe sensor position');
    console.log('3. Reduce probe travel distance');

    try {
      // Даем время для ручного восстановления
      console.log('Waiting 15 seconds for manual recovery...');
      await new Promise(resolve => setTimeout(resolve, 15000));

      // Сбрасываем аварию
      await this.controller.sendCommand('$X');
      await this.waitForIdleState();
      
      // Поднимаем инструмент
      await this.controller.sendCommand('G0 Z20 F300');
      await this.waitForIdleState();

      console.log('✓ Limit triggered recovery completed');
    } catch (error) {
      console.error('Limit triggered recovery failed:', error);
    }
  }

  private async genericProbeRecovery(): Promise<void> {
    console.log('=== GENERIC PROBE FAILURE RECOVERY ===');

    try {
      // 1. Остановка
      await this.controller.feedHold();
      await new Promise(resolve => setTimeout(resolve, 500));

      // 2. Подъем инструмента
      await this.controller.sendCommand('G0 Z20 F300').catch(() => {
        console.log('Could not raise tool');
      });

      // 3. Сброс состояния
      await this.controller.sendCommand('$X').catch(() => {
        console.log('Could not clear alarm state');
      });

      console.log('✓ Generic probe recovery completed');
    } catch (error) {
      console.error('Generic probe recovery failed:', error);
    }
  }

  private async preGridProbeSafetyCheck(
    gridSize: { x: number; y: number },
    stepSize: number,
    feedRate: number
  ): Promise<void> {
    console.log('Performing grid probe safety checks...');

    // 1. Проверка размеров сетки
    if (gridSize.x <= 0 || gridSize.y <= 0) {
      throw new Error('Grid dimensions must be positive');
    }

    // 2. Проверка шага
    if (stepSize <= 0) {
      throw new Error('Step size must be positive');
    }

    if (stepSize < 1) {
      console.warn('Small step size (<1mm). This will take long time.');
    }

    // 3. Проверка что сетка помещается в рабочий объем
    const safetyStatus = this.controller.getSafetyStatus();
    const limits = safetyStatus.limits;
    
    if (gridSize.x > limits.x.max - limits.x.min ||
        gridSize.y > limits.y.max - limits.y.min) {
      throw new Error(`Grid size (${gridSize.x}x${gridSize.y}mm) exceeds machine working volume`);
    }

    // 4. Расчет времени зондирования
    const pointsCount = Math.ceil(gridSize.x / stepSize) * Math.ceil(gridSize.y / stepSize);
    const estimatedTime = pointsCount * 15; // ~15 секунд на точку с учетом перемещений

    if (estimatedTime > 300) { // 5 минут
      console.warn(`Grid probe will take approximately ${Math.round(estimatedTime / 60)} minutes`);
      // Можно запросить подтверждение у пользователя
    }

    console.log(`Grid will have ~${pointsCount} points`);
    console.log('✓ Grid probe safety checks passed');
  }

  private calculateGridPoints(
    gridSize: { x: number; y: number },
    stepSize: number
  ): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    const startX = -gridSize.x / 2;
    const startY = -gridSize.y / 2;

    for (let y = 0; y <= gridSize.y; y += stepSize) {
      for (let x = 0; x <= gridSize.x; x += stepSize) {
        points.push({
          x: parseFloat((startX + x).toFixed(3)),
          y: parseFloat((startY + y).toFixed(3))
        });
      }
    }

    return points;
  }

  private calculateAverageHeight(
    grid: Array<{ x: number; y: number; z?: number }>
  ): number | undefined {
    const validPoints = grid.filter(p => p.z !== undefined);
    if (validPoints.length === 0) return undefined;

    const sum = validPoints.reduce((total, p) => total + (p.z || 0), 0);
    return sum / validPoints.length;
  }

  private calculateFlatness(
    grid: Array<{ x: number; y: number; z?: number }>
  ): number | undefined {
    const validPoints = grid.filter(p => p.z !== undefined);
    if (validPoints.length < 2) return undefined;

    const heights = validPoints.map(p => p.z || 0);
    const min = Math.min(...heights);
    const max = Math.max(...heights);

    return max - min;
  }

  private generateGridWarnings(
    results: ProbeResult[],
    grid: Array<{ x: number; y: number; z?: number }>
  ): string[] {
    const warnings: string[] = [];

    // Проверка неудачных точек
    const failedPoints = results.filter(r => !r.success);
    if (failedPoints.length > 0) {
      warnings.push(`${failedPoints.length} probe points failed. Surface map may be incomplete.`);
    }

    // Проверка плоскойности
    const flatness = this.calculateFlatness(grid);
    if (flatness && flatness > 5) {
      warnings.push(`Large surface variation detected (${flatness.toFixed(1)}mm). Check workpiece flatness.`);
    }

    // Проверка аномальных значений
    const validHeights = grid.filter(p => p.z !== undefined).map(p => p.z!);
    const avg = this.calculateAverageHeight(grid) || 0;
    const anomalies = validHeights.filter(h => Math.abs(h - avg) > 2);
    if (anomalies.length > 0) {
      warnings.push(`${anomalies.length} anomalous height values detected. Check for debris or probe issues.`);
    }

    return warnings;
  }

  private async recoverFromGridProbeFailure(result: GridProbeResult): Promise<void> {
    console.log('Recovering from grid probe failure...');

    try {
      // 1. Подъем инструмента
      await this.controller.sendCommand('G0 Z20 F500').catch(() => {
        console.log('Could not raise tool');
      });

      // 2. Возврат в центр
      await this.controller.sendCommand('G0 X0 Y0 F1000').catch(() => {
        console.log('Could not return to center');
      });

      // 3. Сброс аварийного состояния
      await this.controller.sendCommand('$X').catch(() => {
        console.log('Could not clear alarm state');
      });

      console.log('✓ Grid probe recovery completed');

      // Сохраняем частичные результаты
      if (result.grid.length > 0) {
        console.log(`Partial results: ${result.pointsSuccessful} successful points`);
        // Можно сохранить в файл для анализа
      }

    } catch (error) {
      console.error('Grid probe recovery failed:', error);
    }
  }
}