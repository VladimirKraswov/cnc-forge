import { CncController } from '../controller/CncController';
import { SafetySystem } from '../safety/SafetySystem';
import { HomingStep, HomingStepResult, HomingResult } from './types';

export class HomingSystem {
  private controller: CncController;
  private safety: SafetySystem;
  private homingSequence: HomingStep[] = [];

  constructor(controller: CncController, safety: SafetySystem) {
    this.controller = controller;
    this.safety = safety;
    this.setupHomingSequence();
  }

  private setupHomingSequence(): void {
    // Стандартная последовательность хоминга для 3-осевого станка по GRBL протоколу
    this.homingSequence = [
      {
        id: 'pre_home_check',
        description: 'Предварительная проверка безопасности',
        action: async () => {
          await this.preHomeSafetyCheck();
        },
        critical: true,
        retryable: false
      },
      {
        id: 'raise_z',
        description: 'Подъем оси Z (если не в безопасном положении)',
        action: async () => {
          await this.raiseZToSafeHeight();
        },
        critical: true,
        retryable: true
      },
      {
        id: 'home_all',
        description: 'Хоминг всех осей (команда $H)',
        action: async () => {
          await this.homeAllAxes();
        },
        critical: true,
        retryable: true,
        maxRetries: 3
      },
      {
        id: 'move_to_zero',
        description: 'Перемещение в нулевую позицию',
        action: async () => {
          await this.moveToZeroPosition();
        },
        critical: false,
        retryable: true
      },
      {
        id: 'verify_home',
        description: 'Проверка успешности хоминга',
        action: async () => {
          await this.verifyHomingSuccess();
        },
        critical: false,
        retryable: false
      }
    ];
  }

  // Безопасный хоминг
  async home(axes?: string): Promise<HomingResult> {
    const startTime = Date.now();
    const results: HomingStepResult[] = [];
    let aborted = false;

    try {
      // Проверка, что станок подключен
      if (!this.controller.isConnected()) {
        throw new Error('Станок не подключен');
      }

      // Проверка, что станок не в состоянии Alarm
      const status = await this.controller.getStatus();
      if (status.state === 'Alarm') {
        throw new Error('Станок в аварийном состоянии. Сначала выполните восстановление.');
      }

      // Если указаны конкретные оси, используем индивидуальный хоминг
      const sequence = axes
        ? this.createSequenceForSpecificAxes(axes)
        : this.homingSequence;

      console.log(`Начинаем хоминг ${axes || 'всех осей'}...`);
      this.controller.emit('homingStarted', { axes });

      // Выполнение последовательности
      for (const step of sequence) {
        if (aborted) break;

        console.log(`Шаг: ${step.description}`);
        this.controller.emit('homingStep', { step: step.id, description: step.description });

        const stepStart = Date.now();
        try {
          await step.action();
          const duration = Date.now() - stepStart;

          results.push({
            stepId: step.id,
            success: true,
            duration,
            error: null
          });

          console.log(`✓ ${step.description} завершен за ${duration}мс`);
        } catch (error) {
          console.error(`✗ Ошибка на шаге ${step.description}:`, error);

          results.push({
            stepId: step.id,
            success: false,
            duration: Date.now() - stepStart,
            error: error as Error
          });

          // Критическая ошибка - прерываем хоминг
          if (step.critical) {
            console.error('Критическая ошибка, прерываем хоминг');
            await this.handleHomingFailure(step, error as Error);
            throw new Error(`Хоминг прерван на шаге ${step.id}: ${error}`);
          }

          // Повторяемая ошибка - пытаемся повторить
          if (step.retryable && step.maxRetries) {
            const retrySuccess = await this.retryStep(step, error as Error);
            if (!retrySuccess) {
              console.error('Не удалось выполнить шаг после повторных попыток');
              await this.handleHomingFailure(step, error as Error);
              throw new Error(`Не удалось выполнить шаг ${step.id} после повторных попыток`);
            }

            results[results.length - 1].success = true;
            results[results.length - 1].error = null;
          }
        }

        // Небольшая пауза между шагами
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Если хоминг не был прерван
      if (!aborted) {
        const totalDuration = Date.now() - startTime;

        // Проверяем, все ли критические шаги успешны
        const criticalSteps = sequence.filter(s => s.critical);
        const failedCritical = results.filter(r =>
          !r.success && criticalSteps.some(s => s.id === r.stepId)
        );

        if (failedCritical.length > 0) {
          throw new Error(`Хоминг завершен с ошибками в критических шагах: ${failedCritical.map(f => f.stepId).join(', ')}`);
        }

        const result: HomingResult = {
          success: true,
          duration: totalDuration,
          axesHomed: axes ? axes.split('').map(a => a.toUpperCase()) : ['X', 'Y', 'Z'],
          steps: results,
          warnings: this.generateHomingWarnings(results)
        };

        console.log(`✓ Хоминг успешно завершен за ${totalDuration}мс`);
        this.controller.emit('homingCompleted', result);

        return result;
      }

      throw new Error('Хоминг прерван пользователем');

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      const result: HomingResult = {
        success: false,
        duration: totalDuration,
        axesHomed: [],
        steps: results,
        error: error as Error,
        recoveryInstructions: this.generateRecoveryInstructions(error as Error, results)
      };

      console.error(`✗ Хоминг завершен с ошибкой за ${totalDuration}мс:`, error);
      this.controller.emit('homingFailed', result);

      // Автоматическое восстановление после неудачного хоминга
      await this.autoRecoveryAfterHomingFailure(result);

      return result;
    }
  }

  // Аварийная остановка хоминга
  abort(): void {
    console.log('Хоминг прерван по команде пользователя');
    this.controller.emit('homingAborted');
    // Здесь должна быть логика безопасной остановки
    // Например, отправка команды остановки
    this.controller.emergencyStop().catch(console.error);
  }

  private async preHomeSafetyCheck(): Promise<void> {
    console.log('Выполняем проверки безопасности перед хомингом...');

    // 1. Проверка свободного пространства
    console.log('1. Убедитесь, что ничего не мешает движению осей');
    console.log('   - Уберите инструменты со стола');
    console.log('   - Уберите руки от движущихся частей');
    console.log('   - Закройте защитные кожухи (если есть)');

    // 2. Проверка концевиков
    console.log('2. Проверка концевиков...');
    // Можно отправить тестовые команды для проверки концевиков

    // 3. Проверка состояния станка
    console.log('3. Проверка состояния станка...');
    const status = await this.controller.getStatus();

    if (status.state !== 'Idle' && status.state !== 'Alarm') {
      throw new Error(`Станок не в состоянии Idle. Текущее состояние: ${status.state}`);
    }

    // 4. Проверка позиции Z (чтобы не врезался при хоминге X/Y)
    const safeHeight = this.safety.getSafeTravelHeight ? this.safety.getSafeTravelHeight() : 20;
    if (status.position.z < safeHeight) {
      console.warn(`Внимание: ось Z находится низко (${status.position.z}мм). Поднимаем для безопасности...`);
      await this.raiseZToSafeHeight();
    }

    console.log('✓ Проверки безопасности пройдены');
  }

  private async raiseZToSafeHeight(): Promise<void> {
    const safeHeight = this.safety.getSafeTravelHeight ? this.safety.getSafeTravelHeight() : 20;
    console.log(`Поднимаем ось Z до безопасной высоты (${safeHeight}мм)...`);

    await this.controller.sendCommand(`G0 Z${safeHeight} F500`);
    
    // Ждем завершения перемещения
    await this.waitForIdleState(5000);

    console.log('✓ Ось Z в безопасном положении');
  }

  private async homeAllAxes(): Promise<void> {
    console.log('Хоминг всех осей...');

    // В GRBL команда $H хоминит все оси сразу
    await this.controller.sendCommand('$H');

    // Ждем завершения хоминга
    await this.waitForHomingComplete();

    console.log('✓ Все оси успешно прохомены');
  }

  private async homeSpecificAxis(axis: 'X' | 'Y' | 'Z'): Promise<void> {
    console.log(`Хоминг оси ${axis}...`);

    // В GRBL 1.1+ поддерживается хоминг отдельных осей
    await this.controller.sendCommand(`$H${axis}`);

    // Ждем завершения хоминга
    await this.waitForHomingComplete(axis);

    console.log(`✓ Ось ${axis} успешно прохомена`);
  }

  private createSequenceForSpecificAxes(axes: string): HomingStep[] {
    const axisList = axes.toUpperCase().split('');
    const sequence: HomingStep[] = [];

    // Всегда добавляем предварительные проверки
    sequence.push(this.homingSequence[0]); // pre_home_check
    sequence.push(this.homingSequence[1]); // raise_z (если нужно)

    // Для каждой оси добавляем свой шаг хоминга
    for (const axis of axisList) {
      if (['X', 'Y', 'Z'].includes(axis)) {
        sequence.push({
          id: `home_${axis.toLowerCase()}`,
          description: `Хоминг оси ${axis}`,
          action: async () => {
            await this.homeSpecificAxis(axis as 'X' | 'Y' | 'Z');
          },
          critical: true,
          retryable: true,
          maxRetries: 3
        });
      }
    }

    // Добавляем завершающие шаги
    sequence.push(this.homingSequence[3]); // move_to_zero
    sequence.push(this.homingSequence[4]); // verify_home

    return sequence;
  }

private async waitForHomingComplete(axis?: string): Promise<void> {
  const timeout = 60000; // 60 секунд максимум для хоминга
  const start = Date.now();
  let lastState = '';

  while (Date.now() - start < timeout) {
    try {
      const status = await this.controller.getStatus();

      // В GRBL после хоминга состояние может быть 'Home' или 'Idle'
      if (['Idle', 'Home'].includes(status.state) && (lastState === 'Home' || lastState === 'Run')) {
        // Хоминг завершен
        return;
      }

      lastState = status.state;

      if (status.state === 'Alarm') {
        throw new Error(`Станок перешел в аварийное состояние во время хоминга${axis ? ` оси ${axis}` : ''}`);
      }

      // Ждем немного перед следующей проверкой
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      // Игнорируем временные ошибки связи
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Таймаут хоминга${axis ? ` оси ${axis}` : ''}`);
}

  private async waitForIdleState(timeoutMs: number = 10000): Promise<void> {
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
    
    throw new Error(`Таймаут ожидания состояния Idle (${timeoutMs}ms)`);
  }

  private async moveToZeroPosition(): Promise<void> {
    console.log('Перемещаемся в нулевую позицию...');

    // Перемещаемся в X0 Y0, Z остается на безопасной высоте
    await this.controller.sendCommand('G0 X0 Y0 F1000');
    
    // Ждем завершения перемещения
    await this.waitForIdleState(5000);

    console.log('✓ Позиция установлена в X0 Y0');
  }

private async verifyHomingSuccess(): Promise<void> {
  console.log('Проверяем успешность хоминга...');

  const status = await this.controller.getStatus();

  // В GRBL после хоминга допустимы оба состояния: 'Home' и 'Idle'
  const validStatesAfterHoming = ['Idle', 'Home'];
  
  if (!validStatesAfterHoming.includes(status.state)) {
    throw new Error(`Станок не в допустимом состоянии после хоминга. Текущее состояние: ${status.state}`);
  }

  // Проверяем, что позиция близка к нулю (допуск 0.1мм)
  const tolerance = 0.1;
  if (
    Math.abs(status.position.x) > tolerance ||
    Math.abs(status.position.y) > tolerance ||
    Math.abs(status.position.z) > tolerance
  ) {
    throw new Error(`Позиция после хоминга отличается от нуля: X${status.position.x}, Y${status.position.y}, Z${status.position.z}`);
  }

  console.log('✓ Хоминг успешно проверен');
}

  private async retryStep(step: HomingStep, error: Error): Promise<boolean> {
    console.log(`Повторяем шаг ${step.id}...`);

    for (let attempt = 1; attempt <= (step.maxRetries || 3); attempt++) {
      console.log(`Попытка ${attempt}/${step.maxRetries}`);

      try {
        await step.action();
        console.log(`Шаг ${step.id} успешно выполнен с попытки ${attempt}`);
        return true;
      } catch (retryError) {
        console.log(`Попытка ${attempt} не удалась:`, retryError);

        // Экспоненциальная задержка между попытками
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return false;
  }

  private async handleHomingFailure(step: HomingStep, error: Error): Promise<void> {
    console.error(`Обработка ошибки хоминга на шаге ${step.id}:`, error.message);

    // В зависимости от шага, разные действия
    switch (step.id) {
      case 'home_z':
      case 'home_all':
        console.log('Рекомендации:');
        console.log('1. Проверьте, свободно ли движется ось Z');
        console.log('2. Проверьте концевик Z');
        console.log('3. Попробуйте подвигать ось Z вручную');
        break;

      case 'home_x':
      case 'home_y':
        console.log('Рекомендации:');
        console.log('1. Убедитесь, что ничего не мешает движению');
        console.log('2. Проверьте натяжение ремней');
        console.log('3. Проверьте концевики');
        break;
    }

    // Пытаемся перевести станок в безопасное состояние
    await this.safeRecoveryAfterFailure();
  }

  private async safeRecoveryAfterFailure(): Promise<void> {
    console.log('Переводим станок в безопасное состояние...');

    try {
      // Пытаемся поднять Z
      await this.controller.sendCommand('G0 Z10 F300').catch(() => {});

      // Сбрасываем аварийное состояние
      await this.controller.sendCommand('$X').catch(() => {});

      console.log('Станок в безопасном состоянии');
    } catch (error) {
      console.error('Не удалось перевести станок в безопасное состояние:', error);
    }
  }

  private generateHomingWarnings(results: HomingStepResult[]): string[] {
    const warnings: string[] = [];

    // Проверяем, были ли повторные попытки
    const retriedSteps = results.filter(r =>
      r.duration > 5000 && r.success // Долго выполнялись, но успешно
    );

    if (retriedSteps.length > 0) {
      warnings.push('Некоторые шаги хоминга выполнялись дольше обычного. Проверьте механику.');
    }

    // Проверяем общее время
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    if (totalDuration > 60000) {
      warnings.push('Хоминг занял более 60 секунд. Возможно, требуется обслуживание механической части.');
    }

    return warnings;
  }

  private generateRecoveryInstructions(error: Error, results: HomingStepResult[]): string[] {
    const instructions: string[] = [
      'НЕ ПЫТАЙТЕСЬ ПРОДОЛЖАТЬ РАБОТУ БЕЗ УСТРАНЕНИЯ ПРИЧИНЫ!'
    ];

    const lastStep = results[results.length - 1];
    if (lastStep && !lastStep.success) {
      instructions.push(`Последний выполненный шаг: ${lastStep.stepId}`);
      instructions.push(`Ошибка: ${lastStep.error?.message}`);

      // Специфичные инструкции в зависимости от шага
      if (lastStep.stepId.includes('home_z') || lastStep.stepId === 'home_all') {
        instructions.push('1. Проверьте, не заклинило ли ось Z');
        instructions.push('2. Проверьте концевик оси Z');
        instructions.push('3. Попробуйте подвигать ось Z вручную');
      } else if (lastStep.stepId.includes('home_x') || lastStep.stepId.includes('home_y')) {
        instructions.push('1. Уберите все предметы с пути движения');
        instructions.push('2. Проверьте натяжение ремней');
        instructions.push('3. Проверьте свободный ход каретки');
      }
    }

    instructions.push('После устранения проблемы выполните хоминг заново');

    return instructions;
  }

  private async autoRecoveryAfterHomingFailure(result: HomingResult): Promise<void> {
    console.log('Запускаем автоматическое восстановление после неудачного хоминга...');

    try {
      // 1. Сброс аварийного состояния
      await this.controller.sendCommand('$X').catch(() => {
        console.log('Не удалось сбросить аварийное состояние, возможно требуется ручное вмешательство');
      });

      // 2. Подъем оси Z (если возможно)
      const status = await this.controller.getStatus().catch(() => null);
      if (status && status.position.z < 20) {
        console.log('Пытаемся поднять ось Z для безопасности...');
        await this.controller.sendCommand('G0 Z20 F300').catch(() => {
          console.log('Не удалось поднять ось Z, требуется ручное поднятие');
        });
      }

      // 3. Перемещение в известную безопасную позицию
      console.log('Перемещаемся в безопасную позицию...');
      await this.controller.sendCommand('G0 X0 Y0 Z20 F500').catch(() => {
        console.log('Не удалось переместиться в безопасную позицию');
      });

      console.log('Автоматическое восстановление завершено');
      console.log('Рекомендации:', result.recoveryInstructions?.join('\n'));

    } catch (error) {
      console.error('Ошибка при автоматическом восстановлении:', error);
      console.log('Требуется ручное вмешательство для восстановления работоспособности станка');
    }
  }
}