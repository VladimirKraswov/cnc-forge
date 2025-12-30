import { CncController } from '../controller/CncController';
import { IGrblStatus } from '../types';

export enum RecoveryState {
  Normal = 'normal',
  ConnectionLost = 'connection_lost',
  LimitTriggered = 'limit_triggered',
  StepLossDetected = 'step_loss',
  ProbeFailure = 'probe_failure',
  EmergencyStop = 'emergency_stop',
  ManualRecovery = 'manual_recovery'
}

export interface RecoveryDiagnosis {
  state: RecoveryState
  timestamp: Date
  probableCause: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  affectedAxes: ('x' | 'y' | 'z')[]
  recommendedActions: string[]
  recoverySteps: RecoveryStep[]
}

export interface RecoveryStep {
  id: string
  description: string
  action: () => Promise<void>
  confirmationRequired: boolean
  confirmationMessage?: string
}

export class RecoverySystem {
  private diagnosisHistory: RecoveryDiagnosis[] = []
  private maxHistorySize: number = 50
  private currentState: RecoveryState = RecoveryState.Normal

  // Основной метод диагностики
  async diagnose(controller: CncController): Promise<RecoveryDiagnosis> {
    const connection = controller['connection']
    const status = await controller.getStatus().catch(() => null)

    let diagnosis: RecoveryDiagnosis

    // 1. Проверка связи
    if (!connection || !connection.isConnected) {
      diagnosis = this.createConnectionLostDiagnosis()
    }
    // 2. Проверка состояния ALARM
    else if (status?.state === 'Alarm') {
      diagnosis = this.diagnoseAlarm(controller)
    }
    // 3. Проверка несоответствия позиций
    else if (controller.checkPositionMismatch()) {
      diagnosis = this.createStepLossDiagnosis(controller)
    }
    // 5. Все в норме
    else {
      diagnosis = this.createNormalDiagnosis()
    }

    // Сохраняем диагноз в историю
    this.diagnosisHistory.unshift(diagnosis)
    if (this.diagnosisHistory.length > this.maxHistorySize) {
      this.diagnosisHistory.pop()
    }

    this.currentState = diagnosis.state
    return diagnosis
  }

  private createConnectionLostDiagnosis(): RecoveryDiagnosis {
    return {
      state: RecoveryState.ConnectionLost,
      timestamp: new Date(),
      probableCause: 'Соединение с контроллером потеряно',
      severity: 'high',
      affectedAxes: ['x', 'y', 'z'],
      recommendedActions: [
        'Проверьте кабель подключения',
        'Убедитесь, что контроллер включен',
        'Проверьте порт/адрес подключения'
      ],
      recoverySteps: [
        {
          id: 'check_cable',
          description: 'Проверить физическое соединение',
          action: async () => {
            console.log('Убедитесь, что USB-кабель надежно подключен')
          },
          confirmationRequired: true,
          confirmationMessage: 'Кабель проверен и подключен надежно?'
        },
        {
          id: 'reconnect',
          description: 'Попытка переподключения',
          action: async () => {
            // Автоматическая попытка переподключения
          },
          confirmationRequired: false
        }
      ]
    }
  }

  private diagnoseAlarm(controller: CncController): RecoveryDiagnosis {
    // Здесь можно парсить конкретные коды аварий GRBL
    const alarmCode = this.extractAlarmCode(controller);

    switch (alarmCode) {
      case 1: // Hard limit triggered
        return this.createHardLimitDiagnosis(controller);
      case 4: // Probe fail
        return this.createProbeFailureDiagnosis();
      case 6: // Homing fail
        return this.createHomingFailureDiagnosis();
      default:
        return this.createGenericAlarmDiagnosis(alarmCode, controller);
    }
  }

  private extractAlarmCode(controller: CncController): number | null {
    return controller.getLastAlarmCode();
  }

  private createProbeFailureDiagnosis(): RecoveryDiagnosis {
    return {
      state: RecoveryState.ProbeFailure,
      timestamp: new Date(),
      probableCause: 'Ошибка щупа: нет контакта или щуп уже был активирован.',
      severity: 'medium',
      affectedAxes: ['z'],
      recommendedActions: ['Проверьте проводку щупа', 'Убедитесь, что щуп не касается заготовки перед началом', 'Проверьте G-код на правильность команд для щупа'],
      recoverySteps: [
        {
          id: 'check_probe_wiring',
          description: 'Проверить проводку щупа',
          action: async () => {
            console.log('Убедитесь, что щуп правильно подключен и не имеет короткого замыкания.');
          },
          confirmationRequired: true,
          confirmationMessage: 'Проводка щупа исправна?'
        }
      ]
    };
  }

  private createHomingFailureDiagnosis(): RecoveryDiagnosis {
    return {
      state: RecoveryState.LimitTriggered, // Or a more specific homing failure state
      timestamp: new Date(),
      probableCause: 'Ошибка хоминга: концевой выключатель может быть зажат или не срабатывает.',
      severity: 'high',
      affectedAxes: [], // Homing failures can be complex to diagnose automatically
      recommendedActions: ['Проверьте проводку и функциональность концевых выключателей', 'Убедитесь, что станку ничего не мешает для движения в исходное положение'],
      recoverySteps: [
        {
          id: 'check_limit_switches',
          description: 'Проверить концевые выключатели',
          action: async () => {
            console.log('Вручную активируйте каждый концевой выключатель, чтобы убедиться, что он регистрируется правильно.');
          },
          confirmationRequired: true,
          confirmationMessage: 'Все концевые выключатели работают правильно?'
        }
      ]
    };
  }

  private createGenericAlarmDiagnosis(alarmCode: number | null, controller: CncController): RecoveryDiagnosis {
    return {
      state: RecoveryState.EmergencyStop, // Or a more appropriate generic state
      timestamp: new Date(),
      probableCause: `Произошла неизвестная тревога (код: ${alarmCode || 'N/A'})`,
      severity: 'high',
      affectedAxes: [],
      recommendedActions: ['Проверьте консоль станка для получения дополнительной информации', 'Выполните программный сброс'],
      recoverySteps: [
        {
          id: 'clear_alarm',
          description: 'Сброс аварийного состояния',
          action: () => controller.softReset(),
          confirmationRequired: false,
        }
      ]
    };
  }

  private createNormalDiagnosis(): RecoveryDiagnosis {
    return {
        state: RecoveryState.Normal,
        timestamp: new Date(),
        probableCause: 'Все системы в норме',
        severity: 'low',
        affectedAxes: [],
        recommendedActions: [],
        recoverySteps: []
    };
  }

  // Восстановительные процедуры
  async executeRecovery(diagnosis: RecoveryDiagnosis, controller: CncController): Promise<void> {
    console.log(`Выполняем восстановление после: ${diagnosis.probableCause}`)
    console.log('Рекомендуемые действия:', diagnosis.recommendedActions.join('\n'))

    for (const step of diagnosis.recoverySteps) {
      if (step.confirmationRequired) {
        // В реальном приложении здесь должен быть UI для подтверждения
        console.log(`Требуется подтверждение: ${step.confirmationMessage}`)
        // Для тестирования автоматически подтверждаем
      }

      try {
        await step.action()
        console.log(`Шаг "${step.description}" выполнен успешно`)
      } catch (error) {
        console.error(`Ошибка при выполнении шага "${step.description}":`, error)
        throw new Error(`Recovery failed at step: ${step.id}`)
      }
    }

    // После восстановления делаем повторную диагностику
    const newDiagnosis = await this.diagnose(controller)
    if (newDiagnosis.state !== RecoveryState.Normal) {
      throw new Error('Recovery incomplete, machine still in error state')
    }

    this.currentState = RecoveryState.Normal
    console.log('Восстановление завершено успешно')
  }

  // Процедура восстановления после срабатывания концевика
  private createHardLimitDiagnosis(controller: CncController): RecoveryDiagnosis {
    return {
      state: RecoveryState.LimitTriggered,
      timestamp: new Date(),
      probableCause: 'Сработал концевой выключатель',
      severity: 'medium',
      affectedAxes: this.detectTriggeredAxis(controller),
      recommendedActions: [
        'НЕ пытайтесь двигать станок силой',
        'Определите, какой концевик сработал',
        'Аккуратно отодвиньте каретку от концевика вручную'
      ],
      recoverySteps: [
        {
          id: 'identify_limit',
          description: 'Определить сработавший концевик',
          action: async () => {
            console.log('Проверьте визуально, какая ось уперлась в концевик')
          },
          confirmationRequired: true,
          confirmationMessage: 'Определили, какая ось сработала?'
        },
        {
          id: 'manual_retract',
          description: 'Ручное отведение от концевика',
          action: async () => {
            console.log('Осторожно покрутите шпиндель вручную, чтобы отвести от концевика')
          },
          confirmationRequired: true,
          confirmationMessage: 'Станок отошел от концевика?'
        },
        {
          id: 'clear_alarm',
          description: 'Сброс аварийного состояния',
          action: async () => {
            await controller.softReset()
          },
          confirmationRequired: false
        },
        {
          id: 'rehome',
          description: 'Повторный хоминг',
          action: async () => {
            await controller.home()
          },
          confirmationRequired: true,
          confirmationMessage: 'Выполнить хоминг? Убедитесь, что ничего не мешает движению.'
        }
      ]
    }
  }

  // Процедура восстановления после пропуска шагов
  private createStepLossDiagnosis(controller: CncController): RecoveryDiagnosis {
    return {
      state: RecoveryState.StepLossDetected,
      timestamp: new Date(),
      probableCause: 'Обнаружен пропуск шагов двигателя',
      severity: 'high',
      affectedAxes: this.detectStepLossAxis(controller),
      recommendedActions: [
        'Проверьте натяжение ремней/гаек',
        'Уменьшите скорость и ускорение',
        'Проверьте напряжение на драйверах',
        'Убедитесь, что нагрузка не слишком велика'
      ],
      recoverySteps: [
        {
          id: 'check_mechanics',
          description: 'Проверка механической части',
          action: async () => {
            console.log('Проверьте:')
            console.log('1. Натяжение ремней (должны звенеть как струна)')
            console.log('2. Люфт в направляющих (не должно быть качания)')
            console.log('3. Плавность хода (двигать вручную)')
          },
          confirmationRequired: true
        },
        {
          id: 'reduce_speed',
          description: 'Уменьшение скорости и ускорения',
          action: async () => {
            await controller.sendCommand('$110=500') // Уменьшаем скорость X
            await controller.sendCommand('$111=500') // Уменьшаем скорость Y
            await controller.sendCommand('$112=300') // Уменьшаем скорость Z
            console.log('Скорости уменьшены. Проверьте настройки в $$')
          },
          confirmationRequired: false
        },
        {
          id: 'recalibrate',
          description: 'Калибровка позиции',
          action: async () => {
            console.log('Необходимо заново выполнить хоминг и установить нули')
            // Здесь можно вызвать процедуру калибровки
          },
          confirmationRequired: true
        }
      ]
    }
  }


  private detectTriggeredAxis(controller: CncController): ('x' | 'y' | 'z')[] {
    // This is a simplified implementation. A more robust solution would involve
    // parsing the controller's status messages.
    return [];
  }

  private detectStepLossAxis(controller: CncController): ('x' | 'y' | 'z')[] {
    const axes: ('x' | 'y' | 'z')[] = [];
    const lastKnown = controller.getCurrentPosition();
    const expected = controller.getExpectedPosition();
    const tolerance = 0.1;

    if (Math.abs(lastKnown.x - expected.x) > tolerance) axes.push('x');
    if (Math.abs(lastKnown.y - expected.y) > tolerance) axes.push('y');
    if (Math.abs(lastKnown.z - expected.z) > tolerance) axes.push('z');

    return axes;
  }

  getCurrentState(): RecoveryState {
    return this.currentState
  }

  getDiagnosisHistory(): RecoveryDiagnosis[] {
    return [...this.diagnosisHistory]
  }

  clearHistory(): void {
    this.diagnosisHistory = []
  }
}
