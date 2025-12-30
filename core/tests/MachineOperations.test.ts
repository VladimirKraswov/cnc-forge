import { CncController } from '../src/controller/CncController';
import { HomingSystem } from '../src/operations/HomingSystem';
import { JoggingSystem } from '../src/operations/JoggingSystem';
import { ProbingSystem } from '../src/operations/ProbingSystem';
import { MockConnection } from '../src/connections/MockConnection';
import { ConnectionType } from '../src/interfaces/Connection';
import { ConnectionFactory } from '../src/connections';
import { IGrblStatus } from '../src';

// Увеличиваем глобальный таймаут для всех тестов
jest.setTimeout(10000);

// Вспомогательная функция для создания статуса
const createMockStatus = (
  state: IGrblStatus['state'],
  position: { x: number; y: number; z: number }
): IGrblStatus => ({
  state,
  position,
  feed: 0
});

describe('Machine Operations', () => {
  let controller: CncController;
  let homing: HomingSystem;
  let jogging: JoggingSystem;
  let probing: ProbingSystem;
  let mockConnection: MockConnection;

  beforeEach(async () => {
    mockConnection = new MockConnection({ type: ConnectionType.Serial });
    
    // Устанавливаем правильные ответы для команд
    mockConnection.responses.set('?', '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|F:0>');
    mockConnection.responses.set('$H', 'ok');
    mockConnection.responses.set('$HZ', 'ok');
    mockConnection.responses.set('$HX', 'ok');
    mockConnection.responses.set('$HY', 'ok');
    mockConnection.responses.set('$J=G91 X10 Y5 F1000', 'ok');
    mockConnection.responses.set('$J=G91 X100 F1000', 'ok');
    mockConnection.responses.set('G38.2 Z-50 F100', 'ok\n[PRB:0.000,0.000,-1.234:1]');
    mockConnection.responses.set('G0 Z20 F500', 'ok');
    mockConnection.responses.set('G0 Z10 F500', 'ok');
    mockConnection.responses.set('G0 X0 Y0 F1000', 'ok');
    mockConnection.responses.set('G0 Z5 F300', 'ok');
    mockConnection.responses.set('G0 Z10 F300', 'ok');
    mockConnection.responses.set('G0 X0 Y0 Z20 F500', 'ok');
    mockConnection.responses.set('$X', 'ok');
    
    jest.spyOn(ConnectionFactory, 'create').mockReturnValue(mockConnection);

    controller = new CncController();
    
    // Получаем реальные экземпляры систем
    homing = controller.homingSystem;
    jogging = controller.joggingSystem;
    probing = controller.probingSystem;
    
    // Подключаем контроллер
    await controller.connect({ type: ConnectionType.Serial });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    
    // Отключаем контроллер если он подключен
    if (controller.isConnected()) {
      await controller.disconnect();
    }
  });

  describe('HomingSystem', () => {
    beforeEach(() => {
      // Мокируем систему безопасности для хоминга
      const safetySystem = (controller as any).safetySystem;
      
      // Мокаем validateCommand для разрешения всех команд
      jest.spyOn(safetySystem, 'validateCommand').mockReturnValue({ 
        isValid: true 
      });
      
      // Мокаем getSafeTravelHeight если метод существует
      if (safetySystem.getSafeTravelHeight) {
        jest.spyOn(safetySystem, 'getSafeTravelHeight').mockReturnValue(20);
      }
      
      // Мокаем isSafeToMove если метод существует
      if (safetySystem.isSafeToMove) {
        jest.spyOn(safetySystem, 'isSafeToMove').mockReturnValue(true);
      }
    });

    it('should perform homing sequence', async () => {
      // Мокируем все вызовы sendCommand
      const mockSendCommand = jest.spyOn(controller, 'sendCommand');
      mockSendCommand.mockResolvedValue('ok');
      
      // Мокируем getStatus
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      let callCount = 0;
      mockGetStatus.mockImplementation((): Promise<IGrblStatus> => {
        callCount++;
        
        if (callCount <= 3) {
          return Promise.resolve(createMockStatus('Idle', { x: 50, y: 50, z: 90 }));
        } else if (callCount <= 6) {
          return Promise.resolve(createMockStatus('Home', { x: 0, y: 0, z: 90 }));
        } else {
          return Promise.resolve(createMockStatus('Idle', { x: 0, y: 0, z: 0 }));
        }
      });

      // Мокируем getSafetyStatus
      jest.spyOn(controller, 'getSafetyStatus').mockReturnValue({
        limits: { 
          x: { min: -100, max: 100 }, 
          y: { min: -100, max: 100 }, 
          z: { min: -100, max: 100 } 
        },
        isHomed: false,
        isSafe: true
      });

      const result = await homing.home();

      expect(result.success).toBe(true);
      expect(result.axesHomed).toEqual(['X', 'Y', 'Z']);
      expect(result.steps).toHaveLength(5);
    });

    it('should handle homing failure', async () => {
      // Мокируем sendCommand чтобы первая команда хоминга вернула ошибку
      const mockSendCommand = jest.spyOn(controller, 'sendCommand');
      mockSendCommand.mockImplementation(async (cmd: string) => {
        if (cmd.includes('$H') || cmd === '$H') {
          throw new Error('Homing fail');
        }
        return 'ok';
      });

      // Мокируем getStatus
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      mockGetStatus.mockResolvedValue(createMockStatus('Idle', { x: 0, y: 0, z: 90 }));

      // Мокируем getSafetyStatus
      jest.spyOn(controller, 'getSafetyStatus').mockReturnValue({
        limits: { 
          x: { min: -100, max: 100 }, 
          y: { min: -100, max: 100 }, 
          z: { min: -100, max: 100 } 
        },
        isHomed: false,
        isSafe: true
      });

      const result = await homing.home();

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('home');
    });

    it('should home specific axes', async () => {
      // Мокируем sendCommand
      const mockSendCommand = jest.spyOn(controller, 'sendCommand');
      mockSendCommand.mockResolvedValue('ok');

      // Мокируем getStatus
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      let callCount = 0;
      mockGetStatus.mockImplementation((): Promise<IGrblStatus> => {
        callCount++;
        
        if (callCount <= 3) {
          return Promise.resolve(createMockStatus('Idle', { x: 50, y: 50, z: 90 }));
        } else if (callCount <= 6) {
          return Promise.resolve(createMockStatus('Home', { x: 0, y: 0, z: 90 }));
        } else {
          return Promise.resolve(createMockStatus('Idle', { x: 0, y: 0, z: 0 }));
        }
      });

      // Мокируем getSafetyStatus
      jest.spyOn(controller, 'getSafetyStatus').mockReturnValue({
        limits: { 
          x: { min: -100, max: 100 }, 
          y: { min: -100, max: 100 }, 
          z: { min: -100, max: 100 } 
        },
        isHomed: false,
        isSafe: true
      });

      const result = await homing.home('XY');

      expect(result.success).toBe(true);
      expect(result.axesHomed).toEqual(['X', 'Y']);
    });
  });

  describe('JoggingSystem', () => {
    beforeEach(() => {
      // Мокируем систему безопасности для джоггинга
      const safetySystem = (controller as any).safetySystem;
      
      // Мокаем validateCommand для разрешения всех команд
      jest.spyOn(safetySystem, 'validateCommand').mockReturnValue({ 
        isValid: true 
      });
      
      // Мокаем getSoftLimits если метод существует
      if (safetySystem.getSoftLimits) {
        jest.spyOn(safetySystem, 'getSoftLimits').mockReturnValue({
          x: { min: -100, max: 100 },
          y: { min: -100, max: 100 },
          z: { min: -100, max: 100 }
        });
      }
    });

    it('should perform safe jog', async () => {
      // Мокируем sendCommand
      const mockSendCommand = jest.spyOn(controller, 'sendCommand');
      mockSendCommand.mockResolvedValue('ok');
      
      // Мокируем getStatus
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      mockGetStatus.mockResolvedValue(createMockStatus('Idle', { x: 0, y: 0, z: 0 }));

      // Мокируем getSafetyStatus
      jest.spyOn(controller, 'getSafetyStatus').mockReturnValue({
        limits: { 
          x: { min: -100, max: 100 }, 
          y: { min: -100, max: 100 }, 
          z: { min: -100, max: 100 } 
        },
        isHomed: true,
        isSafe: true
      });

      const result = await jogging.jog({ x: 10, y: 5 }, 1000);

      expect(result.success).toBe(true);
      expect(result.axes).toEqual(expect.arrayContaining(['x', 'y']));
      expect(result.feed).toBe(1000);
    });
  });

  describe('ProbingSystem', () => {
    beforeEach(() => {
      // Для всех тестов зондирования мокируем систему безопасности
      const safetySystem = (controller as any).safetySystem;
      
      // Мокаем validateCommand для разрешения всех команд
      jest.spyOn(safetySystem, 'validateCommand').mockReturnValue({ 
        isValid: true 
      });
      
      // Мокаем getSoftLimits если метод существует
      if (safetySystem.getSoftLimits) {
        jest.spyOn(safetySystem, 'getSoftLimits').mockReturnValue({
          x: { min: -100, max: 100 },
          y: { min: -100, max: 100 },
          z: { min: -100, max: 100 }
        });
      }
      
      // Мокаем getSafetyStatus
      jest.spyOn(controller, 'getSafetyStatus').mockReturnValue({
        limits: { 
          x: { min: -100, max: 100 }, 
          y: { min: -100, max: 100 }, 
          z: { min: -100, max: 100 } 
        },
        isHomed: true,
        isSafe: true
      });
    });

    it('should perform Z-axis probing', async () => {
      // Мокируем sendCommand
      const mockSendCommand = jest.spyOn(controller, 'sendCommand');
      mockSendCommand.mockResolvedValue('ok\n[PRB:0.000,0.000,-1.234:1]');
      
      // Мокируем getStatus с правильным форматом ответа
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      mockGetStatus.mockResolvedValue(
        createMockStatus('Idle', { x: 0, y: 0, z: -1.234 })
      );

      const result = await probing.probe('Z', 100, -50);

      expect(result.success).toBe(true);
      expect(result.axis).toBe('Z');
      expect(result.contactDetected).toBe(true);
    });

    it('should reject positive Z probing', async () => {
      // Мокируем getStatus
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      mockGetStatus.mockResolvedValue(createMockStatus('Idle', { x: 0, y: 0, z: 0 }));

      // Ожидаем, что результат будет неуспешным
      const result = await probing.probe('Z', 100, 50);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Z-axis probing should be negative');
    });

    it('should recover from probe failure', async () => {
      // Мокируем sendCommand чтобы возвращал ошибку при зондировании
      const mockSendCommand = jest.spyOn(controller, 'sendCommand');
      mockSendCommand.mockImplementation(async (cmd: string) => {
        if (cmd.includes('G38.2')) {
          throw new Error('ALARM:5');
        }
        return 'ok';
      });

      // Мокируем getStatus
      const mockGetStatus = jest.spyOn(controller, 'getStatus');
      mockGetStatus.mockResolvedValue(createMockStatus('Idle', { x: 0, y: 0, z: 0 }));

      const result = await probing.probe('Z', 100, -50);

      expect(result.success).toBe(false);
      expect(result.probeFailure).toBe('no_contact');
    });
  });
});