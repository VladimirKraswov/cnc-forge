// tests/helpers/controller-test-utils.ts
import { ConnectionType } from '../../src';
import { CncController } from '../../src/controller/CncController';
import SerialPort from 'serialport';

export type ControllerTestContext = {
  controller: CncController;
  sendCommandSpy: jest.SpyInstance;
  mockPort: any;
};

export const setupControllerTest = async (
  controller: CncController,
  options: { autoConnect?: boolean } = {}
): Promise<ControllerTestContext> => {
  const { autoConnect = true } = options;
  
  if (autoConnect) {
    // Сначала мокаем serialport
    const MockSerialPort = SerialPort as jest.MockedClass<any>;
    const mockPort = MockSerialPort.mock.instances[0];
    
    // Подключаем контроллер
    await controller.connect({
      port: '/dev/test', baudRate: 115200,
      type: ConnectionType.Serial
    });
    
    const sendCommandSpy = jest.spyOn(controller as any, 'sendCommand');
    
    return { controller, sendCommandSpy, mockPort };
  }
  
  const sendCommandSpy = jest.spyOn(controller as any, 'sendCommand');
  const mockPort = null;
  
  return { controller, sendCommandSpy, mockPort };
};

export const teardownControllerTest = (context: ControllerTestContext) => {
  if (context.sendCommandSpy) {
    context.sendCommandSpy.mockRestore();
  }
};