import { CncController } from '../src/controller/CncController';
import { HomingManager } from '../src/motion/homing';
import { JoggingManager } from '../src/motion/jogging';
import { ProbingManager } from '../src/motion/probing';

async function testMotion() {
  console.log('Testing motion modules...');
  
  // Создаем контроллер
  const controller = new CncController();
  
  // Инициализируем менеджеры движения
  const homing = new HomingManager(controller);
  const jogging = new JoggingManager(controller);
  const probing = new ProbingManager(controller);
  
  try {
    // Подключаемся (замените на реальный порт)
    // await controller.connect({ port: '/dev/ttyUSB0', baudRate: 115200 });
    
    console.log('1. Testing homing...');
    // await homing.executeHoming();
    // const isHomed = await homing.isHomed();
    // console.log('Is homed:', isHomed);
    
    console.log('2. Testing jogging...');
    // await jogging.jog({ axis: 'x', distance: 10, feedRate: 1000 });
    // await jogging.jogX(5);
    
    console.log('3. Testing probing...');
    // const probeResult = await probing.probe({
    //   axis: 'z',
    //   direction: 'negative',
    //   feedRate: 100,
    //   maxDistance: 50
    // });
    // console.log('Probe result:', probeResult);
    
    console.log('Motion tests completed (simulation mode)');
    
  } catch (error) {
    console.error('Motion test failed:', error);
  } finally {
    // await controller.disconnect();
  }
}

testMotion();