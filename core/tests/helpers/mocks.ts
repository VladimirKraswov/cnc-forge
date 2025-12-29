// tests/helpers/mocks.ts
jest.mock('serialport', () => {
  const mockPortInstance: any = {
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      // Для события 'open' сразу вызываем handler
      if (event === 'open') {
        setTimeout(handler, 0);
      }
      return mockPortInstance;
    }),
    write: jest.fn((data: string | Buffer, callback?: (error?: Error | null) => void) => {
      if (callback) {
        callback(null);
      }
      return mockPortInstance;
    }),
    close: jest.fn((callback?: (error?: Error | null) => void) => {
      if (callback) {
        callback(null);
      }
      return mockPortInstance;
    }),
    removeListener: jest.fn(),
    once: jest.fn(),
    removeAllListeners: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    flush: jest.fn(),
    drain: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    // Свойства
    isOpen: true,
    path: '/dev/test',
    baudRate: 115200,
  };

  return {
    SerialPort: jest.fn().mockImplementation(() => {
      return mockPortInstance;
    }),
  };
});

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue('G1 X10\nG1 Y20'),
}));