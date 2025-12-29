import { ErrorCode, ICncError } from '../types';

export class ErrorHandler {
  static createError(code: ErrorCode, message: string, details?: any): ICncError {
    const error = new Error(message) as ICncError;
    error.code = code;
    error.details = details;
    return error;
  }

  static isConnectionError(error: any): boolean {
    return error.code === ErrorCode.ConnectionFailed || 
           error.code === ErrorCode.ConnectionTimeout;
  }

  static isMachineError(error: any): boolean {
    return error.code === ErrorCode.MachineNotReady ||
           error.code === ErrorCode.HardwareError;
  }

  static formatError(error: Error | ICncError): string {
    if ('code' in error) {
      return `[${error.code}] ${error.message}`;
    }
    return error.message;
  }
}