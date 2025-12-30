import { CncController } from '../src/controller/CncController';
import { MockConnection } from '../src/connections/MockConnection';
import { ConnectionType } from '../src/interfaces/Connection';
import { ConnectionFactory } from '../src/connections';
import fs from 'fs/promises';

jest.mock('fs/promises');

jest.setTimeout(10000);

describe('CncController', () => {
  let controller: CncController;
  let mockConnection: MockConnection;

  beforeEach(async () => {
    mockConnection = new MockConnection({ type: ConnectionType.Serial });
    
    // Устанавливаем правильные ответы для команд
    // ВАЖНО: команда '?' должна возвращать статус
    mockConnection.responses.set('?', '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|F:0>');
    // Для getSettings и getInfo - с 'ok' в конце
    mockConnection.responses.set('$$', '$0=10\n$1=25\nok');
    mockConnection.responses.set('$I', '[VER:1.1f.20230414]\nok');
    mockConnection.responses.set('\x18', 'ok');
    mockConnection.responses.set('G0 X100 Y50 Z10', 'ok');
    mockConnection.responses.set('$J=G91 X10 Y5 F1000', 'ok');
    mockConnection.responses.set('M3 S1000', 'ok');
    mockConnection.responses.set('G0 X10 Y20', 'ok');
    mockConnection.responses.set('$C', 'ok');
    mockConnection.responses.set('!', 'ok');
    mockConnection.responses.set('$H', 'ok');
    mockConnection.responses.set('$HZ', 'ok');
    mockConnection.responses.set('$HX', 'ok');
    mockConnection.responses.set('$HY', 'ok');
    mockConnection.responses.set('G0 Z20 F500', 'ok');
    mockConnection.responses.set('G0 X0 Y0 F1000', 'ok');
    mockConnection.responses.set('G38.2 Z-50 F100', 'ok\n[PRB:0.000,0.000,-1.234:1]');
    
    jest.spyOn(ConnectionFactory, 'create').mockReturnValue(mockConnection);

    controller = new CncController();
    
    // Подключаем контроллер
    await controller.connect({ type: ConnectionType.Serial });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    controller.stopStatusPolling();
    
    if (controller.isConnected()) {
      await controller.disconnect();
    }
  });

  test('should connect and disconnect', async () => {
    expect(controller.isConnected()).toBe(true);
    
    await controller.disconnect();
    expect(controller.isConnected()).toBe(false);
  });

  test('should get status', async () => {
    const status = await controller.getStatus();
    
    expect(status.state).toBe('Idle');
    expect(status.position.x).toBe(0);
    expect(status.position.y).toBe(0);
    expect(status.position.z).toBe(0);
    expect(status.feed).toBe(0);
  });

  test('should send G-code commands', async () => {
    const response = await controller.sendCommand('G0 X10 Y20');
    expect(response).toBe('ok');
  });

  test('should handle emergency stop', async () => {
    const emergencyHandler = jest.fn();
    controller.on('emergencyStop', emergencyHandler);
    
    await controller.emergencyStop();
    
    expect(emergencyHandler).toHaveBeenCalled();
  });

  test('should get settings', async () => {
    const settings = await controller.getSettings();
    // Метод должен отфильтровать строку с 'ok'
    expect(settings).toEqual(['$0=10', '$1=25']);
  });

  test('should get info', async () => {
    const info = await controller.getInfo();
    // Метод должен отфильтровать строку с 'ok'
    expect(info).toEqual(['[VER:1.1f.20230414]']);
  });

  test('should validate safe commands', async () => {
    // Команда '?' должна вернуть статус
    const response = await controller.sendCommand('?');
    expect(response).toBe('<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|F:0>');
  });

  test('should emit a warning for unsafe commands', async () => {
    const warningHandler = jest.fn();
    controller.on('warning', warningHandler);
    
    // Мокируем SafetySystem.validateCommand для возврата предупреждения
    const safetySystem = (controller as any).safetySystem;
    const originalValidate = safetySystem.validateCommand;
    
    safetySystem.validateCommand = jest.fn().mockReturnValue({
      isValid: true,
      warning: 'Команда шпинделя обнаружена - убедитесь, что инструмент свободен'
    });
    
    await controller.sendCommand('M3 S1000');
    
    expect(warningHandler).toHaveBeenCalledWith('Команда шпинделя обнаружена - убедитесь, что инструмент свободен');
    
    safetySystem.validateCommand = originalValidate;
  });

  test('should handle alarm responses', async () => {
    return new Promise<void>((resolve) => {
      const alarmHandler = jest.fn().mockImplementation(() => {
        expect(alarmHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 1,
            message: 'Hard limit triggered.'
          })
        );
        resolve();
      });
      
      controller.on('alarm', alarmHandler);
      
      // Симулируем получение аварии
      mockConnection.emit('data', 'ALARM:1');
    });
  });

  test('should update expected position after movement', async () => {
    await controller.sendCommand('G0 X100 Y50 Z10');
    
    const expectedPos = controller.getExpectedPosition();
    expect(expectedPos.x).toBe(100);
    expect(expectedPos.y).toBe(50);
    expect(expectedPos.z).toBe(10);
  });

  test('should handle jog commands', async () => {
    await controller.sendCommand('$J=G91 X10 Y5 F1000');
    
    const expectedPos = controller.getExpectedPosition();
    expect(expectedPos.x).toBe(10);
    expect(expectedPos.y).toBe(5);
    expect(expectedPos.z).toBe(0);
  });

  test('should handle feed hold', async () => {
    const feedHoldHandler = jest.fn();
    controller.on('feedHold', feedHoldHandler);
    
    await controller.feedHold();
    
    expect(feedHoldHandler).toHaveBeenCalled();
  });

  test('should handle soft reset', async () => {
    const softResetHandler = jest.fn();
    controller.on('softReset', softResetHandler);
    
    await controller.softReset();
    
    expect(softResetHandler).toHaveBeenCalled();
  });

  test('should check G-code', async () => {
    // Мокируем sendCommand для последовательных вызовов
    const mockSendCommand = jest.spyOn(controller, 'sendCommand');
    mockSendCommand
      .mockResolvedValueOnce('ok') // Для $C
      .mockResolvedValueOnce('ok') // Для G0 X10 Y20
      .mockResolvedValueOnce('ok'); // Для $C
    
    const result = await controller.checkGCode('G0 X10 Y20');
    
    expect(result).toBe('ok');
    expect(mockSendCommand).toHaveBeenCalledTimes(3);
  });
});