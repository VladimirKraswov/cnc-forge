import { CncController } from '../src/controller/CncController';
import { ConnectionType } from '../src/interfaces/Connection';
import { EventEmitter } from 'events';
import fs from 'fs/promises';

// Мокаем ConnectionFactory
jest.mock('../src/connections', () => ({
  ConnectionFactory: {
    create: jest.fn(() => new MockConnection()),
  },
}));

// Мокаем fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

class MockConnection extends EventEmitter {
  isConnected = false;

  connect = jest.fn().mockImplementation(() => {
    this.isConnected = true;
    this.emit('connected');
    return Promise.resolve();
  });

  disconnect = jest.fn().mockImplementation(() => {
    this.isConnected = false;
    this.emit('disconnected');
    return Promise.resolve();
  });

  send = jest.fn().mockImplementation((data: string) => {
    // Синхронно эмитируем ответ, чтобы избежать проблем с таймерами jest
    if (!data.includes('?')) {
        this.emit('data', 'ok');
    }
    return Promise.resolve();
  });
}

describe('CncController', () => {
  let controller: CncController;
  let mockConnection: MockConnection;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockConnection = new MockConnection();

    const { ConnectionFactory } = require('../src/connections');
    ConnectionFactory.create.mockReturnValue(mockConnection);

    controller = new CncController();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should connect and disconnect', async () => {
    const options = { type: ConnectionType.Serial, port: '/dev/test' };

    await controller.connect(options);
    expect(mockConnection.connect).toHaveBeenCalled();
    expect(controller.isConnected()).toBe(true);

    await controller.disconnect();
    expect(mockConnection.disconnect).toHaveBeenCalled();
    expect(controller.isConnected()).toBe(false);
  });

  it('should send a command and receive a response', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await expect(controller.sendCommand('G0 X10')).resolves.toBe('ok');
    expect(mockConnection.send).toHaveBeenCalledWith('G0 X10\n');
  });

  it('should get status', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });

    mockConnection.send.mockImplementation((data: string) => {
      if (data === '?\n') {
        mockConnection.emit('data', '<Idle|MPos:10.000,20.000,30.000|F:100>ok');
      }
      return Promise.resolve();
    });

    const status = await controller.getStatus();
    expect(status).toEqual({
      state: 'Idle',
      position: { x: 10, y: 20, z: 30 },
      feed: 100,
    });
  });

  it('should start and stop status polling', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });

    const statusHandler = jest.fn();
    controller.on('status', statusHandler);

    mockConnection.send.mockImplementation((data: string) => {
      if (data === '?\n') {
        mockConnection.emit('data', '<Idle|MPos:0,0,0|F:0>ok');
      }
      return Promise.resolve();
    });

    controller.startStatusPolling(100);

    jest.advanceTimersByTime(100);
    expect(statusHandler).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(statusHandler).toHaveBeenCalledTimes(2);

    controller.stopStatusPolling();

    jest.advanceTimersByTime(100);
    expect(statusHandler).toHaveBeenCalledTimes(2);
  });

  it('should perform homing', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await controller.home();
    expect(mockConnection.send).toHaveBeenCalledWith('$H\n');

    await controller.home('XY');
    expect(mockConnection.send).toHaveBeenCalledWith('$HXY\n');
  });

  it('should perform jogging', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await controller.jog({ x: 10, y: -5 }, 1000);
    expect(mockConnection.send).toHaveBeenCalledWith('$J=G91 X10 Y-5 F1000\n');
  });

  it('should stream G-code from a string', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });

    const progressHandler = jest.fn();
    const completeHandler = jest.fn();
    controller.on('jobProgress', progressHandler);
    controller.on('jobComplete', completeHandler);

    await controller.streamGCode('G0 X10\nG1 Y20 F500');

    expect(mockConnection.send).toHaveBeenCalledTimes(2);
    expect(progressHandler).toHaveBeenCalledTimes(2);
    expect(completeHandler).toHaveBeenCalledTimes(1);
  });

  it('should stream G-code from a file', async () => {
    (fs.readFile as jest.Mock).mockResolvedValue('G0 Z10\nG1 X0 Y0 F1000');

    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await controller.streamGCode('/path/to/file.gcode', true);

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.gcode', 'utf8');
    expect(mockConnection.send).toHaveBeenCalledTimes(2);
  });

  it('should perform a probe', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });

    // Мокаем setTimeout, чтобы он исполнялся мгновенно
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => cb());

    mockConnection.send.mockImplementation((data: string) => {
        if (data.startsWith('G38.2')) {
            mockConnection.emit('data', 'ok');
        }
        if (data.startsWith('?')) {
            mockConnection.emit('data', '<Idle|MPos:10.000,20.000,5.500|F:100>ok');
        }
        return Promise.resolve();
    });

    const result = await controller.probe('Z', 50, -100);
    expect(result).toEqual(expect.objectContaining({ x: 10, y: 20, z: 5.5, success: true }));
  });

  it('should stop a job', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await controller.stopJob();
    expect(mockConnection.send).toHaveBeenCalledWith('!');
  });

  it('should perform a grid probe', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => cb());

    let probeCount = 0;
    jest.spyOn(controller, 'probe').mockImplementation(async () => {
      probeCount++;
      return { x: probeCount, y: probeCount, z: probeCount * 10, success: true, axis: 'Z', distance: -100, feedRate: 50, rawResponse: 'ok' };
    });

    const results = await controller.probeGrid({ x: 10, y: 10 }, 10, 50);

    expect(results.length).toBe(4);
    expect(probeCount).toBe(4);
  });
});
