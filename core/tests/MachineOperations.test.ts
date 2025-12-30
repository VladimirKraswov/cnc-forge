import { CncController } from '../src/controller/CncController';
import { HomingSystem } from '../src/operations/HomingSystem';
import { JoggingSystem } from '../src/operations/JoggingSystem';
import { ProbingSystem } from '../src/operations/ProbingSystem';
import { MockConnection } from '../src/connections/MockConnection';
import { ConnectionType } from '../src/interfaces/Connection';
import { ConnectionFactory } from '../src/connections';

// Set a longer timeout for all tests in this file
jest.setTimeout(30000);

describe('Machine Operations', () => {
  let controller: CncController;
  let homing: HomingSystem;
  let jogging: JoggingSystem;
  let probing: ProbingSystem;
  let mockConnection: MockConnection;

  beforeEach(async () => {
    mockConnection = new MockConnection({ type: ConnectionType.Serial });
    jest.spyOn(ConnectionFactory, 'create').mockReturnValue(mockConnection);

    controller = new CncController();
    homing = controller.homingSystem;
    jogging = controller.joggingSystem;
    probing = controller.probingSystem;

    // Use fake timers for all tests in this suite
    jest.useFakeTimers();
  });

  afterEach(async () => {
    // Ensure all pending timers are cleared and restore real timers
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('HomingSystem', () => {
    it('should perform homing sequence', async () => {
      await controller.connect({ type: ConnectionType.Serial });
      const homingPromise = homing.home();

      // Step 1: Pre-home checks and Raise Z
      await jest.advanceTimersByTimeAsync(1100); // raiseZToSafeHeight waits 1000ms

      // Step 2: Home Z-axis
      mockConnection.responses.set('$HZ', 'ok\n');
      mockConnection.responses.set('?', '<Home|MPos:0,0,0|FS:0,0>');
      await jest.advanceTimersByTimeAsync(250); // Let polling happen
      mockConnection.responses.set('?', '<Idle|MPos:0,0,0|FS:0,0>');
      await jest.advanceTimersByTimeAsync(150); // Final poll
      await jest.advanceTimersByTimeAsync(100); // Pause between steps

      // Step 3: Home X-axis
      mockConnection.responses.set('$HX', 'ok\n');
      mockConnection.responses.set('?', '<Home|MPos:0,0,0|FS:0,0>');
      await jest.advanceTimersByTimeAsync(250);
      mockConnection.responses.set('?', '<Idle|MPos:0,0,0|FS:0,0>');
      await jest.advanceTimersByTimeAsync(150);
      await jest.advanceTimersByTimeAsync(100);

      // Step 4: Home Y-axis
      mockConnection.responses.set('$HY', 'ok\n');
      mockConnection.responses.set('?', '<Home|MPos:0,0,0|FS:0,0>');
      await jest.advanceTimersByTimeAsync(250);
      mockConnection.responses.set('?', '<Idle|MPos:0,0,0|FS:0,0>');
      await jest.advanceTimersByTimeAsync(150);
      await jest.advanceTimersByTimeAsync(100);

      // Step 5: Post-home actions (moveToZeroPosition waits 2000ms)
      await jest.advanceTimersByTimeAsync(2100);

      const result = await homingPromise;

      expect(result.success).toBe(true);
      expect(result.axesHomed).toEqual(['X', 'Y', 'Z']);
      expect(result.steps).toHaveLength(7);
    });

    it('should handle homing failure', async () => {
        await controller.connect({ type: ConnectionType.Serial });
        mockConnection.responses.set('$HZ', 'error: Homing fail');

        const resultPromise = homing.home();
        await jest.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('Хоминг прерван на шаге home_z');
    });
  });

  describe('JoggingSystem', () => {
    it('should perform safe jog', async () => {
      await controller.connect({ type: ConnectionType.Serial });
      const jogPromise = jogging.jog({ x: 10, y: 5 }, 1000);
      await jest.runAllTimersAsync();
      const result = await jogPromise;

      expect(result.success).toBe(true);
      expect(result.axes).toEqual(['x', 'y']);
    });

    it('should handle jog emergency stop', async () => {
        await controller.connect({ type: ConnectionType.Serial });
        // Don't wait for the jog promise, as it will be cancelled
        const jogPromise = jogging.jog({ x: 100 }, 1000);

        // Simulate the stop command
        await jogging.emergencyStopJog();

        // The promise should be rejected because the command is cleared from the queue
        await expect(jogPromise).rejects.toThrow('Command queue cleared');
    });
  });

  describe('ProbingSystem', () => {
    it('should perform Z-axis probing', async () => {
      await controller.connect({ type: ConnectionType.Serial });
      const probePromise = probing.probe('Z', 100, -50);
      await jest.runAllTimersAsync();
      const result = await probePromise;

      expect(result.success).toBe(true);
      expect(result.axis).toBe('Z');
    });

    it('should perform grid probing', async () => {
        await controller.connect({ type: ConnectionType.Serial });
        // The grid probe has many steps with pauses, so we run all timers to completion
        const gridPromise = probing.probeGrid({ x: 20, y: 20 }, 10, 100);
        await jest.runAllTimersAsync();
        const result = await gridPromise;

        expect(result.success).toBe(true);
        expect(result.pointsProbed).toBe(9); // 3x3 grid for 20x20 with 10 step
    });

    it('should recover from probe failure', async () => {
        await controller.connect({ type: ConnectionType.Serial });
        mockConnection.responses.set('G38.2 Z-50 F100', 'ALARM:5');

        const probePromise = probing.probe('Z', 100, -50);
        await jest.runAllTimersAsync();
        const result = await probePromise;

        expect(result.success).toBe(false);
        expect(result.probeFailure).toBe('no_contact');
    });
  });
});