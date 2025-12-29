// tests/controller.enhanced.test.ts
import { CncController } from '../src/controller/CncController';
import { createMockGrblStatus, createGCodeProgram } from './helpers/test-data';
import { assertGrblStatus } from './helpers/assertions';

// Импортируем моки
import './helpers/mocks';

// Импортируем fs для мока
import fs from 'fs/promises';
import { ConnectionType } from '../src';

describe('CncController (с хелперами)', () => {
  let controller: CncController;
  let sendCommandSpy: jest.SpyInstance;
  let mockPortWrite: jest.Mock;

  beforeEach(async () => {
    // Создаем контроллер
    controller = new CncController();
    
    // Подключаем контроллер (используем мокнутый SerialPort из helpers/mocks.ts)
    await controller.connect({
      port: '/dev/test', baudRate: 115200,
      type: ConnectionType.Serial
    });
    
    // Получаем мокнутый порт
    const mockPort = (controller as any).port;
    mockPortWrite = mockPort.write;
    
    // Мокаем внутренний метод sendCommand
    sendCommandSpy = jest.spyOn(controller as any, 'sendCommand');
  });

  afterEach(() => {
    if (sendCommandSpy) {
      sendCommandSpy.mockRestore();
    }
    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('парсит статус Idle', async () => {
      const statusResponse = createMockGrblStatus({
        state: 'Idle',
        position: { x: 0, y: 0, z: 0 },
        feed: 0
      });
      
      sendCommandSpy.mockResolvedValue(statusResponse);
      
      const status = await controller.getStatus();
      
      assertGrblStatus(status, {
        state: 'Idle',
        position: { x: 0, y: 0, z: 0 },
        feed: 0
      });
    });

    it('парсит статус Run с feed rate', async () => {
      const statusResponse = createMockGrblStatus({
        state: 'Run',
        position: { x: 50.123, y: 25.456, z: -10.789 },
        feed: 1500
      });
      
      sendCommandSpy.mockResolvedValue(statusResponse);
      
      const status = await controller.getStatus();
      
      assertGrblStatus(status, {
        state: 'Run',
        position: { x: 50.123, y: 25.456, z: -10.789 },
        feed: 1500
      });
    });
  });

  describe('streamGCode', () => {
    it('обрабатывает сложную G-code программу', async () => {
      const gcodeProgram = createGCodeProgram([
        'G90',
        'G1 X100 Y100 F1000',
        'G1 Z-10 F500',
        'G1 X0 Y0 F2000'
      ]);
      
      sendCommandSpy.mockResolvedValue('ok');
      
      await controller.streamGCode(gcodeProgram);
      
      expect(sendCommandSpy).toHaveBeenCalledTimes(4);
      expect(sendCommandSpy).toHaveBeenNthCalledWith(1, 'G90');
      expect(sendCommandSpy).toHaveBeenNthCalledWith(2, 'G1 X100 Y100 F1000');
      expect(sendCommandSpy).toHaveBeenNthCalledWith(3, 'G1 Z-10 F500');
      expect(sendCommandSpy).toHaveBeenNthCalledWith(4, 'G1 X0 Y0 F2000');
    });

    it('использует фикстуры для тестирования', async () => {
      // Создаем фикстуру прямо здесь для простоты
      const simpleMovement = `G1 X10 Y20 F100
G1 Z-5 F50
G0 X0 Y0`;
      
      sendCommandSpy.mockResolvedValue('ok');
      
      await controller.streamGCode(simpleMovement);
      
      expect(sendCommandSpy).toHaveBeenCalledTimes(3);
      expect(sendCommandSpy).toHaveBeenNthCalledWith(1, 'G1 X10 Y20 F100');
      expect(sendCommandSpy).toHaveBeenNthCalledWith(2, 'G1 Z-5 F50');
      expect(sendCommandSpy).toHaveBeenNthCalledWith(3, 'G0 X0 Y0');
    });

    it('читает G-code из файла', async () => {
      // Мокаем readFile для этого теста
      (fs.readFile as jest.Mock).mockResolvedValueOnce('G1 X10\nG1 Y20');
      sendCommandSpy.mockResolvedValue('ok');
      
      await controller.streamGCode('test.gcode', true);
      
      expect(fs.readFile).toHaveBeenCalledWith('test.gcode', 'utf8');
      expect(sendCommandSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('события', () => {
    it('эмитит события прогресса', async () => {
      const gcodeProgram = 'G1 X10\nG1 Y20\nG1 Z30';
      const progressEvents: any[] = [];
      
      controller.on('jobProgress', (data) => {
        progressEvents.push(data);
      });
      
      sendCommandSpy.mockResolvedValue('ok');
      
      await controller.streamGCode(gcodeProgram);
      
      expect(progressEvents).toHaveLength(3);
      expect(progressEvents[0]).toEqual({ line: 'G1 X10', total: 3 });
      expect(progressEvents[1]).toEqual({ line: 'G1 Y20', total: 3 });
      expect(progressEvents[2]).toEqual({ line: 'G1 Z30', total: 3 });
    });

    it('эмитит событие завершения работы', async () => {
      const gcodeProgram = 'G1 X10';
      let jobCompleteCalled = false;
      
      controller.on('jobComplete', () => {
        jobCompleteCalled = true;
      });
      
      sendCommandSpy.mockResolvedValue('ok');
      
      await controller.streamGCode(gcodeProgram);
      
      expect(jobCompleteCalled).toBe(true);
    });
  });

  describe('jog', () => {
    it('отправляет правильные команды для разных осей', async () => {
      sendCommandSpy.mockResolvedValue('ok');
      
      // Тестируем X ось
      await controller.jog('X', 10, 100);
      expect(sendCommandSpy).toHaveBeenLastCalledWith('$J=G91 X10 F100');
      
      // Тестируем Y ось с отрицательным значением
      await controller.jog('Y', -5.5, 50);
      expect(sendCommandSpy).toHaveBeenLastCalledWith('$J=G91 Y-5.5 F50');
      
      // Тестируем Z ось
      await controller.jog('Z', 2.5, 30);
      expect(sendCommandSpy).toHaveBeenLastCalledWith('$J=G91 Z2.5 F30');
    });
  });

  describe('обработка ошибок', () => {
    it('getStatus выбрасывает ошибку при некорректном ответе', async () => {
      sendCommandSpy.mockResolvedValue('некорректный ответ');
      
      await expect(controller.getStatus()).rejects.toThrow('Невозможно распарсить статус');
    });

    it('streamGCode выбрасывает ошибку при error ответе', async () => {
      sendCommandSpy.mockResolvedValue('error: Invalid command');
      
      await expect(controller.streamGCode('G1 X10')).rejects.toThrow(/Ошибка при отправке G-code/);
    });

    it('streamGCode выбрасывает ошибку при alarm ответе', async () => {
      sendCommandSpy.mockResolvedValue('alarm: Hard limit');
      
      await expect(controller.streamGCode('G1 X10')).rejects.toThrow(/Ошибка при отправке G-code/);
    });
  });
});