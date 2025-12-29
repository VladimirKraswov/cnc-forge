export interface MachinePosition {
  x: number;
  y: number;
  z: number;
}

export interface MachineStateData {
  status: 'idle' | 'run' | 'hold' | 'alarm' | 'home' | 'disconnected';
  position: MachinePosition;
  workPosition: MachinePosition;
  feedRate: number;
  spindleSpeed: number;
  buffer: {
    available: number;
    used: number;
  };
  pins: {
    [key: string]: boolean;
  };
}

export class MachineState {
  private state: MachineStateData = {
    status: 'disconnected',
    position: { x: 0, y: 0, z: 0 },
    workPosition: { x: 0, y: 0, z: 0 },
    feedRate: 0,
    spindleSpeed: 0,
    buffer: { available: 128, used: 0 },
    pins: {}
  };

  update(updates: Partial<MachineStateData>) {
    this.state = { ...this.state, ...updates };
  }

  setStatus(status: MachineStateData['status']) {
    this.state.status = status;
  }

  getState(): MachineStateData {
    return { ...this.state };
  }

  getPosition(): MachinePosition {
    return { ...this.state.position };
  }

  isReady(): boolean {
    return this.state.status === 'idle' || this.state.status === 'run';
  }

  isInAlarm(): boolean {
    return this.state.status === 'alarm';
  }
}