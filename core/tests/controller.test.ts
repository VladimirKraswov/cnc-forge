import { CncController } from '../src/controller/CncController';
import { ConnectionType } from '../src/interfaces/Connection';
import { MockConnection } from '../src/connections/MockConnection';
import fs from 'fs/promises';

// Мокаем ConnectionFactory
jest.mock('../src/connections', () => ({
  ConnectionFactory: {
    create: jest.fn((options) => new MockConnection(options)),
  },
}));

// Мокаем fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

describe('CncController', () => {
  let controller: CncController;
  let mockConnection: MockConnection;

  beforeEach(async () => {
    controller = new CncController();
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    mockConnection = (controller as any).connection;
  });

  it('should connect and disconnect', async () => {
    expect(controller.isConnected()).toBe(true);
    await controller.disconnect();
    expect(controller.isConnected()).toBe(false);
  });

  it('should send a command and receive a response', async () => {
    await expect(controller.sendCommand('G0 X10')).resolves.toBe('ok');
    expect(mockConnection.getCommandHistory()[0].cmd).toBe('G0 X10\n');
  });

  it('should get status', async () => {
    const status = await controller.getStatus();
    expect(status).toEqual({
      state: 'Idle',
      position: { x: 0, y: 0, z: 0 },
      feed: 0,
    });
  });

  it('should start and stop status polling', () => {
    jest.useFakeTimers();
    const statusHandler = jest.fn();
    controller.on('status', statusHandler);

    controller.startStatusPolling(100);
    jest.advanceTimersByTime(100);
    expect(statusHandler).toHaveBeenCalled();

    const callCount = statusHandler.mock.calls.length;
    jest.advanceTimersByTime(100);
    expect(statusHandler.mock.calls.length).toBeGreaterThan(callCount);

    controller.stopStatusPolling();
    const finalCallCount = statusHandler.mock.calls.length;
    jest.advanceTimersByTime(100);
    expect(statusHandler.mock.calls.length).toBe(finalCallCount);
    jest.useRealTimers();
  });

  it('should perform homing', async () => {
    await controller.home();
    expect(mockConnection.getCommandHistory()[0].cmd).toBe('$H\n');

    await controller.home('XY');
    expect(mockConnection.getCommandHistory()[1].cmd).toBe('$HXY\n');
  });

  it('should perform jogging', async () => {
    await controller.jog({ x: 10, y: -5 }, 1000);
    expect(mockConnection.getCommandHistory()[0].cmd).toBe(
      '$J=G91 X10 Y-5 F1000\n'
    );
  });

  it('should stream G-code from a string', async () => {
    const progressHandler = jest.fn();
    const completeHandler = jest.fn();
    controller.on('jobProgress', progressHandler);
    controller.on('jobComplete', completeHandler);

    await controller.streamGCode('G0 X10\nG1 Y20 F500');

    expect(mockConnection.getCommandHistory()).toHaveLength(2);
    expect(progressHandler).toHaveBeenCalledTimes(2);
    expect(completeHandler).toHaveBeenCalledTimes(1);
  });

  it('should stream G-code from a file', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue('G0 Z10\nG1 X0 Y0 F1000');
    await controller.streamGCode('/path/to/file.gcode', true);

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.gcode', 'utf8');
    expect(mockConnection.getCommandHistory()).toHaveLength(2);
  });

  it('should perform a probe', async () => {
    const result = await controller.probe('Z', 50, -100);
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('should stop a job', async () => {
    await controller.stopJob();
    expect(mockConnection.getCommandHistory()[0].cmd).toBe('!');
  });

  it('should perform a grid probe', async () => {
    let probeCount = 0;
    jest.spyOn(controller, 'probe').mockImplementation(async () => {
      probeCount++;
      return { x: probeCount, y: probeCount, z: probeCount * 10, success: true, axis: 'Z', distance: -100, feedRate: 50, rawResponse: 'ok' };
    });

    const results = await controller.probeGrid({ x: 10, y: 10 }, 10, 50);

    expect(results.length).toBe(4);
    expect(probeCount).toBe(4);
    expect(mockConnection.getCommandHistory()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cmd: 'G0 Z10\n' }),
        expect.objectContaining({ cmd: 'G0 X-5 Y-5\n' }),
        expect.objectContaining({ cmd: 'G0 X5 Y-5\n' }),
        expect.objectContaining({ cmd: 'G0 X-5 Y5\n' }),
        expect.objectContaining({ cmd: 'G0 X5 Y5\n' }),
        expect.objectContaining({ cmd: 'G0 X0 Y0 Z10\n' }),
      ])
    );
  });
});
