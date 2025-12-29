import { CncController } from '../src/controller/CncController';
import { IConnection, IConnectionOptions, ConnectionType } from '../src/types';
import { EventEmitter } from 'eventemitter3';
import fs from 'fs/promises';

// Mock the ConnectionFactory and IConnection
jest.mock('../src/connections', () => ({
  ConnectionFactory: {
    create: jest.fn(),
  },
}));

// Mock fs/promises
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

class MockConnection extends EventEmitter implements IConnection {
  isConnected: boolean = false;

  connect = jest.fn(async () => {
    this.isConnected = true;
    this.emit('connected');
  });

  disconnect = jest.fn(async () => {
    this.isConnected = false;
    this.emit('disconnected');
  });

  send = jest.fn(async (data: string) => {
    // Simulate GRBL response
    setTimeout(() => this.emit('data', 'ok'), 10);
  });

  // Add other methods if needed by IConnection
}

describe('CncController', () => {
  let controller: CncController;
  let mockConnection: MockConnection;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    mockConnection = new MockConnection();

    // Make ConnectionFactory return our mock
    const { ConnectionFactory } = require('../src/connections');
    ConnectionFactory.create.mockReturnValue(mockConnection);

    controller = new CncController();
  });

  afterEach(() => {
    // Restore real timers after each test to prevent interference
    jest.useRealTimers();
  });

  it('should connect and disconnect', async () => {
    const options: IConnectionOptions = { type: ConnectionType.Serial, port: '/dev/test' };

    await controller.connect(options);
    expect(mockConnection.connect).toHaveBeenCalled();
    expect(controller.isConnected()).toBe(true);

    await controller.disconnect();
    expect(mockConnection.disconnect).toHaveBeenCalled();
    expect(controller.isConnected()).toBe(false);
  });

  it('should send a command and receive a response', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    
    const promise = controller.sendCommand('G0 X10');
    
    // Simulate response
    setTimeout(() => mockConnection.emit('data', 'ok'), 50);
    
    await expect(promise).resolves.toBe('ok');
    expect(mockConnection.send).toHaveBeenCalledWith('G0 X10\n');
  });

  it('should get status', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });

    mockConnection.send.mockImplementation(async (data: string) => {
      if (data === '?\n') {
        setTimeout(() => mockConnection.emit('data', '<Idle|MPos:10,20,30|F:100>'), 10);
      }
    });

    const status = await controller.getStatus();
    expect(status).toEqual({
      state: 'Idle',
      position: { x: 10, y: 20, z: 30 },
      feed: 100,
    });
  });

  it('should start and stop status polling', async () => {
    jest.useFakeTimers();
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });

    const statusHandler = jest.fn();
    controller.on('status', statusHandler);

    mockConnection.send.mockImplementation(async (data: string) => {
      if (data === '?\n') {
        process.nextTick(() => mockConnection.emit('data', '<Idle|MPos:0,0,0|F:0>ok'));
      }
    });

    controller.startStatusPolling(100);

    // Run the first interval
    await jest.runOnlyPendingTimersAsync();
    expect(mockConnection.send).toHaveBeenCalledTimes(1);
    expect(statusHandler).toHaveBeenCalledTimes(1);

    // Run the second interval
    await jest.runOnlyPendingTimersAsync();
    expect(mockConnection.send).toHaveBeenCalledTimes(2);
    expect(statusHandler).toHaveBeenCalledTimes(2);

    controller.stopStatusPolling();

    // This should do nothing now
    await jest.runOnlyPendingTimersAsync();
    expect(mockConnection.send).toHaveBeenCalledTimes(2);
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
    const gcode = 'G0 X10\nG1 Y20 F500';

    const progressHandler = jest.fn();
    controller.on('jobProgress', progressHandler);

    await controller.streamGCode(gcode);

    expect(mockConnection.send).toHaveBeenCalledWith('G0 X10\n');
    expect(mockConnection.send).toHaveBeenCalledWith('G1 Y20 F500\n');
    expect(progressHandler).toHaveBeenCalledTimes(2);
  });

  it('should stream G-code from a file', async () => {
    const gcode = 'G0 Z10\nG1 X0 Y0 F1000';
    (fs.readFile as jest.Mock).mockResolvedValue(gcode);

    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await controller.streamGCode('/path/to/file.gcode', true);

    expect(fs.readFile).toHaveBeenCalledWith('/path/to/file.gcode', 'utf8');
    expect(mockConnection.send).toHaveBeenCalledWith('G0 Z10\n');
    expect(mockConnection.send).toHaveBeenCalledWith('G1 X0 Y0 F1000\n');
  });

  it('should perform a probe', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    
    mockConnection.send.mockImplementation(async (data: string) => {
      if (data.startsWith('G38.2')) {
        setTimeout(() => mockConnection.emit('data', '[PRB:10,20,5.5:1]ok'), 10);
      }
    });

    const result = await controller.probe('Z', 50);
    expect(result).toEqual({ x: 10, y: 20, z: 5.5 });
    expect(mockConnection.send).toHaveBeenCalledWith('G38.2 Z-100 F50\n');
  });

  it('should stop a job', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
    await controller.stopJob();
    expect(mockConnection.send).toHaveBeenCalledWith('!');
  });

  it('should perform a grid probe', async () => {
    await controller.connect({ type: ConnectionType.Serial, port: '/dev/test' });
  
    // Mock getStatus to provide a starting position
    jest.spyOn(controller, 'getStatus').mockResolvedValue({
      state: 'Idle',
      position: { x: 0, y: 0, z: 0 },
      feed: 100,
    });

    // Mock the probe method
    let probeCounter = 0;
    jest.spyOn(controller, 'probe').mockImplementation(async () => {
      probeCounter++;
      return { x: 1, y: 2, z: 3 + probeCounter };
    });

    const gridSize = { x: 10, y: 10 };
    const step = 10;
    const feed = 50;

    const results = await controller.probeGrid(gridSize, step, feed);

    // 2x2 grid = 4 probe points
    expect(results.length).toBe(4);
    expect(controller.getStatus).toHaveBeenCalled();
    expect(controller.probe).toHaveBeenCalledTimes(4);

    // Verify movement commands
    expect(mockConnection.send).toHaveBeenCalledWith('G0 X0 Y0\n');
    expect(mockConnection.send).toHaveBeenCalledWith('G0 X10 Y0\n');
    expect(mockConnection.send).toHaveBeenCalledWith('G0 X0 Y10\n');
    expect(mockConnection.send).toHaveBeenCalledWith('G0 X10 Y10\n');

    // Verify retraction commands
    expect(mockConnection.send).toHaveBeenCalledWith('G91 G0 Z5\n');
    expect(mockConnection.send).toHaveBeenCalledWith('G90\n');
    expect(mockConnection.send.mock.calls.filter(c => c[0] === 'G91 G0 Z5\n').length).toBe(4);
  });
});
