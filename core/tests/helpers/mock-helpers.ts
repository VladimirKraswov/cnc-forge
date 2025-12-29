// tests/helpers/mock-helpers.ts
import { EventEmitter } from 'events';

export type MockSerialPort = EventEmitter & {
  write: jest.Mock;
  close: jest.Mock;
  removeListener: jest.Mock;
  isOpen?: boolean;
};

export const createMockSerialPort = (): MockSerialPort => {
  const emitter = new EventEmitter();
  
  const mockPort: MockSerialPort = Object.assign(emitter, {
    write: jest.fn((data: string | Buffer, cb?: (err: Error | null) => void) => {
      if (cb) cb(null);
      return mockPort;
    }),
    close: jest.fn((cb?: (err: Error | null) => void) => {
      if (cb) cb(null);
      return mockPort;
    }),
    removeListener: jest.fn((event: string, listener: (...args: any[]) => void) => {
      emitter.removeListener(event, listener);
      return mockPort;
    }),
    isOpen: true,
  });
  
  return mockPort;
};

export const mockSerialPortResponses = {
  ok: () => Buffer.from('ok\n'),
  error: (message: string = 'Invalid command') => Buffer.from(`error: ${message}\n`),
  alarm: (code: number = 1) => Buffer.from(`alarm:${code}\n`),
  status: (status: string) => Buffer.from(`${status}\n`),
};