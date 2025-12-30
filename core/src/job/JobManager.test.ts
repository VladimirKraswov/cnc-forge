import { CncController } from '../controller/CncController';
import { GCodeParser } from '../gcode/GCodeParser';
import { SafetySystem } from '../safety/SafetySystem';
import { JobManager } from './JobManager';
import { MachineLimits } from '../gcode/types';
import { ConnectionType } from '../types';
import { MockConnection } from '../../tests/MockConnection';

describe('G-code and Job Management', () => {
  let controller: CncController
  let parser: GCodeParser
  let safety: SafetySystem
  let jobManager: JobManager
  let mockConnection: MockConnection

  beforeEach(() => {
    controller = new CncController()
    parser = new GCodeParser()
    safety = new SafetySystem()
    jobManager = new JobManager(controller, parser, safety)

    mockConnection = new MockConnection({ type: ConnectionType.Serial })
    controller['connection'] = mockConnection
  })

  describe('JobManager', () => {
    test('should load and parse job', async () => {
      await mockConnection.connect()

      const gcode = 'G0 X10 Y10\nG1 Z-5 F100'
      const result = await jobManager.loadJob(gcode, 'Test Job')

      expect(result.success).toBe(true)
      expect(result.job).toBeDefined()
      expect(result.job!.name).toBe('Test Job')
      expect(result.job!.totalLines).toBe(2)
    })

    test('should start and execute job', async () => {
      await mockConnection.connect()

      const gcode = 'G0 X10 Y10\nG1 Z-5 F100'
      const loadResult = await jobManager.loadJob(gcode, 'Test Job', { autoStart: true })

      expect(loadResult.success).toBe(true)

      // Проверяем, что задание автоматически стало текущим
      const currentJob = jobManager.getCurrentJob()
      expect(currentJob).toBeDefined()
      expect(currentJob!.status).toBe('ready')
    })

    test('should pause and resume job', async () => {
      await mockConnection.connect()

      // Загружаем длинное задание
      const gcode = Array(10).fill('G0 X10 Y10').join('\n')
      await jobManager.loadJob(gcode, 'Long Job', { autoStart: true })

      // Пауза
      await jobManager.pauseJob()

      const currentJob = jobManager.getCurrentJob()
      expect(currentJob!.status).toBe('paused')

      // Возобновление
      await jobManager.resumeJob()
      expect(currentJob!.status).toBe('running')
    })

    test('should save and load job state', async () => {
      await mockConnection.connect()

      const gcode = 'G0 X10 Y10\nG1 Z-5 F100'
      await jobManager.loadJob(gcode, 'Test Job', { autoStart: true })

      // Сохраняем состояние
      const saveResult = await jobManager.saveJobState()
      expect(saveResult.success).toBe(true)
      expect(saveResult.state).toBeDefined()

      // Загружаем состояние
      const stateString = JSON.stringify(saveResult.state!)
      const loadResult = await jobManager.loadJobState(stateString)

      expect(loadResult.success).toBe(true)
      expect(loadResult.job).toBeDefined()
      expect(loadResult.canResume).toBeDefined()
    })

    test('should handle job failure and recovery', async () => {
      await mockConnection.connect()

      // Симулируем сбой во время выполнения
      mockConnection.setResponse('G0 X10 Y10', 'error: Limit triggered')

      const gcode = 'G0 X10 Y10\nG1 Z-5 F100'
      const loadResult = await jobManager.loadJob(gcode, 'Failing Job', {
        autoStart: true,
        stopOnError: true
      })

      expect(loadResult.success).toBe(true)

      // Ждем немного для выполнения
      await new Promise(resolve => setTimeout(resolve, 100))

      // Проверяем, что задание завершилось с ошибкой
      const jobHistory = jobManager.getJobHistory()
      expect(jobHistory.length).toBeGreaterThan(0)
      expect(jobHistory[0].status).toBe('failed')

      // Проверяем статистику
      const stats = jobManager.getExecutionStats()
      expect(stats.jobsFailed).toBe(1)
    })

    test('should resume job after crash', async () => {
      await mockConnection.connect();

      const gcode = 'G0 X10 Y10\nG1 Z-5 F100\nG0 X0 Y0';
      await jobManager.loadJob(gcode, 'Resumable Job', { autoStart: true, stopOnError: true, preJobCommands: ['G21'] });

      // Simulate a crash during the second command
      mockConnection.setResponse('G1 Z-5 F100', 'error: Spindle not ready');

      // Start the job
      await jobManager.startJob();
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify job has failed
      const job = jobManager.getJobHistory()[0];
      expect(job.status).toBe('failed');

      // Attempt to resume
      mockConnection.setResponse('G1 Z-5 F100', 'ok'); // Fix the error for the resume

      const sendCommandSpy = jest.spyOn(controller, 'sendCommand');
      const resumeResult = await jobManager.resumeAfterCrash();

      expect(resumeResult.success).toBe(true);
      expect(resumeResult.job?.status).toBe('running');

      // Let the job finish
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify job completed successfully after resume
      expect(job.status).toBe('completed');

      // Verify that pre-job commands were not sent on resume
      expect(sendCommandSpy).not.toHaveBeenCalledWith('G21');
    });
  })
})
