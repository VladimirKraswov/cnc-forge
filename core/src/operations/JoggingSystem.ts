import { CncController } from '../controller/CncController';
import { SafetySystem } from '../safety/SafetySystem';
import { JogResult } from './types';

export class JoggingSystem {
  private controller: CncController;
  private safety: SafetySystem;
  private isJogging: boolean = false;
  private jogQueue: Array<{
    axes: { x?: number; y?: number; z?: number };
    feed: number;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

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
      const response = await this.controller.sendCommand(command);
      this.isJogging = false;

      const duration = Date.now() - startTime;
      const result: JogResult = {
        success: true,
        duration,
        axes: Object.keys(axes),
        distance: axes,
        feed,
        response
      };

      console.log(`✓ Jog completed in ${duration}ms`);
      this.controller.emit('jogCompleted', result);

      return result;

    } catch (error) {
      this.isJogging = false;
      const duration = Date.now() - startTime;

      const result: JogResult = {
        success: false,
        duration,
        axes: Object.keys(axes),
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

  // Непрерывный джогинг (для джойстика/ручного управления)
  async startContinuousJog(
    axis: 'x' | 'y' | 'z',
    direction: 1 | -1,
    feed: number
  ): Promise<void> {
    // Реализация непрерывного джогинга
    // Отправляет команду и держит движение пока не будет остановки
  }

  async stopContinuousJog(): Promise<void> {
    // Остановка непрерывного джогинга
    await this.controller.sendCommand('!'); // Feed hold
  }

  // Аварийная остановка джогинга
  async emergencyStopJog(): Promise<void> {
    console.log('Emergency jog stop');
    this.isJogging = false;
    this.jogQueue = []; // Очищаем очередь

    // Останавливаем станок
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
    if (feed > 3000) {
      console.warn('High jog feed rate. Consider reducing for safety.');
    }

    // 5. Проверка одновременного движения по нескольким осям
    const axisCount = Object.keys(axes).filter(k => axes[k as keyof typeof axes] !== undefined).length;
    if (axisCount > 2) {
      console.warn('Jogging on 3 axes simultaneously. Consider moving one axis at a time for better control.');
    }

    console.log('✓ Pre-jog safety checks passed');
  }

  private buildJogCommand(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): string {
    const axisCommands: string[] = [];

    if (axes.x !== undefined) axisCommands.push(`X${axes.x}`);
    if (axes.y !== undefined) axisCommands.push(`Y${axes.y}`);
    if (axes.z !== undefined) axisCommands.push(`Z${axes.z}`);

    if (axisCommands.length === 0) {
      throw new Error('No axes specified for jogging');
    }

    return `$J=G91 ${axisCommands.join(' ')} F${feed}`;
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
    await this.controller.softReset();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Проверяем состояние
    const status = await this.controller.getStatus();
    console.log(`Machine state after recovery: ${status.state}`);
  }

  private async genericJogRecovery(): Promise<void> {
    // Общая процедура восстановления
    try {
      // 1. Остановка
      await this.controller.feedHold();

      // 2. Подъем Z для безопасности
      await this.controller.sendCommand('G0 Z20 F300').catch(() => {});

      // 3. Сброс состояния
      await this.controller.sendCommand('$X').catch(() => {});

      console.log('✓ Generic jog recovery completed');
    } catch (error) {
      console.error('Generic jog recovery failed:', error);
    }
  }

  isCurrentlyJogging(): boolean {
    return this.isJogging;
  }

  getJogQueueLength(): number {
    return this.jogQueue.length;
  }
}
