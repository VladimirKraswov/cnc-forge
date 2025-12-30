import { CncController } from '../controller/CncController';
import { GCodeParser } from '../gcode/GCodeParser';
import { SafetySystem } from '../safety/SafetySystem';
import { Coordinates, GCodeBlock, MachineLimits } from '../gcode/types';
import {
  Job,
  JobOptions,
  JobLoadResult,
  JobStartResult,
  JobExecutionResult,
  JobState,
  JobStateSaveResult,
  JobStateLoadResult,
  CrashPosition,
  JobResumeResult,
  ExecutionStats
} from './types';

export class JobManager {
  private controller: CncController
  private parser: GCodeParser
  private safety: SafetySystem
  private machineProfile: MachineLimits

  private currentJob: Job | null = null
  private jobQueue: Job[] = []
  private jobHistory: Job[] = []
  private maxHistorySize: number = 100

  private isRunning: boolean = false
  private isPaused: boolean = false
  private pausePosition: number = 0
  private pauseCoordinates: Coordinates = { x: 0, y: 0, z: 0 }

  private executionStats: ExecutionStats = {
    jobsCompleted: 0,
    jobsFailed: 0,
    totalRuntime: 0,
    totalLinesExecuted: 0,
    lastError: null
  }

  constructor(controller: CncController, parser: GCodeParser, safety: SafetySystem, machineProfile: MachineLimits) {
    this.controller = controller
    this.parser = parser
    this.safety = safety
    this.machineProfile = machineProfile;

    // Периодическое сохранение состояния
    setInterval(() => this.autoSaveState(), 60000) // Каждую минуту
  }

  setMachineProfile(profile: MachineLimits): void {
    this.machineProfile = profile;
  }

  // Загрузка задания
  async loadJob(
    source: string | File,
    name?: string,
    options: JobOptions = {}
  ): Promise<JobLoadResult> {
    const startTime = Date.now()

    try {
      console.log(`Loading job: ${name || 'unnamed'}`)

      // Загрузка G-code
      let gcode: string
      if (typeof source === 'string') {
        // Проверяем, это путь к файлу или сам G-code
        if (source.includes('\n') || source.length < 256) {
          gcode = source // Сам G-code
        } else {
          // Загрузка из файла (в браузере через File API)
          throw new Error('File loading not implemented in this example')
        }
      } else {
        // Загрузка из объекта File
        gcode = await (source as any).text()
      }

      // Парсинг G-code
      const parseResult = this.parser.parse(gcode)

      if (!parseResult.success && options.strict) {
        throw new Error(`G-code parsing failed: ${parseResult.errors[0]?.message}`)
      }

      // Проверка безопасности
      const safetyCheck = this.parser.checkSafety(parseResult.blocks, this.machineProfile)

      if (!safetyCheck.safe && options.strict) {
        throw new Error(`Safety check failed: ${safetyCheck.issues[0]?.message}`)
      }

      // Оптимизация (если включено)
      let blocks = parseResult.blocks
      if (options.optimize) {
        blocks = this.parser.optimize(blocks)
      }

      // Создание задания
      const job: Job = {
        id: this.generateJobId(),
        name: name || `Job_${Date.now()}`,
        filename: typeof source === 'string' && source.length < 256 ? source : undefined,
        gcode: gcode,
        blocks: blocks,
        parseResult: parseResult,
        safetyCheck: safetyCheck,
        totalLines: blocks.length,
        progress: 0,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        options: options
      }

      const loadTime = Date.now() - startTime

      const result: JobLoadResult = {
        success: true,
        job,
        parseResult,
        safetyCheck,
        loadTime,
        warnings: [
          ...parseResult.warnings.map(w => w.message),
          ...safetyCheck.warnings.map(w => w.message)
        ]
      }

      console.log(`✓ Job loaded in ${loadTime}ms: ${job.name} (${job.totalLines} blocks)`)
      this.controller.emit('jobLoaded', result)

      // Добавляем в очередь или сразу делаем текущим
      if (options.autoStart) {
        this.currentJob = job
        job.status = 'ready'
      } else {
        this.jobQueue.push(job)
      }

      return result

    } catch (error) {
      const loadTime = Date.now() - startTime

      const result: JobLoadResult = {
        success: false,
        job: null,
        error: error as Error,
        loadTime
      }

      console.error(`✗ Job load failed in ${loadTime}ms:`, error)
      this.controller.emit('jobLoadFailed', result)

      return result
    }
  }

  // Запуск задания
  async startJob(jobId?: string): Promise<JobStartResult> {
    if (this.isRunning) {
      throw new Error('Job already running')
    }

    const startTime = Date.now()

    try {
      // Получаем задание
      let job: Job | undefined;
      if (jobId) {
        job = this.findJob(jobId)
      } else if (this.currentJob) {
        job = this.currentJob
      } else if (this.jobQueue.length > 0) {
        job = this.jobQueue.shift()
      }

      if (!job) {
        throw new Error('No job to run')
      }

      // Проверки перед запуском
      await this.preJobChecks(job)

      // Настройка задания
      job.status = 'running'
      job.startedAt = new Date()
      job.progress = 0
      this.currentJob = job
      this.isRunning = true
      this.isPaused = false

      console.log(`Starting job: ${job.name}`)
      this.controller.emit('jobStarted', { job })

      // Запуск выполнения
      const executionPromise = this.executeJob(job)

      // Обработка завершения
      executionPromise
        .then(result => {
          this.handleJobCompletion(job, result)
        })
        .catch(error => {
          this.handleJobFailure(job, error)
        })

      const result: JobStartResult = {
        success: true,
        job,
        startTime: new Date(),
        estimatedDuration: job.parseResult.estimatedTime
      }

      return result

    } catch (error) {
      const result: JobStartResult = {
        success: false,
        job: null,
        error: error as Error,
        startTime: new Date()
      }

      console.error('Job start failed:', error)
      this.controller.emit('jobStartFailed', result)

      return result
    }
  }

  // Выполнение задания
  private async executeJob(job: Job, startIndex: number = 0): Promise<JobExecutionResult> {
    const startTime = Date.now()
    const blocks = job.blocks.slice(startIndex);
    const totalBlocks = job.blocks.length;

    let executedBlocks = startIndex;
    let failedBlocks = 0
    let lastError: Error | null = null

    console.log(`Executing ${totalBlocks} blocks...`)

    try {
      // Предварительные команды (только при старте с начала)
      if (startIndex === 0) {
        await this.sendPreJobCommands(job);
      }

      // Выполнение блока за блоком
      for (let i = 0; i < blocks.length; i++) {
        // Проверка паузы
        if (this.isPaused) {
          await this.waitForResume()
        }

        // Проверка остановки
        if (!this.isRunning) {
          console.log('Job execution stopped by user')
          break
        }

        const block = blocks[i]

        try {
          // Отправка команды
          const response = await this.controller.sendCommand(block.code, 10000)

          executedBlocks++
          job.progress = (i + 1) / totalBlocks * 100

          // Обновление статистики
          this.executionStats.totalLinesExecuted++

          // Отправка прогресса
          this.controller.emit('jobProgress', {
            job,
            current: i + 1,
            total: totalBlocks,
            block,
            percentage: job.progress,
            response
          })

          // Небольшая пауза между командами для стабилизации
          if (i < totalBlocks - 1) {
            await new Promise(resolve => setTimeout(resolve, 10))
          }

        } catch (error) {
          failedBlocks++
          lastError = error as Error

          console.error(`Block ${i + 1} failed:`, error)
          this.controller.emit('jobBlockFailed', {
            job,
            block,
            error: error as Error,
            blockIndex: i
          })

          // Обработка ошибки в зависимости от настроек
          if (job.options.stopOnError) {
            throw error
          } else if (job.options.retryOnError) {
            // Попытка повтора
            const retrySuccess = await this.retryBlock(block, i, job)
            if (!retrySuccess) {
              if (job.options.stopOnError) {
                throw error
              } else {
                console.warn(`Skipping block ${i + 1} after failed retry`)
              }
            }
          }
        }
      }

      // Завершающие команды
      await this.sendPostJobCommands(job)

      const duration = Date.now() - startTime

      const result: JobExecutionResult = {
        success: failedBlocks === 0,
        job,
        duration,
        executedBlocks,
        failedBlocks,
        lastError,
        averageBlockTime: duration / executedBlocks,
        completionTime: new Date()
      }

      return result

    } catch (error) {
      const duration = Date.now() - startTime

      const result: JobExecutionResult = {
        success: false,
        job,
        duration,
        executedBlocks,
        failedBlocks,
        lastError: error as Error,
        error: error as Error,
        completionTime: new Date()
      }

      return result
    }
  }

  // Пауза выполнения
  async pauseJob(): Promise<void> {
    if (!this.isRunning || this.isPaused) {
      return
    }

    console.log('Pausing job...')

    try {
      // Feed hold
      await this.controller.feedHold()

      this.isPaused = true
      this.pausePosition = this.currentJob?.progress || 0

      // Сохраняем текущие координаты
      const status = await this.controller.getStatus().catch(() => null)
      if (status) {
        this.pauseCoordinates = status.position
      }

      if (this.currentJob) {
        this.currentJob.status = 'paused'
        this.controller.emit('jobPaused', {
          job: this.currentJob,
          position: this.pausePosition,
          coordinates: this.pauseCoordinates
        })
      }

      console.log('✓ Job paused')

    } catch (error) {
      console.error('Job pause failed:', error)
      throw error
    }
  }

  // Возобновление выполнения
  async resumeJob(): Promise<void> {
    if (!this.isPaused) {
      return
    }

    console.log('Resuming job...')

    try {
      // Проверка, что станок готов
      const status = await this.controller.getStatus()
      if (status.state !== 'Hold' && status.state !== 'Idle') {
        throw new Error(`Cannot resume from state: ${status.state}`)
      }

      // Возобновление
      await this.controller.sendCommand('~') // Resume (в GRBL)

      this.isPaused = false
      if (this.currentJob) {
        this.currentJob.status = 'running'
        this.controller.emit('jobResumed', {
          job: this.currentJob,
          position: this.pausePosition
        })
      }

      console.log('✓ Job resumed')

    } catch (error) {
      console.error('Job resume failed:', error)
      throw error
    }
  }

  // Остановка задания
  async stopJob(emergency: boolean = false): Promise<void> {
    console.log(`${emergency ? 'Emergency' : 'Normal'} job stop...`)

    try {
      if (emergency) {
        await this.controller.emergencyStop()
      } else {
        await this.controller.feedHold()
        // Даем время на завершение текущего движения
        await new Promise(resolve => setTimeout(resolve, 1000))
        await this.controller.softReset()
      }

      this.isRunning = false
      this.isPaused = false

      if (this.currentJob) {
        this.currentJob.status = 'stopped'
        this.currentJob.stoppedAt = new Date()

        this.controller.emit('jobStopped', {
          job: this.currentJob,
          emergency,
          position: this.currentJob.progress
        })
      }

      console.log('✓ Job stopped')

    } catch (error) {
      console.error('Job stop failed:', error)
      throw error
    }
  }

  // Продолжение после сбоя
  async resumeAfterCrash(): Promise<JobResumeResult> {
    if (!this.currentJob || this.isRunning) {
      throw new Error('No job to resume or job already running')
    }

    console.log('Attempting to resume job after crash...')

    try {
      // Определяем, где остановились
      const crashPosition = await this.determineCrashPosition()

      if (!crashPosition.found) {
        throw new Error('Could not determine crash position')
      }

      // Восстановление позиции
      await this.recoverToSafePosition()

      // Переход к точке останова
      await this.moveToResumePosition(crashPosition)

      if (!this.currentJob) {
        throw new Error('Current job is not defined after crash recovery');
      }

      // Возобновление выполнения
      this.currentJob.status = 'running'
      this.isRunning = true
      this.currentJob.progress = crashPosition.progressPercentage || 0

      // Пропускаем уже выполненные блоки
      const startIndex = Math.floor((crashPosition.progressPercentage || 0) / 100 * this.currentJob.totalLines)

      const result: JobResumeResult = {
        success: true,
        job: this.currentJob,
        resumePosition: crashPosition,
        startIndex,
        resumedAt: new Date()
      }

      this.controller.emit('jobResumedAfterCrash', result)

      // Продолжаем выполнение
      this.executeJobFromIndex(startIndex)

      return result

    } catch (error) {
      const result: JobResumeResult = {
        success: false,
        job: this.currentJob,
        error: error as Error,
        resumedAt: new Date()
      }

      console.error('Resume after crash failed:', error)
      this.controller.emit('jobResumeFailed', result)

      return result
    }
  }

  // Сохранение и загрузка состояния
  async saveJobState(filename?: string): Promise<JobStateSaveResult> {
    if (!this.currentJob) {
      throw new Error('No current job to save')
    }

    const state: JobState = {
      jobId: this.currentJob.id,
      progress: this.currentJob.progress,
      status: this.currentJob.status,
      isPaused: this.isPaused,
      isRunning: this.isRunning,
      timestamp: new Date(),
      machineState: await this.controller.getStatus().catch(() => null),
      executionStats: { ...this.executionStats },
      blocksExecuted: Math.floor(this.currentJob.progress / 100 * this.currentJob.totalLines)
    }

    // Сохраняем в localStorage или файл
    const stateString = JSON.stringify(state, null, 2)
    const stateName = filename || `jobstate_${this.currentJob.id}_${Date.now()}.json`

    try {
      // В браузере
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(`cnc_job_state_${this.currentJob.id}`, stateString)
      }

      // Или создаем файл для скачивания
      const blob = new Blob([stateString], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const result: JobStateSaveResult = {
        success: true,
        filename: stateName,
        state,
        downloadUrl: url,
        savedAt: new Date()
      }

      console.log(`Job state saved: ${stateName}`)
      this.controller.emit('jobStateSaved', result)

      return result

    } catch (error) {
      const result: JobStateSaveResult = {
        success: false,
        filename: stateName,
        error: error as Error,
        savedAt: new Date()
      }

      console.error('Job state save failed:', error)
      this.controller.emit('jobStateSaveFailed', result)

      return result
    }
  }

  async loadJobState(stateString: string): Promise<JobStateLoadResult> {
    try {
      const state: JobState = JSON.parse(stateString)

      // Восстанавливаем задание
      const job = this.findJob(state.jobId)
      if (!job) {
        throw new Error(`Job ${state.jobId} not found`)
      }

      this.currentJob = job
      this.isRunning = state.isRunning
      this.isPaused = state.isPaused
      job.progress = state.progress
      job.status = state.status

      // Восстанавливаем статистику
      this.executionStats = state.executionStats

      const result: JobStateLoadResult = {
        success: true,
        job,
        state,
        loadedAt: new Date(),
        canResume: this.canResumeFromState(state)
      }

      console.log(`Job state loaded: ${job.name} at ${state.progress.toFixed(1)}%`)
      this.controller.emit('jobStateLoaded', result)

      return result

    } catch (error) {
      const result: JobStateLoadResult = {
        success: false,
        error: error as Error,
        loadedAt: new Date()
      }

      console.error('Job state load failed:', error)
      this.controller.emit('jobStateLoadFailed', result)

      return result
    }
  }

  // Вспомогательные методы
  private async preJobChecks(job: Job): Promise<void> {
    console.log('Performing pre-job checks...')

    // 1. Проверка подключения
    if (!this.controller.isConnected()) {
      throw new Error('Machine not connected')
    }

    // 2. Проверка состояния станка
    const status = await this.controller.getStatus()
    if (status.state === 'Alarm') {
      throw new Error('Machine in alarm state. Clear alarm before starting job.')
    }

    // 3. Проверка хоминга
    const safetyStatus = this.controller.getSafetyStatus()
    if (!safetyStatus.isHomed && job.options.requireHoming) {
      throw new Error('Machine not homed. Home machine before starting job.')
    }

    // 4. Проверка границ
    const bbox = job.parseResult.boundingBox
    if (bbox && bbox.size) {
        if ((bbox.size.x ?? 0) > safetyStatus.limits.x.max - safetyStatus.limits.x.min ||
            (bbox.size.y ?? 0) > safetyStatus.limits.y.max - safetyStatus.limits.y.min ||
            (bbox.size.z ?? 0) > safetyStatus.limits.z.max - safetyStatus.limits.z.min) {
          console.warn('Job bounding box exceeds soft limits. Proceed with caution.')
        }
    }

    // 5. Проверка инструмента
    if (job.options.toolCheck) {
      console.log('Verify tool is installed and secure')
      // Здесь можно добавить подтверждение пользователя
    }

    // 6. Проверка материала
    if (job.options.materialCheck) {
      console.log('Verify workpiece is properly secured')
      // Здесь можно добавить подтверждение пользователя
    }

    console.log('✓ Pre-job checks passed')
  }

  private async sendPreJobCommands(job: Job): Promise<void> {
    console.log('Sending pre-job commands...')

    // 1. Установка безопасной высоты
    await this.controller.sendCommand('G0 Z20 F500')

    // 2. Переход в абсолютные координаты (если не установлено)
    await this.controller.sendCommand('G90')

    // 3. Установка единиц (мм)
    await this.controller.sendCommand('G21')

    // 4. Сброс смещений
    await this.controller.sendCommand('G92 X0 Y0 Z0')

    // 5. Команды из настроек задания
    if (job.options.preJobCommands) {
      for (const cmd of job.options.preJobCommands) {
        await this.controller.sendCommand(cmd)
      }
    }

    console.log('✓ Pre-job commands sent')
  }

  private async sendPostJobCommands(job: Job): Promise<void> {
    console.log('Sending post-job commands...')

    try {
      // 1. Остановка шпинделя
      await this.controller.sendCommand('M5')

      // 2. Выключение охлаждения
      await this.controller.sendCommand('M9')

      // 3. Подъем инструмента
      await this.controller.sendCommand('G0 Z30 F500')

      // 4. Возврат в нулевую позицию
      await this.controller.sendCommand('G0 X0 Y0 F1000')

      // 5. Команды из настроек задания
      if (job.options.postJobCommands) {
        for (const cmd of job.options.postJobCommands) {
          await this.controller.sendCommand(cmd)
        }
      }

      console.log('✓ Post-job commands sent')

    } catch (error) {
      console.warn('Some post-job commands failed:', error)
    }
  }

  private async retryBlock(block: GCodeBlock, index: number, job: Job): Promise<boolean> {
    console.log(`Retrying block ${index + 1}: ${block.code}`)

    const maxRetries = job.options.retryCount || 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Retry attempt ${attempt}/${maxRetries}`)

        // Небольшая пауза перед повторной попыткой
        await new Promise(resolve => setTimeout(resolve, 500 * attempt))

        const response = await this.controller.sendCommand(block.code, 10000)

        console.log(`✓ Block retry successful on attempt ${attempt}`)
        return true

      } catch (error) {
        console.log(`Retry attempt ${attempt} failed:`, (error as Error).message)

        if (attempt === maxRetries) {
          console.error(`Block ${index + 1} failed after ${maxRetries} retries`)
          return false
        }
      }
    }

    return false
  }

  private async waitForResume(): Promise<void> {
    console.log('Job paused, waiting for resume...')

    // Ожидание снятия паузы
    while (this.isPaused && this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    if (!this.isRunning) {
      throw new Error('Job stopped while paused')
    }

    console.log('Resume detected, continuing...')
  }

  private async determineCrashPosition(): Promise<CrashPosition> {
    try {
      const status = await this.controller.getStatus();
      const progress = this.currentJob?.progress || 0;
      const estimatedBlockIndex = Math.floor(progress / 100 * (this.currentJob?.totalLines || 1));

      return {
        found: true,
        coordinates: status.position,
        progressPercentage: progress,
        estimatedBlockIndex: estimatedBlockIndex,
        machineState: status.state,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        found: false,
        error: error as Error,
        timestamp: new Date()
      };
    }
  }

  private async recoverToSafePosition(): Promise<void> {
    console.log('Recovering to safe position...')

    try {
      // 1. Остановка любых движений
      await this.controller.feedHold()

      // 2. Подъем оси Z
      await this.controller.sendCommand('G0 Z20 F300').catch(() => {})

      // 3. Сброс аварийного состояния
      await this.controller.sendCommand('$X').catch(() => {})

      console.log('✓ Safe position recovered')

    } catch (error) {
      console.error('Safe position recovery failed:', error)
      throw error
    }
  }

  private async moveToResumePosition(position: CrashPosition): Promise<void> {
    if (!position.found || !position.coordinates) {
      throw new Error('Cannot move to unknown position')
    }

    console.log(`Moving to resume position: X${position.coordinates.x}, Y${position.coordinates.y}, Z${position.coordinates.z}`)

    try {
      // Перемещение с безопасной высоты
      await this.controller.sendCommand(`G0 Z${(position.coordinates.z || 0) + 10} F500`)
      await this.controller.sendCommand(`G0 X${position.coordinates.x} Y${position.coordinates.y} F1000`)
      await this.controller.sendCommand(`G0 Z${position.coordinates.z} F300`)

      console.log('✓ Moved to resume position')

    } catch (error) {
      console.error('Move to resume position failed:', error)
      throw error
    }
  }

  private executeJobFromIndex(startIndex: number): void {
    if (!this.currentJob) return;

    const job = this.currentJob;
    console.log(`Resuming job ${job.name} from block ${startIndex + 1}`);

    const executionPromise = this.executeJob(job, startIndex);

    executionPromise
        .then(result => {
            this.handleJobCompletion(job, result);
        })
        .catch(error => {
            this.handleJobFailure(job, error);
        });
  }

  private canResumeFromState(state: JobState): boolean {
    // Проверяем, можно ли возобновить из этого состояния
    return (
      state.machineState !== null &&
      state.machineState.state !== 'Alarm' &&
      state.progress > 0 &&
      state.progress < 100
    )
  }

  private handleJobCompletion(job: Job, executionResult: JobExecutionResult): void {
    const duration = executionResult.duration

    job.status = executionResult.success ? 'completed' : 'failed'
    job.completedAt = new Date()
    job.executionResult = executionResult

    // Обновляем статистику
    this.executionStats.jobsCompleted += executionResult.success ? 1 : 0
    this.executionStats.jobsFailed += executionResult.success ? 0 : 1
    this.executionStats.totalRuntime += duration
    this.executionStats.lastError = executionResult.error || null

    // Сохраняем в историю
    this.jobHistory.unshift(job)
    if (this.jobHistory.length > this.maxHistorySize) {
      this.jobHistory.pop()
    }

    // Очищаем текущее задание
    this.currentJob = null
    this.isRunning = false
    this.isPaused = false

    console.log(`Job ${executionResult.success ? 'completed' : 'failed'} in ${(duration / 1000).toFixed(1)}s`)

    this.controller.emit('jobCompleted', {
      job,
      executionResult,
      stats: this.executionStats
    })
  }

  private handleJobFailure(job: Job, error: Error): void {
    console.error(`Job execution failed:`, error)

    job.status = 'failed'
    job.completedAt = new Date()
    job.executionResult = {
      success: false,
      job,
      duration: 0,
      executedBlocks: 0,
      failedBlocks: job.totalLines,
      error,
      lastError: error,
      completionTime: new Date()
    }

    // Обновляем статистику
    this.executionStats.jobsFailed++
    this.executionStats.lastError = error

    this.controller.emit('jobFailed', {
      job,
      error,
      stats: this.executionStats
    })

    // Автоматическое восстановление после сбоя
    this.autoRecoverAfterJobFailure(job, error).catch(console.error)
  }

  private async autoRecoverAfterJobFailure(job: Job, error: Error): Promise<void> {
    console.log('Starting auto-recovery after job failure...')

    try {
      // 1. Остановка станка
      await this.controller.emergencyStop().catch(() => {})

      // 2. Подъем инструмента
      await this.controller.sendCommand('G0 Z20 F300').catch(() => {})

      // 3. Сброс состояния
      await this.controller.sendCommand('$X').catch(() => {})

      // 4. Сохранение состояния для ручного восстановления
      await this.saveJobState(`crash_recovery_${job.id}_${Date.now()}.json`)

      console.log('✓ Auto-recovery completed')
      console.log('Recommendations:')
      console.log('1. Check for mechanical issues')
      console.log('2. Verify workpiece is still secure')
      console.log('3. Consider resuming from saved state')

    } catch (recoveryError) {
      console.error('Auto-recovery failed:', recoveryError)
      console.log('Manual intervention required')
    }
  }

  private async autoSaveState(): Promise<void> {
    if (!this.isRunning || !this.currentJob) {
      return
    }

    try {
      await this.saveJobState(`autosave_${this.currentJob.id}.json`)
      console.log('Auto-saved job state')
    } catch (error) {
      console.warn('Auto-save failed:', error)
    }
  }

  private findJob(jobId: string): Job {
    // Ищем в текущем задании
    if (this.currentJob && this.currentJob.id === jobId) {
      return this.currentJob
    }

    // Ищем в очереди
    const queuedJob = this.jobQueue.find(j => j.id === jobId)
    if (queuedJob) {
      return queuedJob
    }

    // Ищем в истории
    const historicalJob = this.jobHistory.find(j => j.id === jobId)
    if (historicalJob) {
      return historicalJob
    }

    throw new Error(`Job ${jobId} not found`)
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Публичные методы для управления
  getCurrentJob(): Job | null {
    return this.currentJob
  }

  getJobQueue(): Job[] {
    return [...this.jobQueue]
  }

  getJobHistory(): Job[] {
    return [...this.jobHistory]
  }

  getExecutionStats(): ExecutionStats {
    return { ...this.executionStats }
  }

  clearJobQueue(): void {
    console.log('Clearing job queue...')
    this.jobQueue = []
    this.controller.emit('jobQueueCleared')
  }

  clearJobHistory(): void {
    console.log('Clearing job history...')
    this.jobHistory = []
    this.controller.emit('jobHistoryCleared')
  }

  removeJob(jobId: string): boolean {
    // Удаляем из очереди
    const queueIndex = this.jobQueue.findIndex(j => j.id === jobId)
    if (queueIndex !== -1) {
      this.jobQueue.splice(queueIndex, 1)
      return true
    }

    // Удаляем из истории
    const historyIndex = this.jobHistory.findIndex(j => j.id === jobId)
    if (historyIndex !== -1) {
      this.jobHistory.splice(historyIndex, 1)
      return true
    }

    return false
  }
}
