// tests/fixtures/gcode-fixtures.ts
export const GCODE_FIXTURES = {
  simpleMovement: `G1 X10 Y20 F100
G1 Z-5 F50
G0 X0 Y0`,

  circle: `G17 ; XY plane
G2 X10 Y0 I5 J0 F100
G2 X0 Y0 I-5 J0`,

  withComments: `; Start of program
G90 ; Absolute positioning
G21 ; Millimeters
G1 X100 Y100 F1000
; Move to position
G1 Z-10 F500
; End of program`,

  invalid: `G1 X10
G0 Y20
INVALID_COMMAND
G1 Z-5`,
};

export const GRBL_RESPONSES = {
  OK: 'ok',
  ERROR: 'error',
  ALARM: 'alarm',
  STATUS_IDLE: '<Idle|MPos:0.000,0.000,0.000|F:0>',
  STATUS_RUN: '<Run|MPos:10.000,20.000,5.000|F:100>',
  STATUS_HOLD: '<Hold|MPos:15.000,25.000,10.000|F:150>',
};