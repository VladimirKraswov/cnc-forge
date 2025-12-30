import { CncController } from '../controller/CncController';
import { SafetySystem } from '../safety/SafetySystem';
import { JogResult } from './types';

export class JoggingSystem {
  private controller: CncController;
  private safety: SafetySystem;
  private isJogging: boolean = false;
  private currentJogCommand: string | null = null;

  constructor(controller: CncController, safety: SafetySystem) {
    this.controller = controller;
    this.safety = safety;
  }

  // Безопасный джогинг
  async jog(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): Promise<JogResult> {
    const startTime = Date.now();

    try {
      // Проверяем, что джоггинг еще не выполняется
      if (this.isJogging) {
        throw new Error('Jogging is already in progress. Wait for current jog to complete or use emergency stop.');
      }

      // 1. Проверка безопасности
      await this.preJogSafetyCheck(axes, feed);

      // 2. Построение команды джогинга
      const command = this.buildJogCommand(axes, feed);

      // 3. Проверка команды
      const safetyCheck = this.safety.validateCommand(command);
      if (!safetyCheck.isValid) {
        throw new Error(`Jog safety check failed: ${safetyCheck.error}`);
      }

      if (safetyCheck.warning) {
        console.warn(`Jog warning: ${safetyCheck.warning}`);
        this.controller.emit('jogWarning', safetyCheck.warning);
      }

      // 4. Отправка команды
      console.log(`Jog: ${command}`);
      this.controller.emit('jogStarted', { axes, feed });

      this.isJogging = true;
      this.currentJogCommand = command;
      
      // В GRBL джоггинг выполняется через $J= команду
      // Таймаут зависит от расстояния и скорости
      const estimatedTime = this.calculateEstimatedJogTime(axes, feed);
      const timeout = Math.max(estimatedTime * 2, 10000); // Минимум 10 секунд
      
      const response = await this.controller.sendCommand(command, timeout);
      
      this.isJogging = false;
      this.currentJogCommand = null;

      const duration = Date.now() - startTime;
      const result: JogResult = {
        success: true,
        duration,
        axes: this.getActiveAxes(axes),
        distance: axes,
        feed,
        response
      };

      console.log(`✓ Jog completed in ${duration}ms`);
      this.controller.emit('jogCompleted', result);

      return result;

    } catch (error) {
      this.isJogging = false;
      this.currentJogCommand = null;
      const duration = Date.now() - startTime;

      const result: JogResult = {
        success: false,
        duration,
        axes: this.getActiveAxes(axes),
        distance: axes,
        feed,
        error: error as Error,
        recoveryNeeded: this.shouldRecoverFromJogError(error as Error)
      };

      console.error(`✗ Jog failed in ${duration}ms:`, error);
      this.controller.emit('jogFailed', result);

      // Автоматическое восстановление после ошибки джогинга
      if (result.recoveryNeeded) {
        await this.recoverFromJogError(error as Error);
      }

      return result;
    }
  }

  // Аварийная остановка джогинга
  async emergencyStopJog(): Promise<void> {
    console.log('Emergency jog stop');
    
    if (!this.isJogging) {
      console.log('No jog in progress');
      return;
    }
    
    this.isJogging = false;
    this.currentJogCommand = null;

    // В GRBL аварийная остановка - это мягкий сброс (Ctrl-X или 0x18)
    await this.controller.emergencyStop();

    this.controller.emit('jogEmergencyStop');
  }

  private async preJogSafetyCheck(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): Promise<void> {
    console.log('Performing pre-jog safety checks...');

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
      console.warn('Machine not homed. Jogging without homing can be dangerous.');
      // Можно запросить подтверждение у пользователя
    }

    // 4. Проверка скорости
    const maxFeed = 5000; // Максимальная безопасная скорость
    if (feed > maxFeed) {
      throw new Error(`Feed rate ${feed} exceeds maximum safe rate ${maxFeed}`);
    }

    // 5. Проверка что движение не выйдет за пределы рабочей зоны
    const currentPos = await this.controller.getStatus();
    const limits = this.safety.getSoftLimits ? this.safety.getSoftLimits() : safetyStatus.limits;
    
    for (const axis of ['x', 'y', 'z'] as const) {
      const distance = axes[axis];
      if (distance !== undefined) {
        const newPos = currentPos.position[axis] + distance;
        
        if (newPos < limits[axis].min || newPos > limits[axis].max) {
          throw new Error(`Jog would move ${axis.toUpperCase()} to ${newPos}mm, which is outside soft limits (${limits[axis].min} to ${limits[axis].max}mm)`);
        }
      }
    }

    console.log('✓ Pre-jog safety checks passed');
  }

  private buildJogCommand(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): string {
    const axisCommands: string[] = [];

    // Для GRBL требуется указать только оси, которые двигаются
    // Не указываем оси с нулевым перемещением
    if (axes.x !== undefined && axes.x !== 0) {
      axisCommands.push(`X${axes.x}`);
    }
    if (axes.y !== undefined && axes.y !== 0) {
      axisCommands.push(`Y${axes.y}`);
    }
    if (axes.z !== undefined && axes.z !== 0) {
      axisCommands.push(`Z${axes.z}`);
    }

    if (axisCommands.length === 0) {
      throw new Error('No movement specified for jogging');
    }

    // Команда джоггинга в GRBL: $J=G91 X.. Y.. Z.. F..
    return `$J=G91 ${axisCommands.join(' ')} F${feed}`;
  }

  private getActiveAxes(axes: { x?: number; y?: number; z?: number }): string[] {
    return Object.entries(axes)
      .filter(([_, value]) => value !== undefined && value !== 0)
      .map(([key]) => key);
  }

  private calculateEstimatedJogTime(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): number {
    // Рассчитываем максимальное расстояние (по теореме Пифагора для многомерного движения)
    const distances = Object.values(axes).filter(d => d !== undefined) as number[];
    const maxDistance = Math.max(...distances.map(Math.abs));
    
    // Время = расстояние / скорость (в мм/мин, переводим в мм/сек)
    const feedPerSecond = feed / 60;
    const estimatedTime = maxDistance / feedPerSecond * 1000; // в миллисекундах
    
    // Добавляем запас на ускорение/замедление
    return estimatedTime * 1.5;
  }

  private shouldRecoverFromJogError(error: Error): boolean {
    const errorMsg = error.message.toLowerCase();

    // Ошибки, требующие восстановления
    const recoveryErrors = [
      'alarm',
      'limit',
      'crash',
      'stall',
      'error'
    ];

    return recoveryErrors.some(re => errorMsg.includes(re));
  }

  private async recoverFromJogError(error: Error): Promise<void> {
    console.log('Recovering from jog error...');

    const errorMsg = error.message.toLowerCase();

    if (errorMsg.includes('limit')) {
      console.log('Limit switch triggered during jog');
      await this.recoverFromLimitTrigger();
    } else if (errorMsg.includes('alarm')) {
      console.log('Alarm during jog');
      await this.recoverFromAlarm();
    } else {
      console.log('Generic jog error recovery');
      await this.genericJogRecovery();
    }
  }

  private async recoverFromLimitTrigger(): Promise<void> {
    console.log('=== LIMIT SWITCH RECOVERY PROCEDURE ===');
    console.log('1. DO NOT try to move machine with software!');
    console.log('2. Manually move carriage away from limit switch');
    console.log('3. Clear alarm with $X command');
    console.log('4. Re-home affected axis');

    try {
      // Даем время пользователю для ручного отведения
      console.log('Waiting 10 seconds for manual recovery...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Сбрасываем аварию
      await this.controller.sendCommand('$X');
      console.log('✓ Alarm cleared');

    } catch (error) {
      console.error('Failed to recover from limit switch:', error);
      console.log('Manual intervention required');
    }
  }

  private async recoverFromAlarm(): Promise<void> {
    // Восстановление после аварии
    try {
      await this.controller.softReset();
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Проверяем состояние
      const status = await this.controller.getStatus();
      console.log(`Machine state after recovery: ${status.state}`);
    } catch (error) {
      console.error('Failed to recover from alarm:', error);
      console.log('Try manual recovery with $X command');
    }
  }

  private async genericJogRecovery(): Promise<void> {
    // Общая процедура восстановления
    try {
      // 1. Остановка
      await this.controller.feedHold();
      await new Promise(resolve => setTimeout(resolve, 500));

      // 2. Подъем Z для безопасности (если Z не был затронут)
      const status = await this.controller.getStatus().catch(() => null);
      if (status && status.position.z < 20) {
        await this.controller.sendCommand('G0 Z20 F300').catch(() => {
          console.warn('Could not raise Z axis');
        });
      }

      // 3. Сброс состояния
      await this.controller.sendCommand('$X').catch(() => {
        console.warn('Could not clear alarm state');
      });

      console.log('✓ Generic jog recovery completed');
    } catch (error) {
      console.error('Generic jog recovery failed:', error);
    }
  }

  isCurrentlyJogging(): boolean {
    return this.isJogging;
  }

  getCurrentJogCommand(): string | null {
    return this.currentJogCommand;
  }
}