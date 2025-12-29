import EventEmitter from "events";

// tests/helpers/async-helpers.ts
export const waitForEvent = <T>(
  emitter: EventEmitter,
  eventName: string,
  timeout: number = 1000
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);
    
    emitter.once(eventName, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
};

export const waitForCondition = async (
  condition: () => boolean,
  interval: number = 10,
  timeout: number = 1000
): Promise<void> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error('Condition not met within timeout');
};