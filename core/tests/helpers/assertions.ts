// tests/helpers/assertions.ts
import { IGrblStatus } from '../../src/types';

export const assertGrblStatus = (
  actual: IGrblStatus,
  expected: Partial<IGrblStatus>
) => {
  if (expected.state !== undefined) {
    expect(actual.state).toBe(expected.state);
  }
  
  if (expected.position !== undefined) {
    expect(actual.position).toEqual(expected.position);
  }
  
  if (expected.feed !== undefined) {
    expect(actual.feed).toBe(expected.feed);
  }
};

export const assertCommandSent = (
  sendCommandSpy: jest.SpyInstance,
  expectedCommand: string,
  callIndex: number = 0
) => {
  expect(sendCommandSpy).toHaveBeenNthCalledWith(callIndex + 1, expectedCommand);
};

export const assertGCodeCommandsSent = (
  sendCommandSpy: jest.SpyInstance,
  expectedCommands: string[]
) => {
  expect(sendCommandSpy).toHaveBeenCalledTimes(expectedCommands.length);
  
  expectedCommands.forEach((command, index) => {
    assertCommandSent(sendCommandSpy, command, index);
  });
};