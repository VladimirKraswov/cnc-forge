import { EventEmitter } from 'events';
import { IGrblStatus, IAlarm, IPosition } from '../types';
import { IConnection, IConnectionOptions } from '../interfaces/Connection';
import { ICncControllerCore, ICncEventEmitter } from '../interfaces/CncController';
import fs from 'fs/promises';
import { ConnectionFactory } from '../connections';
import { CommandManager } from '../command/CommandManager';
import { SafetySystem } from '../safety/SafetySystem';
import { RecoverySystem, RecoveryDiagnosis, RecoveryState } from '../recovery/RecoverySystem';
import { HomingSystem, JoggingSystem, ProbingSystem, HomingResult, JogResult, ProbeResult, GridProbeResult } from '../operations';
import { GCodeParser } from '../gcode/GCodeParser';
import { JobManager } from '../job/JobManager';
import { Job, JobLoadResult, JobOptions, JobResumeResult, JobStartResult } from '../job/types';
import { ExecutionStats } from '../job/types';
import { GCodeParseResult, MachineLimits, SafetyCheckResult } from '../gcode/types';

export class CncController extends EventEmitter implements ICncControllerCore, ICncEventEmitter {
  private machineProfile: MachineLimits;
  private connection: IConnection | null = null;
  private commandManager: CommandManager;
  private safetySystem: SafetySystem;
  private recoverySystem: RecoverySystem;
  private parser: GCodeParser;
  private jobManager: JobManager;
  public homingSystem: HomingSystem;
  public joggingSystem: JoggingSystem;
  public probingSystem: ProbingSystem;
  private lastKnownPosition: IPosition = { x: 0, y: 0, z: 0 };
  private expectedPosition: IPosition = { x: 0, y: 0, z: 0 };
  private positioningMode: 'G90' | 'G91' = 'G90'; // Default to absolute
  private commandJournal: Array<{
    command: string;
    timestamp: Date;
    expectedPositionChange?: Partial<IPosition>;
  }> = [];
  private isHomed: boolean = false;
  private connected: boolean = false;
  private statusPollingIntervalId: NodeJS.Timeout | null = null;
  private lastAlarmCode: number | null = null;

  public getLastAlarmCode(): number | null {
    return this.lastAlarmCode;
  }

  public getExpectedPosition(): IPosition {
    return this.expectedPosition;
  }

  constructor() {
    super();
    this.commandManager = new CommandManager();
    this.safetySystem = new SafetySystem();
    this.machineProfile = this.getDefaultMachineLimits();
    this.recoverySystem = new RecoverySystem();
    this.parser = new GCodeParser();
    this.jobManager = new JobManager(this, this.parser, this.safetySystem, this.machineProfile);
    this.homingSystem = new HomingSystem(this, this.safetySystem);
    this.joggingSystem = new JoggingSystem(this, this.safetySystem);
    this.probingSystem = new ProbingSystem(this, this.safetySystem);

    // Периодическая самодиагностика
    setInterval(() => {
      this.autoDiagnose().catch(console.error);
    }, 30000); // Каждые 30 секунд
  }

  async connect(options: IConnectionOptions): Promise<void> {
    try {
      this.connection = ConnectionFactory.create(options);

      if (this.connection) {
        this.connection.on('connected', () => {
          this.connected = true;
          this.emit('connected');
        });

        this.connection.on('disconnected', () => {
          this.connected = false;
          this.emit('disconnected');
          this.stopStatusPolling();
        });

        this.connection.on('data', (data: string) => {
          this.handleIncomingData(data);
        });

        this.connection.on('error', (error: Error) => {
          this.emit('error', error);
        });

        await this.connection.connect();
      }
    } catch (error) {
      throw new Error(`Connection error: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) throw new Error('Not connected');
    await this.connection.disconnect();
    this.connection = null;
    this.connected = false;
    this.stopStatusPolling();
  }

  isConnected(): boolean {
    return this.connected && (this.connection?.isConnected || false);
  }

  async sendCommand(command: string, timeout?: number): Promise<string> {
    if (!this.connection || !this.connection.isConnected) {
      throw new Error('Not connected to machine');
    }

    const safetyCheck = this.safetySystem.validateCommand(command);
    if (!safetyCheck.isValid) {
      throw new Error(`Safety violation: ${safetyCheck.error}`);
    }

    if (safetyCheck.warning) {
      this.emit('warning', safetyCheck.warning);
    }

    const upperCommand = command.toUpperCase();
    if (upperCommand.includes('G90')) this.positioningMode = 'G90';
    if (upperCommand.includes('G91')) this.positioningMode = 'G91';

    const result = await this.commandManager.execute(command, this.connection, timeout);

    // Логируем команду и ожидаемое изменение позиции
    const expectedChange = this.calculateExpectedPositionChange(command);
    this.commandJournal.push({
      command,
      timestamp: new Date(),
      expectedPositionChange: expectedChange
    });

    // Обновляем ожидаемую позицию
    if (expectedChange) {
      if (upperCommand.startsWith('$J=')) { // Jog commands are always relative
        this.expectedPosition = {
          x: this.expectedPosition.x + (expectedChange.x || 0),
          y: this.expectedPosition.y + (expectedChange.y || 0),
          z: this.expectedPosition.z + (expectedChange.z || 0)
        };
      } else if (this.positioningMode === 'G90') { // Absolute
        this.expectedPosition = {
          x: expectedChange.x ?? this.expectedPosition.x,
          y: expectedChange.y ?? this.expectedPosition.y,
          z: expectedChange.z ?? this.expectedPosition.z
        };
      } else { // Relative
        this.expectedPosition = {
          x: this.expectedPosition.x + (expectedChange.x || 0),
          y: this.expectedPosition.y + (expectedChange.y || 0),
          z: this.expectedPosition.z + (expectedChange.z || 0)
        };
      }
    }

    // Сохраняем только последние 1000 команд
    if (this.commandJournal.length > 1000) {
      this.commandJournal.shift();
    }

    return result;
  }

  private handleIncomingData(data: string): void {
    const trimmedData = data.trim();
    this.emit('statusUpdate', trimmedData);

    if (trimmedData.startsWith('<')) {
      try {
        const status = this.parseGrblStatus(trimmedData);
        this.updatePosition(status.position);
        this.emit('status', status);
      } catch (error) {
        console.warn('Failed to parse GRBL status:', trimmedData);
        // Ignore parsing errors but log them
      }
    }

    if (trimmedData.startsWith('ALARM:')) {
      const alarmCode = parseInt(trimmedData.split(':')[1], 10);
      this.lastAlarmCode = alarmCode;
      const alarmMessage = this.getAlarmMessage(alarmCode);
      const alarm: IAlarm = { code: alarmCode, message: alarmMessage };
      this.emit('alarm', alarm);
    }

    // Handle probe responses
    if (trimmedData.includes('[PRB:')) {
      this.emit('probeResponse', trimmedData);
    }

    // Handle ok responses
    if (trimmedData === 'ok') {
      this.emit('commandResponse', trimmedData);
    }
  }

  private getAlarmMessage(code: number): string {
    const messages: { [key: number]: string } = {
      1: 'Hard limit triggered.',
      2: 'G-code motion target exceeds machine travel.',
      3: 'Reset while in motion.',
      4: 'Probe fail. Not in expected initial state.',
      5: 'Probe fail. Did not contact workpiece.',
      6: 'Homing fail. Reset during homing.',
      7: 'Homing fail. Safety door opened.',
      8: 'Homing fail. Could not clear limit switch.',
      9: 'Homing fail. Could not find limit switch.',
    };
    return messages[code] || `Unknown alarm code: ${code}`;
  }

private parseGrblStatus(response: string): IGrblStatus {
  const match = response.match(
    /<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)\|WPos:([\d.-]+),([\d.-]+),([\d.-]+)\|F:([\d.-]+)>/
  );
  if (match) {
    return {
      state: match[1] as IGrblStatus['state'],
      position: { 
        x: parseFloat(match[2]), 
        y: parseFloat(match[3]), 
        z: parseFloat(match[4]) 
      },
      feed: parseFloat(match[8]),
    };
  }
  
  // Try alternative format (some GRBL versions may have different format)
  const altMatch = response.match(
    /<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)\|FS:([\d.-]+),([\d.-]+)>/
  );
  if (altMatch) {
    return {
      state: altMatch[1] as IGrblStatus['state'],
      position: { 
        x: parseFloat(altMatch[2]), 
        y: parseFloat(altMatch[3]), 
        z: parseFloat(altMatch[4]) 
      },
      feed: parseFloat(altMatch[5]),
    };
  }
  
  throw new Error(`Cannot parse status: ${response}`);
}

  async getStatus(): Promise<IGrblStatus> {
    try {
      const response = await this.sendCommand('?', 5000); // 5 second timeout for status
      return this.parseGrblStatus(response);
    } catch (error) {
      console.error('Failed to get status:', error);
      throw new Error(`Failed to get machine status: ${(error as Error).message}`);
    }
  }

  startStatusPolling(intervalMs: number = 250): void {
    if (this.statusPollingIntervalId) {
      this.stopStatusPolling();
    }
    
    this.statusPollingIntervalId = setInterval(async () => {
      if (this.isConnected()) {
        try {
          await this.sendCommand('?', 1000); // 1 second timeout for polling
        } catch (error) {
          // Don't emit errors for polling, but log them
          console.debug('Status polling error:', error);
        }
      }
    }, intervalMs);
  }

  stopStatusPolling(): void {
    if (this.statusPollingIntervalId) {
      clearInterval(this.statusPollingIntervalId);
      this.statusPollingIntervalId = null;
    }
  }

  async home(axes?: string): Promise<HomingResult> {
    const result = await this.homingSystem.home(axes);
    // Update homed state based on result
    if (result.success) {
      this.isHomed = true;
    }
    return result;
  }

  async jog(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): Promise<JogResult> {
    return this.joggingSystem.jog(axes, feed);
  }

  // Public methods for job management
  async loadJob(
    source: string | File,
    name?: string,
    options?: JobOptions
  ): Promise<JobLoadResult> {
    return this.jobManager.loadJob(source, name, options);
  }

  async startJob(jobId?: string): Promise<JobStartResult> {
    return this.jobManager.startJob(jobId);
  }

  async pauseJob(): Promise<void> {
    return this.jobManager.pauseJob();
  }

  async resumeJob(): Promise<void> {
    return this.jobManager.resumeJob();
  }

  async stopJob(emergency: boolean = false): Promise<void> {
    return this.jobManager.stopJob(emergency);
  }

  async resumeAfterCrash(): Promise<JobResumeResult> {
    return this.jobManager.resumeAfterCrash();
  }

  async emergencyStop(): Promise<void> {
    try {
      await this.connection?.send('\x18'); // Ctrl-X for soft-reset
      this.commandManager.clear();
      this.emit('emergencyStop');
      
      // Reset expected position after emergency stop
      this.expectedPosition = { ...this.lastKnownPosition };
    } catch (error) {
      console.error('Emergency stop error:', error);
      // Even if there's an error, we consider the emergency stop executed
      this.emit('emergencyStop');
    }
  }

  async feedHold(): Promise<void> {
    try {
      await this.connection?.send('!');
      this.emit('feedHold');
    } catch (error) {
      console.error('Feed hold error:', error);
      this.emit('error', error as Error);
    }
  }


  async softReset(): Promise<void> {
    try {
      await this.connection?.send('\x18'); // Ctrl-X
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Clear any pending commands
      this.commandManager.clear();
      
      // Reset expected position
      this.expectedPosition = { ...this.lastKnownPosition };
      
      this.emit('softReset');
    } catch (error) {
      console.error('Soft reset error:', error);
      this.emit('error', error as Error);
    }
  }

async getSettings(): Promise<string[]> {
  const response = await this.sendCommand('$$');
  return response.split('\n')
    .filter((line) => line.trim() && !line.includes('ok'))
    .filter((line) => line.startsWith('$')); // Фильтруем только строки настроек
}

async getInfo(): Promise<string[]> {
  const response = await this.sendCommand('$I');
  return response.split('\n')
    .filter((line) => line.trim() && !line.includes('ok'));
}

  async checkGCode(gcode: string): Promise<string> {
    await this.sendCommand('$C');
    const result = await this.sendCommand(gcode);
    await this.sendCommand('$C');
    return result;
  }

  async probe(
    axis: 'X' | 'Y' | 'Z',
    feedRate: number,
    distance: number
  ): Promise<ProbeResult> {
    return this.probingSystem.probe(axis, feedRate, distance);
  }

  async probeGrid(
    gridSize: { x: number; y: number },
    stepSize: number,
    feedRate: number
  ): Promise<GridProbeResult> {
    return this.probingSystem.probeGrid(gridSize, stepSize, feedRate);
  }

  getCurrentPosition(): IPosition {
    return { ...this.lastKnownPosition };
  }

  getSafetyStatus(): {
    limits: { x: { min: number; max: number }; y: { min: number; max: number }; z: { min: number; max: number } };
    isHomed: boolean;
    isSafe: boolean;
  } {
    return {
      limits: this.safetySystem.getSoftLimits ? this.safetySystem.getSoftLimits() : this.safetySystem.softLimits,
      isHomed: this.isHomed,
      isSafe: this.safetySystem.isSafeToMove(),
    };
  }

  // Автоматическая диагностика
  async autoDiagnose(): Promise<void> {
    try {
      if (!this.isConnected()) {
        return; // Skip diagnosis if not connected
      }

      const diagnosis = await this.recoverySystem.diagnose(this);

      if (diagnosis.state !== RecoveryState.Normal) {
        this.emit('recoveryNeeded', diagnosis);

        // Для критических состояний - автоматическое восстановление
        if (diagnosis.severity === 'critical') {
          console.warn('Критическое состояние, запускаем автоматическое восстановление');
          await this.autoRecover(diagnosis);
        }
      }
    } catch (error) {
      console.error('Ошибка при автоматической диагностике:', error);
    }
  }

  // Автоматическое восстановление
  async autoRecover(diagnosis: RecoveryDiagnosis): Promise<void> {
    this.emit('recoveryStarted', diagnosis);

    try {
      await this.recoverySystem.executeRecovery(diagnosis, this);
      this.emit('recoveryCompleted', diagnosis);
    } catch (error) {
      this.emit('recoveryFailed', { diagnosis, error: error as Error });
      throw error;
    }
  }

  // Ручное восстановление
  async manualRecovery(): Promise<void> {
    const diagnosis = await this.recoverySystem.diagnose(this);

    if (diagnosis.state === RecoveryState.Normal) {
      console.log('Станок в нормальном состоянии, восстановление не требуется');
      return;
    }

    console.log('=== РУКОВОДСТВО ПО ВОССТАНОВЛЕНИЮ ===');
    console.log(`Проблема: ${diagnosis.probableCause}`);
    console.log('Серьезность:', diagnosis.severity);
    console.log('Затронутые оси:', diagnosis.affectedAxes.join(', '));
    console.log('\nРекомендуемые действия:');
    diagnosis.recommendedActions.forEach((action, i) => {
      console.log(`${i + 1}. ${action}`);
    });

    // Здесь в реальном приложении был бы UI
    console.log('\nДля автоматического восстановления вызовите controller.autoRecover()');
    console.log('Или выполните шаги вручную согласно инструкции выше');
  }

  // Public methods for recovery
  async diagnose(): Promise<RecoveryDiagnosis> {
    return this.recoverySystem.diagnose(this);
  }

  // Getters for state
  getCurrentJob(): Job | null {
    return this.jobManager.getCurrentJob();
  }

  getJobQueue(): Job[] {
    return this.jobManager.getJobQueue();
  }

  getJobHistory(): Job[] {
    return this.jobManager.getJobHistory();
  }

  getExecutionStats(): ExecutionStats {
    return this.jobManager.getExecutionStats();
  }

  getRecoveryInfo(): {
    currentState: RecoveryState;
    lastDiagnosis?: RecoveryDiagnosis;
  } {
    return {
      currentState: this.recoverySystem.getCurrentState(),
      lastDiagnosis: this.recoverySystem.getDiagnosisHistory()[0]
    };
  }

  // G-code parsing
  parseGCode(gcode: string): GCodeParseResult {
    return this.parser.parse(gcode);
  }

  setMachineProfile(profile: Partial<MachineLimits>): void {
    this.machineProfile = { ...this.machineProfile, ...profile };
    this.jobManager.setMachineProfile(this.machineProfile);
  }

  private getDefaultMachineLimits(): MachineLimits {
    return {
      maxFeedRate: 3000,
      maxSpindleSpeed: 10000,
      travelLimits: this.safetySystem.getSoftLimits()
    };
  }

  checkGCodeSafety(gcode: string): SafetyCheckResult {
    const parseResult = this.parser.parse(gcode);
    return this.parser.checkSafety(parseResult.blocks, this.machineProfile);
  }

  private calculateExpectedPositionChange(command: string): Partial<IPosition> | undefined {
    const upper = command.toUpperCase();

    if (upper.startsWith('G0') || upper.startsWith('G1') || upper.startsWith('G2') || upper.startsWith('G3')) {
      const xMatch = upper.match(/X([\d.-]+)/);
      const yMatch = upper.match(/Y([\d.-]+)/);
      const zMatch = upper.match(/Z([\d.-]+)/);

      const positionChange: Partial<IPosition> = {};
      if (xMatch) positionChange.x = parseFloat(xMatch[1]);
      if (yMatch) positionChange.y = parseFloat(yMatch[1]);
      if (zMatch) positionChange.z = parseFloat(zMatch[1]);

      return Object.keys(positionChange).length > 0 ? positionChange : undefined;
    }

    if (upper.startsWith('$J=')) {
        const xMatch = upper.match(/X([\d.-]+)/);
        const yMatch = upper.match(/Y([\d.-]+)/);
        const zMatch = upper.match(/Z([\d.-]+)/);

        const positionChange: Partial<IPosition> = {};
        if (xMatch) positionChange.x = parseFloat(xMatch[1]);
        if (yMatch) positionChange.y = parseFloat(yMatch[1]);
        if (zMatch) positionChange.z = parseFloat(zMatch[1]);
        // Не добавляем z=0 по умолчанию для команд джоггинга

        return Object.keys(positionChange).length > 0 ? positionChange : undefined;
    }

    return undefined;
  }

  public checkPositionMismatch(): boolean {
    const tolerance = 0.1; // 0.1 мм
    const diffX = Math.abs(this.expectedPosition.x - this.lastKnownPosition.x);
    const diffY = Math.abs(this.expectedPosition.y - this.lastKnownPosition.y);
    const diffZ = Math.abs(this.expectedPosition.z - this.lastKnownPosition.z);

    return diffX > tolerance || diffY > tolerance || diffZ > tolerance;
  }

  // Обновление последней известной позиции
  updatePosition(position: IPosition): void {
    this.lastKnownPosition = { ...position };
  }

  // Очистка журнала команд
  clearCommandJournal(): void {
    this.commandJournal = [];
  }

  // Получение журнала команд
  getCommandJournal(): Array<{ command: string; timestamp: Date; expectedPositionChange?: Partial<IPosition> }> {
    return [...this.commandJournal];
  }
}