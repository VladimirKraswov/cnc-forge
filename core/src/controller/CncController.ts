import { EventEmitter } from 'eventemitter3';
import {
  IConnection,
  IConnectionOptions,
  IGrblStatus,
  IProbeResult,
  IAlarm,
} from '../types';
import fs from 'fs/promises';
import { ConnectionFactory } from '../connections';

export class CncController extends EventEmitter {
  private connection: IConnection | null = null;
  private connected: boolean = false;
  private responseBuffer: string = '';
  private responsePromise: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  private statusPollingIntervalId: NodeJS.Timeout | null = null;

  async connect(options: IConnectionOptions): Promise<void> {
    try {
      this.connection = ConnectionFactory.create(options);

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
    } catch (error) {
      throw new Error(`Connection error: ${(error as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connection) throw new Error('Not connected');
    await this.connection.disconnect();
    this.connection = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && (this.connection?.isConnected || false);
  }

  async sendCommand(command: string, timeout: number = 5000): Promise<string> {
    if (!this.connection || !this.isConnected()) {
      throw new Error('Not connected');
    }

    this.responseBuffer = '';

    return new Promise(async (resolve, reject) => {
      try {
        await this.connection!.send(command + '\n');
        this.responsePromise = { resolve, reject };

        const timeoutId = setTimeout(() => {
          if (this.responsePromise) {
            this.responsePromise.reject(new Error('Response timeout'));
            this.responsePromise = null;
          }
        }, timeout);

        const originalResolve = this.responsePromise.resolve;
        this.responsePromise.resolve = (value: string) => {
          clearTimeout(timeoutId);
          originalResolve(value);
        };
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  private handleIncomingData(data: string): void {
    const trimmedData = data.trim();

    this.responseBuffer += trimmedData;
    this.emit('statusUpdate', trimmedData);

    if (
      this.responsePromise &&
      (trimmedData.includes('ok') ||
        trimmedData.includes('error') ||
        trimmedData.includes('alarm'))
    ) {
      const response = this.responseBuffer.trim();
      this.responsePromise.resolve(response);
      this.responsePromise = null;
      this.responseBuffer = '';
    }

    if (trimmedData.startsWith('<')) {
      try {
        const status = this.parseGrblStatus(trimmedData);
        this.emit('status', status);
      } catch (error) {
        // Ignore parsing errors
      }
    }

    if (trimmedData.startsWith('ALARM:')) {
      const alarmCode = parseInt(trimmedData.split(':')[1], 10);
      const alarmMessage = this.getAlarmMessage(alarmCode);
      const alarm: IAlarm = { code: alarmCode, message: alarmMessage };
      this.emit('alarm', alarm);
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
      /<(\w+)\|MPos:([\d.-]+),([\d.-]+),([\d.-]+)\|(?:WPos:[\d.-]+,[\d.-]+,[\d.-]+)?\|?(?:F:([\d.-]+))?/
    );
    if (match) {
      return {
        state: match[1],
        position: {
          x: parseFloat(match[2]),
          y: parseFloat(match[3]),
          z: parseFloat(match[4]),
        },
        feed: match[5] ? parseFloat(match[5]) : undefined,
      };
    }
    throw new Error(`Cannot parse status: ${response}`);
  }

  async getStatus(): Promise<IGrblStatus> {
    const response = await this.sendCommand('?');
    return this.parseGrblStatus(response);
  }

  startStatusPolling(intervalMs: number = 250): void {
    if (this.statusPollingIntervalId) {
      this.stopStatusPolling();
    }
    this.statusPollingIntervalId = setInterval(async () => {
      if (this.isConnected()) {
        try {
          // getStatus already emits a 'status' event, so we don't need to do it again here.
          await this.sendCommand('?');
        } catch (error) {
          // Don't emit errors for polling
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

  async home(axes: string = ''): Promise<string> {
    if (axes) {
      return this.sendCommand(`$H${axes.toUpperCase()}`);
    }
    return this.sendCommand('$H');
  }

  async jog(
    axes: { x?: number; y?: number; z?: number },
    feed: number
  ): Promise<string> {
    const axisCommands = Object.entries(axes)
      .map(([axis, distance]) => `${axis.toUpperCase()}${distance}`)
      .join(' ');

    if (!axisCommands) {
      throw new Error('No axes specified for jogging.');
    }

    return this.sendCommand(`$J=G91 ${axisCommands} F${feed}`);
  }

  async streamGCode(
    gcodeOrFile: string,
    isFile: boolean = false
  ): Promise<void> {
    let gcode: string;
    if (isFile) {
      try {
        gcode = await fs.readFile(gcodeOrFile, 'utf8');
      } catch (err) {
        throw new Error(`Error reading file: ${(err as Error).message}`);
      }
    } else {
      gcode = gcodeOrFile;
    }

    const lines = gcode
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith(';'));

    let processed = 0;
    const total = lines.length;

    for (const line of lines) {
      const response = await this.sendCommand(line);
      if (response.includes('error') || response.includes('alarm')) {
        throw new Error(`Error sending G-code: ${response}`);
      }
      processed++;
      this.emit('jobProgress', {
        current: processed,
        total,
        line,
        percentage: Math.round((processed / total) * 100),
      });
    }
    this.emit('jobComplete');
  }

  async probe(
    axis: 'Z' = 'Z',
    feed: number = 100,
    distance: number = -100
  ): Promise<IProbeResult> {
    const response = await this.sendCommand(
      `G38.2 ${axis}${distance} F${feed}`
    );
    const match = response.match(/\[PRB:([\d.-]+),([\d.-]+),([\d.-]+):(\d)\]/);

    if (match) {
      const result: IProbeResult = {
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        z: parseFloat(match[3]),
      };
      this.emit('probeComplete', result);
      return result;
    }

    throw new Error('Failed to parse probe result');
  }

  async probeGrid(
    gridSize: { x: number; y: number },
    step: number,
    feed: number = 100
  ): Promise<IProbeResult[]> {
    const results: IProbeResult[] = [];
    const status = await this.getStatus();
    const startX = status.position.x;
    const startY = status.position.y;

    for (let y = 0; y <= gridSize.y; y += step) {
      for (let x = 0; x <= gridSize.x; x += step) {
        const targetX = startX + x;
        const targetY = startY + y;
        await this.sendCommand(`G0 X${targetX} Y${targetY}`);

        const probeResult = await this.probe('Z', feed);
        results.push(probeResult);

        await this.sendCommand('G91 G0 Z5'); // Retract 5mm
        await this.sendCommand('G90'); // Absolute positioning
      }
    }

    this.emit('probeGridComplete', results);
    return results;
  }

  async stopJob(): Promise<string> {
    await this.connection?.send('!');
    return 'Feed hold activated';
  }

  async softReset(): Promise<void> {
    await this.sendCommand('\x18');
  }

  async getSettings(): Promise<string[]> {
    const response = await this.sendCommand('$$');
    return response.split('\n').filter((line) => line.trim());
  }

  async getInfo(): Promise<string[]> {
    const response = await this.sendCommand('$I');
    return response.split('\n').filter((line) => line.trim());
  }

  async checkGCode(gcode: string): Promise<string> {
    await this.sendCommand('$C');
    const result = await this.sendCommand(gcode);
    await this.sendCommand('$C');
    return result;
  }
}
