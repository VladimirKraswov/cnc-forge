import { SafetySystem } from '../src/safety/SafetySystem';

describe('SafetySystem', () => {
  let safetySystem: SafetySystem;

  beforeEach(() => {
    safetySystem = new SafetySystem();
  });

  test('should validate a safe command', () => {
    const result = safetySystem.validateCommand('G0 X10 Y20');
    expect(result.isValid).toBe(true);
  });

  test('should reject an empty command', () => {
    const result = safetySystem.validateCommand('');
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('Empty command');
  });

  test('should warn about an unsafe command', () => {
    const result = safetySystem.validateCommand('M3 S1000');
    expect(result.isValid).toBe(true);
    expect(result.warning).toMatch(/unsafe/i);
  });

  test('should reject movement beyond soft limits', () => {
    const result = safetySystem.validateCommand('G0 X1000 Y1000');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('exceeds soft limits');
  });

  test('should reject movement with excessive feed rate', () => {
    const result = safetySystem.validateCommand('G1 X10 F5000');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('exceeds maximum');
  });

  test('should reject jogging with excessive feed rate', () => {
    const result = safetySystem.validateCommand('$J=G91 X10 F2000');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('exceeds maximum');
  });
});
