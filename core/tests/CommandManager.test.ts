import { CommandManager } from '../src/command/CommandManager';
import { MockConnection } from '../src/connections/MockConnection';
import { ConnectionType } from '../src/interfaces/Connection';

describe('CommandManager', () => {
  let commandManager: CommandManager;
  let mockConnection: MockConnection;

  beforeEach(() => {
    commandManager = new CommandManager();
    mockConnection = new MockConnection({ type: ConnectionType.Serial });
  });

  test('should execute a command', async () => {
    const promise = commandManager.execute('G0 X10', mockConnection);
    await expect(promise).resolves.toBe('ok');
    expect(mockConnection.getCommandHistory()[0].cmd).toBe('G0 X10');
  });

  test('should queue commands and process them sequentially', async () => {
    const sendSpy = jest.spyOn(mockConnection, 'send');
    let commandOrder: number[] = [];

    const promises = [
      commandManager.execute('CMD 1', mockConnection).then(() => commandOrder.push(1)),
      commandManager.execute('CMD 2', mockConnection).then(() => commandOrder.push(2)),
      commandManager.execute('CMD 3', mockConnection).then(() => commandOrder.push(3)),
    ];
    await Promise.all(promises);
    expect(commandOrder).toEqual([1, 2, 3]);
    expect(sendSpy).toHaveBeenCalledTimes(3);
  });

  test('should retry failed commands', async () => {
    let attempt = 0;
    const sendSpy = jest.spyOn(mockConnection, 'send').mockImplementation(async () => {
      attempt++;
      if (attempt < 2) {
        throw new Error('Simulated failure');
      }
      // Manually emit 'ok' for the successful attempt
      mockConnection.emit('data', 'ok');
    });

    await expect(commandManager.execute('?', mockConnection)).resolves.toBe('ok');
    expect(attempt).toBe(2);
  });

  test('should reject after max attempts', async () => {
    const sendSpy = jest.spyOn(mockConnection, 'send').mockRejectedValue(new Error('Simulated failure'));
    await expect(commandManager.execute('?', mockConnection)).rejects.toThrow(
      'Simulated failure'
    );
    expect(sendSpy).toHaveBeenCalledTimes(3);
  }, 10000);

  test('should clear the queue', () => {
    const promise = commandManager.execute('G0 X10', mockConnection);
    promise.catch(() => {}); // Suppress unhandled rejection
    commandManager.clear();
    expect(commandManager.getQueueStatus().length).toBe(0);
  });

  test(
    'should use the correct timeout for each command',
    () => {
      jest.useFakeTimers();
      const sendSpy = jest.spyOn(mockConnection, 'send').mockImplementation(async () => {
        // Don't resolve the promise to simulate a timeout
        return new Promise(() => {});
      });

      let error1: Error | null = null;
      let error2: Error | null = null;

      commandManager.execute('G4 P1', mockConnection, 100).catch(err => (error1 = err));
      commandManager.execute('G4 P2', mockConnection, 500).catch(err => (error2 = err));

      // Advance timers to trigger the first timeout
      jest.advanceTimersByTime(101);
      process.nextTick(() => {
        expect(error1).toEqual(new Error('Response timeout'));

        // Advance timers to trigger the second timeout
        jest.advanceTimersByTime(400);
        process.nextTick(() => {
          expect(error2).toEqual(new Error('Response timeout'));
        });
      });
      jest.useRealTimers();
    },
    10000
  );
});
