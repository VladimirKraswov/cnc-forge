import chalk from 'chalk';

export class Logger {
  constructor(private context: string) {}

  info(message: string, ...args: any[]) {
    console.log(chalk.blue(`[${this.context}]`), message, ...args);
  }

  success(message: string, ...args: any[]) {
    console.log(chalk.green(`✓ [${this.context}]`), message, ...args);
  }

  warn(message: string, ...args: any[]) {
    console.log(chalk.yellow(`⚠ [${this.context}]`), message, ...args);
  }

  error(message: string, error?: any) {
    console.error(chalk.red(`✗ [${this.context}]`), message);
    if (error) {
      console.error(chalk.red('Error details:'), error);
    }
  }

  debug(message: string, ...args: any[]) {
    if (process.env.DEBUG) {
      console.log(chalk.gray(`[${this.context}]`), message, ...args);
    }
  }
}