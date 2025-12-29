import { CncController } from '../../src/controller/CncController';
import { RecoverySystem, RecoveryState, RecoveryDiagnosis } from '../../src/recovery/RecoverySystem';
import { IConnection, IConnectionOptions, ConnectionType } from '../../src/interfaces/Connection';
import { EventEmitter } from 'events';

class MockConnection extends EventEmitter implements IConnection {
    isConnected: boolean = false;
    options: IConnectionOptions;

    constructor(options: IConnectionOptions) {
        super();
        this.options = options;
    }

    async connect(): Promise<void> {
        this.isConnected = true;
        this.emit('connected');
    }

    async disconnect(): Promise<void> {
        this.isConnected = false;
        this.emit('disconnected');
    }

    async send(data: string): Promise<void> {
        if (!this.isConnected) {
            throw new Error('Not connected');
        }
    }

    simulateFailure(type: 'disconnect') {
        if (type === 'disconnect') {
            this.isConnected = false;
            this.emit('disconnected');
        }
    }
}

describe('Recovery System', () => {
  let controller: CncController
  let recoverySystem: RecoverySystem
  let mockConnection: MockConnection

  beforeEach(() => {
    jest.useFakeTimers();
    controller = new CncController()
    recoverySystem = new RecoverySystem()
    mockConnection = new MockConnection({ type: ConnectionType.Serial, port: '/dev/ttyUSB0' })
    controller['connection'] = mockConnection
  })

  afterEach(() => {
    jest.clearAllTimers();
  })

  test('should diagnose connection loss', async () => {
    await mockConnection.connect()
    mockConnection.simulateFailure('disconnect')

    const diagnosis = await recoverySystem.diagnose(controller)
    expect(diagnosis.state).toBe(RecoveryState.ConnectionLost)
    expect(diagnosis.severity).toBe('high')
    expect(diagnosis.recommendedActions).toContain('Проверьте кабель подключения')
  })

  test('should create recovery steps for limit switch', async () => {
    // Симулируем состояние аварии (hard limit)
    const diagnosis = recoverySystem['createHardLimitDiagnosis'](controller)

    expect(diagnosis.state).toBe(RecoveryState.LimitTriggered)
    expect(diagnosis.recoverySteps).toHaveLength(4)

    // Проверяем, что есть шаг ручного отведения
    const manualStep = diagnosis.recoverySteps.find(s => s.id === 'manual_retract')
    expect(manualStep).toBeDefined()
    expect(manualStep?.confirmationRequired).toBe(true)
  })

  test('should execute recovery procedure', async () => {
    const diagnosis: RecoveryDiagnosis = {
      state: RecoveryState.ConnectionLost,
      timestamp: new Date(),
      probableCause: 'Test',
      severity: 'medium',
      affectedAxes: ['x', 'y', 'z'],
      recommendedActions: ['Test action'],
      recoverySteps: [
        {
          id: 'test_step',
          description: 'Test step',
          action: async () => {
            console.log('Test step executed')
          },
          confirmationRequired: false
        }
      ]
    }

    jest.spyOn(recoverySystem, 'diagnose').mockResolvedValueOnce({
      state: RecoveryState.Normal,
      timestamp: new Date(),
      probableCause: '',
      severity: 'low',
      affectedAxes: [],
      recommendedActions: [],
      recoverySteps: [],
    });

    await expect(recoverySystem.executeRecovery(diagnosis, controller))
      .resolves.not.toThrow()
  })

  test('should maintain diagnosis history', async () => {
    // Создаем несколько диагнозов
    const diagnosis1 = recoverySystem['createConnectionLostDiagnosis']()
    const diagnosis2 = recoverySystem['createHardLimitDiagnosis'](controller)

    // Эмулируем добавление в историю
    recoverySystem['diagnosisHistory'] = [diagnosis1, diagnosis2]

    const history = recoverySystem.getDiagnosisHistory()
    expect(history).toHaveLength(2)
    expect(history[0].state).toBe(RecoveryState.ConnectionLost)
    expect(history[1].state).toBe(RecoveryState.LimitTriggered)
  })

  test('should detect position mismatch', async () => {
    // Симулируем расхождение позиций
    controller['expectedPosition'] = { x: 100, y: 100, z: 0 }
    controller['lastKnownPosition'] = { x: 90, y: 95, z: 0 } // Расхождение 10 и 5 мм

    const hasMismatch = controller['checkPositionMismatch']()
    expect(hasMismatch).toBe(true)
  })

  test('should calculate position change from G-code', () => {
    const change1 = controller['calculateExpectedPositionChange']('G0 X100 Y50 Z10')
    expect(change1).toEqual({ x: 100, y: 50, z: 10 })

    const change2 = controller['calculateExpectedPositionChange']('$J=G91 X10 Y-5 F1000')
    expect(change2).toEqual({ x: 10, y: -5, z: 0 })

    const change3 = controller['calculateExpectedPositionChange']('?')
    expect(change3).toBeUndefined()
  })
})
