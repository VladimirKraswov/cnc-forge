import { ISafetySystem, ValidationResult } from '../interfaces/SafetySystem';
import { IPosition } from '../types';

export class SafetySystem implements ISafetySystem {
  public softLimits = {
    x: { min: 0, max: 300 },
    y: { min: 0, max: 300 },
    z: { min: 0, max: 100 },
  };

  private speedLimits = {
    maxFeedRate: 3000, // mm/min
    maxJogRate: 1000, // mm/min
    maxAcceleration: 500, // mm/s²
  };

  private unsafeCommands = [
    'M3',
    'M4',
    'M5', // Spindle
    'M7',
    'M8',
    'M9', // Cooling
    'G38.2',
    'G38.3',
    'G38.4',
    'G38.5', // Probing
  ];

  // Добавлен геттер для совместимости
  getSoftLimits() {
    return this.softLimits;
  }

  validateCommand(command: string): ValidationResult {
    const trimmed = command.trim().toUpperCase();

    // 1. Check for empty command
    if (!trimmed) {
      return { isValid: false, error: 'Empty command' };
    }

    // 2. Check for unsafe commands (require confirmation)
    if (this.unsafeCommands.some(cmd => trimmed.startsWith(cmd))) {
      return {
        isValid: true,
        warning: `Unsafe command ${trimmed} requires confirmation`,
      };
    }

    // 3. Check movement (G0, G1, G2, G3)
    if (
      trimmed.startsWith('G0') ||
      trimmed.startsWith('G1') ||
      trimmed.startsWith('G2') ||
      trimmed.startsWith('G3')
    ) {
      return this.validateMovementCommand(trimmed);
    }

    // 4. Check jogging ($J=)
    if (trimmed.startsWith('$J=')) {
      return this.validateJogCommand(trimmed);
    }

    return { isValid: true };
  }

  private validateMovementCommand(command: string): ValidationResult {
    // Parse coordinates from G-code
    const coords = this.parseCoordinates(command);

    // Check soft limits
    if (!this.checkSoftLimits(coords)) {
      return {
        isValid: false,
        error: `Movement exceeds soft limits: ${JSON.stringify(coords)}`,
      };
    }

    // Check speed
    const feedRate = this.parseFeedRate(command);
    if (feedRate && feedRate > this.speedLimits.maxFeedRate) {
      return {
        isValid: false,
        error: `Feed rate ${feedRate} exceeds maximum ${this.speedLimits.maxFeedRate}`,
      };
    }

    return { isValid: true };
  }

  private validateJogCommand(command: string): ValidationResult {
    // Parse jogging command
    // Example: $J=G91 X10 Y20 F1000

    const parts = command.substring(4).split(' '); // Remove "$J="
    const coords: IPosition = { x: 0, y: 0, z: 0 };
    let feedRate = 0;

    for (const part of parts) {
      if (part.startsWith('X')) coords.x = parseFloat(part.substring(1));
      else if (part.startsWith('Y')) coords.y = parseFloat(part.substring(1));
      else if (part.startsWith('Z')) coords.z = parseFloat(part.substring(1));
      else if (part.startsWith('F')) feedRate = parseFloat(part.substring(1));
    }

    // Check jogging speed
    if (feedRate > this.speedLimits.maxJogRate) {
      return {
        isValid: false,
        error: `Jog feed rate ${feedRate} exceeds maximum ${this.speedLimits.maxJogRate}`,
      };
    }

    return { isValid: true };
  }

  checkSoftLimits(position: IPosition): boolean {
    return (
      position.x >= this.softLimits.x.min &&
      position.x <= this.softLimits.x.max &&
      position.y >= this.softLimits.y.min &&
      position.y <= this.softLimits.y.max &&
      position.z >= this.softLimits.z.min &&
      position.z <= this.softLimits.z.max
    );
  }

  getSafeTravelHeight(): number {
    return this.softLimits.z.max - 10; // 10 mm below Z maximum
  }

  isSafeToMove(): boolean {
    // Check various safety conditions
    // Can be expanded: check limit switches, temperature, etc.
    return true;
  }

  private parseCoordinates(command: string): IPosition {
    // Simplified G-code parsing
    const xMatch = command.match(/X([\d.-]+)/);
    const yMatch = command.match(/Y([\d.-]+)/);
    const zMatch = command.match(/Z([\d.-]+)/);

    return {
      x: xMatch ? parseFloat(xMatch[1]) : 0,
      y: yMatch ? parseFloat(yMatch[1]) : 0,
      z: zMatch ? parseFloat(zMatch[1]) : 0,
    };
  }

  private parseFeedRate(command: string): number | null {
    const fMatch = command.match(/F([\d.-]+)/);
    return fMatch ? parseFloat(fMatch[1]) : null;
  }

  // Метод для установки новых пределов
  setSoftLimits(limits: typeof this.softLimits): void {
    this.softLimits = { ...limits };
  }

  // Метод для получения текущих скоростных ограничений
  getSpeedLimits() {
    return { ...this.speedLimits };
  }
}