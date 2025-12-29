#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

interface FileStats {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  lines?: number;
  extension?: string;
  children?: FileStats[];
}

class ProjectStructure {
  private ignorePatterns = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.DS_Store',
    '*.log',
    'coverage',
    '.vscode',
    '.idea',
    'package-lock.json',
    'yarn.lock',
    '.npmrc',
    '.yarnrc',
    '.eslintcache'
  ];

  private extensionsOfInterest = [
    '.ts', '.js', '.tsx', '.jsx', '.json',
    '.md', '.txt', '.yml', '.yaml', '.xml',
    '.html', '.css', '.scss', '.less'
  ];

  async generate(rootPath: string = '.'): Promise<FileStats> {
    const rootName = path.basename(rootPath);
    return this.scanDirectory(rootPath, rootName);
  }

  private async scanDirectory(dirPath: string, name: string): Promise<FileStats> {
    const stats: FileStats = {
      name,
      type: 'directory',
      children: []
    };

    try {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        
        // Проверяем, нужно ли игнорировать этот элемент
        if (this.shouldIgnore(item, fullPath)) {
          continue;
        }

        const itemStat = fs.statSync(fullPath);
        
        if (itemStat.isDirectory()) {
          const childDir = await this.scanDirectory(fullPath, item);
          // Добавляем только если есть содержимое
          if (childDir.children && childDir.children.length > 0) {
            stats.children!.push(childDir);
          }
        } else {
          const fileStats = await this.getFileStats(fullPath, item);
          stats.children!.push(fileStats);
        }
      }
      
      // Сортируем: сначала папки, потом файлы
      stats.children!.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }

    return stats;
  }

  private shouldIgnore(item: string, fullPath: string): boolean {
    // Проверяем полный путь на наличие node_modules
    if (fullPath.includes('node_modules') || fullPath.includes('/node_modules/')) {
      return true;
    }
    
    // Проверяем по паттернам
    return this.ignorePatterns.some(pattern => {
      if (pattern.startsWith('*')) {
        return item.endsWith(pattern.slice(1));
      }
      return item === pattern;
    });
  }

  private async getFileStats(filePath: string, name: string): Promise<FileStats> {
    const stats: FileStats = {
      name,
      type: 'file',
      size: fs.statSync(filePath).size
    };

    const ext = path.extname(name).toLowerCase();
    if (ext) {
      stats.extension = ext;
    }

    // Получаем количество строк для текстовых файлов
    if (this.extensionsOfInterest.includes(ext)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        stats.lines = content.split('\n').length;
      } catch (error) {
        stats.lines = 0;
      }
    }

    return stats;
  }

  printTree(stats: FileStats, prefix: string = '', isLast: boolean = true): string {
    let output = '';
    
    // Текущий элемент
    const connector = isLast ? '└── ' : '├── ';
    const icon = stats.type === 'directory' ? '📁 ' : '📄 ';
    const sizeInfo = stats.size ? ` (${this.formatSize(stats.size)})` : '';
    const linesInfo = stats.lines ? ` [${stats.lines} lines]` : '';
    output += prefix + connector + icon + stats.name + sizeInfo + linesInfo + '\n';

    // Дочерние элементы
    if (stats.children && stats.children.length > 0) {
      const newPrefix = prefix + (isLast ? '    ' : '│   ');
      
      stats.children.forEach((child, index) => {
        const childIsLast = index === stats.children!.length - 1;
        output += this.printTree(child, newPrefix, childIsLast);
      });
    }

    return output;
  }

  printMarkdown(stats: FileStats, level: number = 0): string {
    let output = '';
    const indent = '  '.repeat(level);
    const bullet = level === 0 ? '' : '- ';
    
    // Текущий элемент
    const icon = stats.type === 'directory' ? '📁 ' : '📄 ';
    const sizeInfo = stats.size ? ` _(${this.formatSize(stats.size)})_` : '';
    const linesInfo = stats.lines ? ` [${stats.lines} lines]` : '';
    output += `${indent}${bullet}${icon}**${stats.name}**${sizeInfo}${linesInfo}\n`;

    // Дочерние элементы
    if (stats.children && stats.children.length > 0) {
      stats.children.forEach(child => {
        output += this.printMarkdown(child, level + 1);
      });
    }

    return output;
  }

  printJson(stats: FileStats): string {
    return JSON.stringify(stats, null, 2);
  }

  printSummary(stats: FileStats): string {
    const summary = this.calculateSummary(stats);
    
    let output = '📊 Project Summary\n';
    output += '══════════════════\n\n';
    output += `📁 Directories: ${summary.directories}\n`;
    output += `📄 Files: ${summary.files}\n`;
    output += `📝 Total lines: ${summary.totalLines.toLocaleString()}\n`;
    output += `💾 Total size: ${this.formatSize(summary.totalSize)}\n\n`;
    
    output += '📈 Files by extension:\n';
    summary.extensions.forEach(([ext, count]) => {
      if (ext) {
        output += `  ${ext}: ${count} files\n`;
      }
    });
    
    return output;
  }

  private calculateSummary(stats: FileStats): {
    directories: number;
    files: number;
    totalLines: number;
    totalSize: number;
    extensions: Array<[string, number]>;
  } {
    const summary = {
      directories: 0,
      files: 0,
      totalLines: 0,
      totalSize: 0,
      extensions: new Map<string, number>()
    };

    const traverse = (node: FileStats) => {
      if (node.type === 'directory') {
        summary.directories++;
        if (node.children) {
          node.children.forEach(traverse);
        }
      } else {
        summary.files++;
        summary.totalSize += node.size || 0;
        summary.totalLines += node.lines || 0;
        
        if (node.extension) {
          const count = summary.extensions.get(node.extension) || 0;
          summary.extensions.set(node.extension, count + 1);
        }
      }
    };

    traverse(stats);
    
    // Сортируем расширения по количеству файлов
    const sortedExtensions = Array.from(summary.extensions.entries())
      .sort((a, b) => b[1] - a[1]);
    
    return { ...summary, extensions: sortedExtensions };
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

// Основная функция
async function main() {
  const args = process.argv.slice(2);
  const format = args[0] || 'tree'; // tree, md, json, summary
  const outputFile = args[1]; // Опционально: файл для сохранения

  const structure = new ProjectStructure();
  const rootPath = process.cwd();
  
  console.log('📂 Scanning project structure...');
  console.log(`📁 Directory: ${rootPath}\n`);
  
  const projectStructure = await structure.generate(rootPath);
  
  let output = '';
  let fileExtension = '.txt';
  
  switch (format.toLowerCase()) {
    case 'tree':
      output = structure.printTree(projectStructure);
      fileExtension = '.txt';
      break;
    case 'md':
    case 'markdown':
      output = structure.printMarkdown(projectStructure);
      fileExtension = '.md';
      break;
    case 'json':
      output = structure.printJson(projectStructure);
      fileExtension = '.json';
      break;
    case 'summary':
      output = structure.printSummary(projectStructure);
      fileExtension = '.txt';
      break;
    default:
      console.log(`❌ Unknown format: ${format}. Using 'tree' format.`);
      output = structure.printTree(projectStructure);
      fileExtension = '.txt';
  }
  
  // Выводим результат
  console.log(output);
  
  // Сохраняем в файл если указано
  if (outputFile) {
    const filename = outputFile.endsWith(fileExtension) ? outputFile : `${outputFile}${fileExtension}`;
    fs.writeFileSync(filename, output, 'utf8');
    console.log(`\n💾 Output saved to: ${filename}`);
  }
}

// Запуск
main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});