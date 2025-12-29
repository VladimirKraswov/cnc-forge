#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import readlineSync from 'readline-sync';
import { CncController, IConnectionOptions, ConnectionType } from './index';

const program = new Command();
const controller = new CncController();

program
  .name('cnc-cli')
  .description('CLI для управления CNC на GRBL/ESP32')
  .version('0.1.0');

program
  .command('connect')
  .description('Соединиться со станком')
  .option('-p, --port <path>', 'Порт (e.g., /dev/ttyUSB0 или COM3)', '/dev/ttyUSB0')
  .option('-b, --baud <rate>', 'Baud rate', '115200')
  .option('-t, --type <type>', 'Тип подключения (serial, wifi, bluetooth)', 'serial')
  .action(async (options) => {
    // Преобразуем строку в ConnectionType
    let connectionType: ConnectionType;
    switch (options.type.toLowerCase()) {
      case 'serial':
        connectionType = ConnectionType.Serial;
        break;
      case 'wifi':
        connectionType = ConnectionType.WiFi;
        break;
      case 'bluetooth':
        connectionType = ConnectionType.Bluetooth;
        break;
      default:
        console.error(chalk.red(`Неизвестный тип подключения: ${options.type}`));
        return;
    }

    const connectOptions: IConnectionOptions = {
      port: options.port,
      baudRate: parseInt(options.baud),
      type: connectionType,
    };
    try {
      await controller.connect(connectOptions);
      console.log(chalk.green('Соединено!'));
      enterInteractiveMode();
    } catch (err) {
      console.error(chalk.red(`Ошибка: ${(err as Error).message}`));
    }
  });

program
  .command('disconnect')
  .description('Отсоединиться')
  .action(async () => {
    try {
      await controller.disconnect();
      console.log(chalk.green('Отсоединено.'));
    } catch (err) {
      console.error(chalk.red(`Ошибка: ${(err as Error).message}`));
    }
  });

program
  .command('send')
  .description('Отправить команду')
  .argument('<command>', 'Команда (e.g., "?")')
  .action(async (command) => {
    if (!controller.isConnected()) return console.error(chalk.red('Не соединено!'));
    try {
      const response = await controller.sendCommand(command);
      console.log(chalk.blue(`Ответ: ${response}`));
    } catch (err) {
      console.error(chalk.red(`Ошибка: ${(err as Error).message}`));
    }
  });

program
  .command('status')
  .description('Получить статус')
  .action(async () => {
    if (!controller.isConnected()) return console.error(chalk.red('Не соединено!'));
    try {
      const status = await controller.getStatus();
      console.log(chalk.blue(`Статус: ${JSON.stringify(status, null, 2)}`));
    } catch (err) {
      console.error(chalk.red(`Ошибка: ${(err as Error).message}`));
    }
  });

program
  .command('home')
  .description('Выполнить референс (homing)')
  .action(async () => {
    if (!controller.isConnected()) return console.error(chalk.red('Не соединено!'));
    try {
      const response = await controller.home();
      console.log(chalk.green(`Референс выполнен: ${response}`));
    } catch (err) {
      console.error(chalk.red(`Ошибка при выполнении референса: ${(err as Error).message}`));
    }
  });

program
  .command('jog')
  .description('Джоггинг')
  .option('-a, --axis <axis>', 'Ось (X, Y, Z)', 'X')
  .option('-d, --distance <distance>', 'Расстояние (мм)', '10')
  .option('-f, --feed <feed>', 'Скорость (мм/мин)', '1000')
  .action(async (options) => {
    if (!controller.isConnected()) return console.error(chalk.red('Не соединено!'));
    try {
      const axis = options.axis.toUpperCase();
      const distance = parseFloat(options.distance);
      const feed = parseFloat(options.feed);
      
      if (!['X', 'Y', 'Z'].includes(axis)) {
        console.error(chalk.red('Ось должна быть X, Y или Z'));
        return;
      }
      
      const response = await controller.jog(axis as 'X' | 'Y' | 'Z', distance, feed);
      console.log(chalk.green(`Джоггинг выполнен: ${response}`));
    } catch (err) {
      console.error(chalk.red(`Ошибка джоггинга: ${(err as Error).message}`));
    }
  });

program
  .command('run-gcode')
  .description('Запустить G-code из файла')
  .argument('<file>', 'Путь к файлу G-code')
  .action(async (file) => {
    if (!controller.isConnected()) return console.error(chalk.red('Не соединено!'));
    try {
      console.log(chalk.yellow(`Запуск G-code из файла: ${file}`));
      await controller.streamGCode(file, true);
      console.log(chalk.green('G-code выполнен успешно!'));
    } catch (err) {
      console.error(chalk.red(`Ошибка выполнения G-code: ${(err as Error).message}`));
    }
  });

program
  .command('interactive')
  .description('Перейти в интерактивный режим')
  .action(() => {
    if (!controller.isConnected()) {
      console.error(chalk.red('Не соединено! Сначала выполните команду connect'));
      return;
    }
    enterInteractiveMode();
  });

function enterInteractiveMode() {
  console.log(chalk.yellow('Интерактивный режим. Введите команду или "exit".'));
  console.log(chalk.yellow('Доступные специальные команды: home, status, disconnect'));
  
  controller.on('statusUpdate', (data) => console.log(chalk.gray(`Обновление: ${data}`)));
  controller.on('error', (error) => console.error(chalk.red(`Ошибка станка: ${error.message}`)));
  controller.on('jobProgress', (progress) => {
    const percent = progress.percentage ? `${progress.percentage}%` : `${progress.current}/${progress.total}`;
    console.log(chalk.blue(`Прогресс: ${percent} - ${progress.line}`));
  });

  const runInteractive = () => {
    const input = readlineSync.question(chalk.cyan('cnc> '));
    
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      controller.disconnect().catch(() => {});
      console.log(chalk.yellow('Выход...'));
      process.exit(0);
    }
    
    if (input.toLowerCase() === 'home') {
      controller.home()
        .then((resp) => console.log(chalk.green(`Референс: ${resp}`)))
        .catch((err) => console.error(chalk.red(`Ошибка: ${err.message}`)));
      runInteractive();
      return;
    }
    
    if (input.toLowerCase() === 'status') {
      controller.getStatus()
        .then((status) => console.log(chalk.blue(JSON.stringify(status, null, 2))))
        .catch((err) => console.error(chalk.red(`Ошибка: ${err.message}`)));
      runInteractive();
      return;
    }
    
    if (input.toLowerCase() === 'disconnect') {
      controller.disconnect()
        .then(() => {
          console.log(chalk.green('Отсоединено'));
          process.exit(0);
        })
        .catch((err) => console.error(chalk.red(`Ошибка: ${err.message}`)));
      return;
    }
    
    if (input.trim()) {
      controller.sendCommand(input)
        .then((resp) => console.log(chalk.blue(`Ответ: ${resp}`)))
        .catch((err) => console.error(chalk.red(`Ошибка: ${err.message}`)))
        .finally(() => runInteractive());
    } else {
      runInteractive();
    }
  };

  runInteractive();
}

// Если не переданы аргументы, показываем помощь
if (process.argv.length <= 2) {
  program.help();
}

program.parse();