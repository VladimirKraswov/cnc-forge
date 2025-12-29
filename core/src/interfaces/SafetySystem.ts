import { IPosition } from '../types';
import { ValidationResult } from '../types';

// Safety System
export interface ISafetySystem {
  validateCommand(command: string): ValidationResult;
  checkSoftLimits(position: IPosition): boolean;
  getSafeTravelHeight(): number;
  isSafeToMove(): boolean;
}
