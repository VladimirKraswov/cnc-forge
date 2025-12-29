import { IJob } from '../types';

export class JobState {
  private currentJob: IJob | null = null;

  startJob(name: string, gcode: string[]): IJob {
    this.currentJob = {
      id: Date.now().toString(),
      name,
      gcode,
      totalLines: gcode.length,
      progress: 0,
      status: 'pending',
      startTime: new Date()
    };
    return this.currentJob;
  }

  updateProgress(linesProcessed: number): void {
    if (this.currentJob) {
      this.currentJob.progress = linesProcessed;
      this.currentJob.status = 'running';
    }
  }

  completeJob(): void {
    if (this.currentJob) {
      this.currentJob.status = 'completed';
      this.currentJob.endTime = new Date();
    }
  }

  getCurrentJob(): IJob | null {
    return this.currentJob;
  }
}