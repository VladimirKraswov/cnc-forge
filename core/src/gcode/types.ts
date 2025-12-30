// Типы для парсера G-code
export interface Coordinates {
  x?: number
  y?: number
  z?: number
  a?: number
  b?: number
  c?: number
}

export interface GCodeBlock {
  lineNumber: number
  original: string
  code: string
  gCode?: number
  mCode?: number
  modalGroups: { [group: number]: string }
  coordinates?: Coordinates
  feedRate?: number
  spindleSpeed?: number
  toolNumber?: number
  parameters?: { [key: string]: number }
  isValid: boolean
}

export interface GCodeError {
  line: number
  message: string
  severity: 'error' | 'warning' | 'info'
  code: string
}

export interface GCodeWarning extends GCodeError {
  severity: 'warning' | 'info'
}

export interface GCodeParseResult {
  success: boolean
  blocks: GCodeBlock[]
  errors: GCodeError[]
  warnings: GCodeWarning[]
  lineCount: number
  blockCount: number
  estimatedTime: number // секунды
  boundingBox: BoundingBox
}

export interface BoundingBox {
  min: Coordinates
  max: Coordinates
  size: Coordinates
}

export interface MachineLimits {
  maxFeedRate: number
  maxSpindleSpeed: number
  travelLimits: {
    x: { min: number; max: number }
    y: { min: number; max: number }
    z: { min: number; max: number }
  }
}

export interface SafetyIssue {
  line: number
  type: string
  message: string
  severity: 'error' | 'warning'
}

export interface SafetyCheckResult {
  safe: boolean
  issues: SafetyIssue[]
  warnings: SafetyIssue[]
  maxFeedRate: number
  maxSpindleSpeed: number
  travelLimitsExceeded: boolean
}
