import { CncController } from '../src/controller/CncController';
import { ConnectionType } from '../src/interfaces/Connection';
import { MockConnection } from '../src/connections/MockConnection';
import fs from 'fs/promises';

// Мокаем ConnectionFactory
jest.mock('../src/connections', () => ({
  ConnectionFactory: {
    create: jest.fn(options => new MockConnection(options)),
  },
}));

// Мокаем fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

describe('CncController', () => {
  let controller: CncController;
  let mockConnection: MockConnection;
  let sendSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(async () => {
    controller = new CncController();
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    mockConnection = (controller as any).connection;
    sendSpy = jest.spyOn(mockConnection, 'send');
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    sendSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('should connect and disconnect', async () => {
    expect(controller.isConnected()).toBe(true);
    await controller.disconnect();
    expect(controller.isConnected()).toBe(false);
  });

  it('should send a command and receive a response', async () => {
    await expect(controller.sendCommand('G0 X10')).resolves.toBe('ok');
  });

  it('should get status', async () => {
    mockConnection.MOCK_send_response =
      '<Idle|MPos:10.000,20.000,0.000|WPos:10.000,20.000,0.000|F:500.0>';
    const status = await controller.getStatus();
    expect(status).toEqual({
      state: 'Idle',
      position: { x: 10, y: 20, z: 0 },
      feed: 500,
    });
  });

  it('should start and stop status polling', async () => {
    jest.useFakeTimers();
    const statusHandler = jest.fn();
    controller.on('status', statusHandler);

    controller.startStatusPolling(100);
    mockConnection.MOCK_send_response =
      '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|F:0.0>';
    jest.advanceTimersByTime(100);
    await Promise.resolve(); // Allow promises to resolve
    expect(statusHandler).toHaveBeenCalled();

    const callCount = statusHandler.mock.calls.length;
    jest.advanceTimersByTime(100);
    await Promise.resolve(); // Allow promises to resolve
    expect(statusHandler.mock.calls.length).toBeGreaterThan(callCount);

    controller.stopStatusPolling();
    const finalCallCount = statusHandler.mock.calls.length;
    jest.advanceTimersByTime(100);
    await Promise.resolve(); // Allow promises to resolve
    expect(statusHandler.mock.calls.length).toBe(finalCallCount);
    jest.useRealTimers();
  });

  it('should perform homing', async () => {
    await controller.home();
    expect(sendSpy).toHaveBeenCalledWith('$H');

    await controller.home('XY');
    expect(sendSpy).toHaveBeenCalledWith('$HXY');
  });

  it('should perform jogging', async () => {
    await controller.jog({ x: 10, y: -5 }, 1000);
    expect(sendSpy).toHaveBeenCalledWith('$J=G91 X10 Y-5 F1000');
  });

  it('should stream G-code from a string', async () => {
    const progressHandler = jest.fn();
    const completeHandler = jest.fn();
    controller.on('jobProgress', progressHandler);
    controller.on('jobComplete', completeHandler);

    await controller.streamGCode('G0 X10\nG1 Y20 F500');

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(progressHandler).toHaveBeenCalledTimes(2);
    expect(completeHandler).toHaveBeenCalledTimes(1);
  });

  it('should stream G-code from a file', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue('G0 Z10\nG1 X0 Y0 F1000');
    await controller.streamGCode('/path/to/file.gcode', true);

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.gcode', 'utf8');
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('should perform a probe', async () => {
    const result = await controller.probe('Z', 50, -10);
    expect(result).toEqual(expect.objectContaining({ success: true }));
  }, 10000);

  it('should perform a grid probe', async () => {
    let probeCount = 0;
    const probeSpy = jest.spyOn(controller, 'probe').mockImplementation(async () => {
      probeCount++;
      return {
        x: probeCount,
        y: probeCount,
        z: probeCount * 10,
        success: true,
        axis: 'Z',
        distance: -10,
        feedRate: 50,
        rawResponse: 'ok',
      };
    });

    // Temporarily relax soft limits for this test
    (controller as any).safetySystem.softLimits = {
      x: { min: -100, max: 100 },
      y: { min: -100, max: 100 },
      z: { min: -100, max: 100 },
    };

    const results = await controller.probeGrid({ x: 10, y: 10 }, 10, 50);

    expect(results.length).toBe(4);
    expect(probeCount).toBe(4);
    probeSpy.mockRestore();
  }, 10000);

  test('should validate safe commands', async () => {
    await expect(controller.sendCommand('?')).resolves.not.toThrow();
  });

  test('should emit a warning for unsafe commands', async () => {
    const warningHandler = jest.fn();
    controller.on('warning', warningHandler);
    await controller.sendCommand('M3 S1000');
    expect(warningHandler).toHaveBeenCalledWith(
      'Unsafe command M3 S1000 requires confirmation'
    );
  });

  test('should reject unsafe movement', async () => {
    await expect(controller.sendCommand('G0 X1000 Y1000 Z1000')).rejects.toThrow(
      'exceeds soft limits'
    );
  });

  test('should handle emergency stop', async () => {
    controller.sendCommand('G0 X10 Y10').catch(() => {});
    controller.sendCommand('G0 X20 Y20').catch(() => {});
    await controller.emergencyStop();
    expect((controller as any).commandManager.getQueueStatus().length).toBe(0);
    expect(sendSpy).toHaveBeenCalledWith('\x18');
  });

  test('should handle feed hold', async () => {
    await controller.feedHold();
    expect(sendSpy).toHaveBeenCalledWith('!');
  });

  test('should handle soft reset', async () => {
    await controller.softReset();
    expect(sendSpy).toHaveBeenCalledWith('\x18');
  });

  test('should queue commands when busy', async () => {
    const promises = [
      controller.sendCommand('G0 X10'),
      controller.sendCommand('G0 Y10'),
      controller.sendCommand('G0 Z10'),
    ];
    await Promise.all(promises);
    expect(sendSpy).toHaveBeenCalledTimes(3);
  });

  test('should retry failed commands', async () => {
    let attempt = 0;
    sendSpy.mockImplementation(async () => {
      attempt++;
      if (attempt < 2) {
        throw new Error('Simulated failure');
      }
      mockConnection.emit('data', 'ok');
    });

    await expect(controller.sendCommand('?')).resolves.toBe('ok');
    expect(attempt).toBe(2);
  }, 10000);
});
