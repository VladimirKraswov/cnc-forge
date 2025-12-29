import { IPosition } from '../types';

export type ValidationResult = {
  isValid: boolean;
  error?: string;
  warning?: string;
};

export interface ISafetySystem {
  validateCommand(command: string): ValidationResult;
  checkSoftLimits(position: IPosition): boolean;
  getSafeTravelHeight(): number;
  isSafeToMove(): boolean;
}
