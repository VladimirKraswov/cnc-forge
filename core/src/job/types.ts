import {
    GCodeBlock,
    GCodeParseResult,
    SafetyCheckResult,
    Coordinates
  } from '../gcode/types';
  import { IGrblStatus } from '../types';

  // Типы для системы управления заданиями
  export interface JobOptions {
    strict?: boolean // Останавливаться на ошибках парсинга
    optimize?: boolean // Оптимизировать G-code
    requireHoming?: boolean // Требовать хоминг перед запуском
    stopOnError?: boolean // Останавливаться при ошибке выполнения
    retryOnError?: boolean // Повторять при ошибке
    retryCount?: number // Количество повторных попыток
    toolCheck?: boolean // Проверка инструмента
    materialCheck?: boolean // Проверка материала
    autoStart?: boolean // Автоматический запуск после загрузки
    preJobCommands?: string[] // Команды перед выполнением
    postJobCommands?: string[] // Команды после выполнения
  }

  export interface Job {
    id: string
    name: string
    filename?: string
    gcode: string
    blocks: GCodeBlock[]
    parseResult: GCodeParseResult
    safetyCheck: SafetyCheckResult
    totalLines: number
    progress: number
    status: 'pending' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
    createdAt: Date
    updatedAt: Date
    startedAt?: Date
    completedAt?: Date
    stoppedAt?: Date
    options: JobOptions
    executionResult?: JobExecutionResult
  }

  export interface JobLoadResult {
    success: boolean
    job: Job | null
    parseResult?: GCodeParseResult
    safetyCheck?: SafetyCheckResult
    loadTime: number
    error?: Error
    warnings?: string[]
  }

  export interface JobStartResult {
    success: boolean
    job: Job | null
    startTime: Date
    estimatedDuration?: number
    error?: Error
  }

  export interface JobExecutionResult {
    success: boolean
    job: Job
    duration: number // мс
    executedBlocks: number
    failedBlocks: number
    lastError: Error | null
    averageBlockTime?: number
    completionTime: Date
    error?: Error
  }

  export interface JobState {
    jobId: string
    progress: number
    status: Job['status']
    isPaused: boolean
    isRunning: boolean
    timestamp: Date
    machineState: IGrblStatus | null
    executionStats: ExecutionStats
    blocksExecuted: number
  }

  export interface JobStateSaveResult {
    success: boolean
    filename: string
    state?: JobState
    downloadUrl?: string
    savedAt: Date
    error?: Error
  }

  export interface JobStateLoadResult {
    success: boolean
    job?: Job
    state?: JobState
    loadedAt: Date
    canResume?: boolean
    error?: Error
  }

  export interface CrashPosition {
    found: boolean
    coordinates?: Coordinates
    progressPercentage?: number
    estimatedBlockIndex?: number
    machineState?: string
    timestamp: Date
    error?: Error
  }

  export interface JobResumeResult {
    success: boolean
    job: Job
    resumePosition?: CrashPosition
    startIndex?: number
    resumedAt: Date
    error?: Error
  }

  export interface ExecutionStats {
    jobsCompleted: number
    jobsFailed: number
    totalRuntime: number // мс
    totalLinesExecuted: number
    lastError: Error | null
  }