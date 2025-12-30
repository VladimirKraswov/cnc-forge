import { GCodeParser } from './GCodeParser';
import { MachineLimits } from './types';

describe('GCodeParser', () => {
  let parser: GCodeParser;

  beforeEach(() => {
    parser = new GCodeParser();
  });

  test('should parse simple G-code', () => {
    const gcode = `
      G21 G90
      G0 X10 Y10
      G1 Z-5 F100
      G1 X20 Y20
      M3 S1000
      M5
    `;

    const result = parser.parse(gcode);

    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(6);
    expect(result.boundingBox.size.x).toBe(10); // X10 to X20
    expect(result.estimatedTime).toBeGreaterThan(0);
  });

  test('should detect errors in G-code', () => {
    const gcode = `
      G0 X100
      G1 F-100 ; Invalid feed rate
      G2 X50 Y50 ; Missing I,J or R
    `;

    const result = parser.parse(gcode);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  test('should check safety of G-code', () => {
    const gcode = `
      G0 X1000 Y1000 ; Exceeds limits
      G1 Z-100 F5000 ; Too fast
    `;

    const parseResult = parser.parse(gcode);
    const machineLimits: MachineLimits = {
      maxFeedRate: 3000,
      maxSpindleSpeed: 10000,
      travelLimits: {
        x: { min: 0, max: 300 },
        y: { min: 0, max: 300 },
        z: { min: 0, max: 100 }
      }
    };

    const safetyCheck = parser.checkSafety(parseResult.blocks, machineLimits);

    expect(safetyCheck.safe).toBe(false);
    expect(safetyCheck.issues).toHaveLength(2);
    expect(safetyCheck.travelLimitsExceeded).toBe(true);
  });
});
