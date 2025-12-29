#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import readlineSync from 'readline-sync';
import { CncController, IConnectionOptions, ConnectionType } from './index';

const program = new Command();
const controller = new CncController();

program
  .name('cnc-cli')
  .description('CLI to control a CNC machine with GRBL/ESP32')
  .version('0.1.0');

program
  .command('connect')
  .description('Connect to the CNC machine')
  .option(
    '-p, --port <path>',
    'Serial port (e.g., /dev/ttyUSB0 or COM3)',
    '/dev/ttyUSB0'
  )
  .option('-b, --baud <rate>', 'Baud rate', '115200')
  .option(
    '-t, --type <type>',
    'Connection type (serial, wifi, bluetooth)',
    'serial'
  )
  .action(async (options) => {
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
        console.error(chalk.red(`Unknown connection type: ${options.type}`));
        return;
    }

    const connectOptions: IConnectionOptions = {
      port: options.port,
      baudRate: parseInt(options.baud),
      type: connectionType,
    };
    try {
      await controller.connect(connectOptions);
      console.log(chalk.green('Connected!'));
      enterInteractiveMode();
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
  });

program
  .command('disconnect')
  .description('Disconnect from the machine')
  .action(async () => {
    try {
      await controller.disconnect();
      console.log(chalk.green('Disconnected.'));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
  });

program
  .command('send')
  .description('Send a G-code command')
  .argument('<command>', 'Command (e.g., "?")')
  .action(async (command) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      const response = await controller.sendCommand(command);
      console.log(chalk.blue(`Response: ${response}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
  });

program
  .command('status')
  .description('Get machine status')
  .action(async () => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      const status = await controller.getStatus();
      console.log(chalk.blue(`Status: ${JSON.stringify(status, null, 2)}`));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
  });

let isPolling = false;
const statusHandler = (status: any) => {
  console.log(chalk.gray(`Status: ${JSON.stringify(status)}`));
};

program
  .command('status-poll')
  .description('Start or stop status polling')
  .option('--interval <ms>', 'Polling interval in milliseconds', '250')
  .option('--stop', 'Stop polling')
  .action((options) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));

    if (options.stop) {
      if (isPolling) {
        controller.stopStatusPolling();
        controller.off('status', statusHandler);
        isPolling = false;
        console.log(chalk.yellow('Status polling stopped.'));
      }
    } else {
      if (!isPolling) {
        const interval = parseInt(options.interval, 10);
        controller.startStatusPolling(interval);
        controller.on('status', statusHandler);
        isPolling = true;
        console.log(
          chalk.green(`Status polling started every ${interval}ms.`)
        );
      }
    }
  });

program
  .command('home')
  .description('Perform homing cycle')
  .option('--axes <axes>', 'Specific axes to home (e.g., XY, Z)', '')
  .action(async (options) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      const response = await controller.home(options.axes);
      console.log(chalk.green(`Homing complete: ${response}`));
    } catch (err) {
      console.error(chalk.red(`Homing error: ${(err as Error).message}`));
    }
  });

program
  .command('jog')
  .description('Jog the machine')
  .option('--x <distance>', 'X-axis distance')
  .option('--y <distance>', 'Y-axis distance')
  .option('--z <distance>', 'Z-axis distance')
  .option('--feed <rate>', 'Feed rate', '1000')
  .action(async (options) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      const axes: { [key: string]: number } = {};
      if (options.x) axes.x = parseFloat(options.x);
      if (options.y) axes.y = parseFloat(options.y);
      if (options.z) axes.z = parseFloat(options.z);

      const feed = parseFloat(options.feed);
      const response = await controller.jog(axes, feed);
      console.log(chalk.green(`Jog complete: ${response}`));
    } catch (err) {
      console.error(chalk.red(`Jog error: ${(err as Error).message}`));
    }
  });

program
  .command('stream')
  .description('Stream a G-code file or string')
  .argument('<gcode>', 'G-code string or file path')
  .option('--file', 'Treat the argument as a file path')
  .action(async (gcode, options) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      console.log(chalk.yellow(`Streaming G-code...`));
      await controller.streamGCode(gcode, options.file);
      console.log(chalk.green('G-code streaming complete!'));
    } catch (err) {
      console.error(chalk.red(`G-code error: ${(err as Error).message}`));
    }
  });

program
  .command('stop')
  .description('Emergency stop (feed hold)')
  .action(async () => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      const response = await controller.stopJob();
      console.log(chalk.yellow(response));
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
  });

program
  .command('probe')
  .description('Probe for zero position')
  .option('--axis <axis>', 'Axis to probe', 'Z')
  .option('--feed <rate>', 'Feed rate', '100')
  .option('--distance <mm>', 'Probe distance', '-100')
  .action(async (options) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    if (options.axis.toUpperCase() !== 'Z') {
      return console.error(
        chalk.red('Error: Probing is only supported on the Z-axis.')
      );
    }
    try {
      const feed = parseFloat(options.feed);
      const distance = parseFloat(options.distance);
      const result = await controller.probe(options.axis, feed, distance);
      console.log(
        chalk.green(`Probe complete: ${JSON.stringify(result, null, 2)}`)
      );
    } catch (err) {
      console.error(chalk.red(`Probe error: ${(err as Error).message}`));
    }
  });

program
  .command('probe-grid')
  .description('Perform a grid probe for height mapping')
  .option('--x <size>', 'Grid size in X', '100')
  .option('--y <size>', 'Grid size in Y', '100')
  .option('--step <size>', 'Step size', '10')
  .option('--feed <rate>', 'Feed rate', '100')
  .action(async (options) => {
    if (!controller.isConnected())
      return console.error(chalk.red('Not connected!'));
    try {
      const gridSize = {
        x: parseFloat(options.x),
        y: parseFloat(options.y),
      };
      const step = parseFloat(options.step);
      const feed = parseFloat(options.feed);
      const results = await controller.probeGrid(gridSize, step, feed);
      console.log(chalk.green('Grid probe complete:'));
      console.log(JSON.stringify(results, null, 2));
    } catch (err) {
      console.error(chalk.red(`Grid probe error: ${(err as Error).message}`));
    }
  });

program
  .command('interactive')
  .description('Enter interactive mode')
  .action(() => {
    if (!controller.isConnected()) {
      console.error(
        chalk.red('Not connected! Use the connect command first.')
      );
      return;
    }
    enterInteractiveMode();
  });

function enterInteractiveMode() {
  console.log(
    chalk.yellow('Interactive mode. Type a command or "exit" to quit.')
  );
  console.log(
    chalk.yellow('Available commands: home, status, disconnect, and any G-code command')
  );

  controller.on('statusUpdate', (data) =>
    console.log(chalk.gray(`Update: ${data}`))
  );
  controller.on('error', (error) =>
    console.error(chalk.red(`Machine error: ${error.message}`))
  );
  controller.on('jobProgress', (progress) => {
    const percent = progress.percentage
      ? `${progress.percentage}%`
      : `${progress.current}/${progress.total}`;
    console.log(chalk.blue(`Progress: ${percent} - ${progress.line}`));
  });

  const runInteractive = () => {
    const input = readlineSync.question(chalk.cyan('cnc> '));

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      controller.disconnect().catch(() => {});
      console.log(chalk.yellow('Exiting...'));
      process.exit(0);
    }

    if (input.toLowerCase() === 'home') {
      controller
        .home()
        .then((resp) => console.log(chalk.green(`Homing: ${resp}`)))
        .catch((err) => console.error(chalk.red(`Error: ${err.message}`)));
      runInteractive();
      return;
    }

    if (input.toLowerCase() === 'status') {
      controller
        .getStatus()
        .then((status) =>
          console.log(chalk.blue(JSON.stringify(status, null, 2)))
        )
        .catch((err) => console.error(chalk.red(`Error: ${err.message}`)));
      runInteractive();
      return;
    }

    if (input.toLowerCase() === 'disconnect') {
      controller
        .disconnect()
        .then(() => {
          console.log(chalk.green('Disconnected'));
          process.exit(0);
        })
        .catch((err) => console.error(chalk.red(`Error: ${err.message}`)));
      return;
    }

    if (input.trim()) {
      controller
        .sendCommand(input)
        .then((resp) => console.log(chalk.blue(`Response: ${resp}`)))
        .catch((err) => console.error(chalk.red(`Error: ${err.message}`)))
        .finally(() => runInteractive());
    } else {
      runInteractive();
    }
  };

  runInteractive();
}

if (process.argv.length <= 2) {
  program.help();
}

program.parse();
