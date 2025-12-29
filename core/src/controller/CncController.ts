import { EventEmitter } from 'events';
import { IGrblStatus, IAlarm, IPosition } from '../types';
import { IConnection, IConnectionOptions } from '../interfaces/Connection';
import fs from 'fs/promises';
import { ConnectionFactory } from '../connections';

// Определяем расширенные интерфейсы для зондирования
interface IProbeResultExtended extends IPosition {
  success: boolean;
  axis: string;
  distance: number;
  feedRate: number;
  rawResponse: string;
  error?: string;
}

interface IGridProbeResult extends IProbeResultExtended {
  gridPosition?: {
    x: number;
    y: number;
  };
}

export class CncController extends EventEmitter {
  private connection: IConnection | null = null;
  private connected: boolean = false;
  private responseBuffer: string = '';
  private responsePromise: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  private statusPollingIntervalId: any | null = null;

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
  }

  isConnected(): boolean {
    return this.connected && (this.connection?.isConnected || false);
  }

  async sendCommand(command: string, timeout: number = 5000): Promise<string> {
    if (!this.connection || !this.isConnected()) {
      throw new Error('Not connected');
    }

    this.responseBuffer = '';

    return new Promise<string>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout;
      const wrappedResolve = (value: string) => {
        clearTimeout(timeoutId);
        resolve(value);
      };

      this.responsePromise = { resolve: wrappedResolve, reject };

      this.connection!.send(command + '\n').catch((error: Error) => {
        if (this.responsePromise) {
          this.responsePromise.reject(error);
          this.responsePromise = null;
        }
      });

      timeoutId = setTimeout(() => {
        if (this.responsePromise) {
          this.responsePromise.reject(new Error('Response timeout'));
          this.responsePromise = null;
        }
      }, timeout);
    });
  }

  private handleIncomingData(data: string): void {
    const trimmedData = data.trim();

    this.responseBuffer += trimmedData;
    this.emit('statusUpdate', trimmedData);

    if (
      this.responsePromise &&
      (this.responseBuffer.includes('ok') ||
        this.responseBuffer.includes('error') ||
        this.responseBuffer.includes('alarm'))
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
        state: match[1] as IGrblStatus['state'],
        position: { x: parseFloat(match[2]), y: parseFloat(match[3]), z: parseFloat(match[4]) },
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

  async stopJob(): Promise<string> {
    if (!this.connection || !this.isConnected()) {
      throw new Error('Not connected');
    }
    this.connection.send('!');
    return Promise.resolve('');
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

  async probe(axis: string, feedRate: number, distance: number): Promise<IProbeResultExtended> {
    if (!this.connection || !this.isConnected()) {
      throw new Error('Not connected');
    }

    // Send probe command to GRBL
    // Format: G38.2 Z-100 F100 for Z-axis probing
    const command = `G38.2 ${axis.toUpperCase()}${distance} F${feedRate}`;
    try {
      const response = await this.sendCommand(command);
      
      // Get final position after probing
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
      const status = await this.getStatus();
      
      return {
        x: status.position.x,
        y: status.position.y,
        z: status.position.z,
        success: response.includes('ok') && !response.includes('error'),
        axis: axis.toUpperCase(),
        distance: distance,
        feedRate: feedRate,
        rawResponse: response
      };
    } catch (error) {
      const errorMsg = (error as Error).message;
      if (errorMsg.includes('Probe fail') || errorMsg.includes('ALARM:4') || errorMsg.includes('ALARM:5')) {
        return {
          x: 0,
          y: 0,
          z: 0,
          success: false,
          axis: axis.toUpperCase(),
          distance: distance,
          feedRate: feedRate,
          rawResponse: errorMsg,
          error: 'Probe failed to contact workpiece'
        };
      }
      throw error;
    }
  }

  async probeGrid(
    gridSize: { x: number; y: number },
    stepSize: number,
    feedRate: number
  ): Promise<IGridProbeResult[]> {
    if (!this.connection || !this.isConnected()) {
      throw new Error('Not connected');
    }

    const results: IGridProbeResult[] = [];
    const startX = -gridSize.x / 2;
    const startY = -gridSize.y / 2;
    
    // First, move to safe height
    await this.sendCommand('G0 Z10');
    await this.sendCommand('G0 X0 Y0'); // Start at center
    
    for (let y = 0; y <= gridSize.y; y += stepSize) {
      for (let x = 0; x <= gridSize.x; x += stepSize) {
        // Move to position
        const targetX = startX + x;
        const targetY = startY + y;
        await this.sendCommand(`G0 X${targetX} Y${targetY}`);
        
        // Probe Z at this position
        try {
          const probeResult = await this.probe('Z', feedRate, -100);
          const gridProbeResult: IGridProbeResult = {
            ...probeResult,
            gridPosition: { x: targetX, y: targetY }
          };
          results.push(gridProbeResult);
          
          // Raise probe after each point
          await this.sendCommand('G0 Z10');
        } catch (error) {
          console.error(`Probe failed at X${targetX} Y${targetY}:`, error);
          // Add failed result with grid position
          const failedResult: IGridProbeResult = {
            x: 0,
            y: 0,
            z: 0,
            success: false,
            axis: 'Z',
            distance: -100,
            feedRate: feedRate,
            rawResponse: (error as Error).message,
            error: 'Probe failed',
            gridPosition: { x: targetX, y: targetY }
          };
          results.push(failedResult);
          
          // Continue with next point
          await this.sendCommand('G0 Z10');
        }
        
        // Small delay between points
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Return to start position
    await this.sendCommand('G0 X0 Y0 Z10');
    
    return results;
  }
}