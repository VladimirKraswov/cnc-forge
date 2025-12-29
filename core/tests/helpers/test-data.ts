// tests/helpers/test-data.ts
export const createMockGrblStatus = (overrides?: Partial<{
  state: string;
  position: { x: number; y: number; z: number };
  feed: number;
}>): string => {
  const defaults = {
    state: 'Idle',
    position: { x: 10.000, y: 20.000, z: 5.000 },
    feed: 100
  };
  
  const config = { ...defaults, ...overrides };
  return `<${config.state}|MPos:${config.position.x.toFixed(3)},${config.position.y.toFixed(3)},${config.position.z.toFixed(3)}|F:${config.feed}>`;
};

export const createGCodeProgram = (commands: string[]): string => {
  return commands.join('\n') + '\n; End of program';
};