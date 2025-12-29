import { MockConnection } from '../src/connections/MockConnection';
import { ConnectionType } from '../src/interfaces/Connection';

describe('Connection System', () => {
  let connection: MockConnection;

  beforeEach(() => {
    connection = new MockConnection({ type: ConnectionType.Serial });
  });

  test('should connect successfully', async () => {
    await connection.connect();
    expect(connection.isConnected).toBe(true);
  });

  test('should monitor connection quality', async () => {
    await connection.connect();
    expect(connection.getConnectionQuality()).toBe('excellent');
  });

  test('should handle disconnection', async () => {
    await connection.connect();
    connection.simulateFailure('disconnect');
    expect(connection.isConnected).toBe(false);
  });

  test('should log command history', async () => {
    await connection.connect();
    await connection.send('?');
    await connection.send('$H');

    const history = connection.getCommandHistory();
    expect(history).toHaveLength(2);
    expect(history[0].cmd).toBe('?');
  });

  test('should attempt reconnection', async () => {
    jest.useFakeTimers();
    const reconnectSpy = jest.spyOn(connection as any, 'reconnect');
    await connection.connect();

    connection.simulateFailure('disconnect');

    // Fast-forward time to trigger reconnect
    jest.runOnlyPendingTimers();
    expect(reconnectSpy).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
