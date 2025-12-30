import {
  Coordinates,
  GCodeBlock,
  GCodeError,
  GCodeWarning,
  GCodeParseResult,
  BoundingBox,
  MachineLimits,
  SafetyCheckResult
} from './types';

export class GCodeParser {
  private lineNumber: number = 0
  private errors: GCodeError[] = []
  private warnings: GCodeWarning[] = []

  // Основной метод парсинга
  parse(gcode: string): GCodeParseResult {
    this.lineNumber = 0
    this.errors = []
    this.warnings = []

    const lines = gcode.split('\n')
    const blocks: GCodeBlock[] = []

    for (let i = 0; i < lines.length; i++) {
      this.lineNumber = i + 1
      const line = lines[i].trim()

      // Пропускаем пустые строки и комментарии
      if (!line || line.startsWith(';') || line.startsWith('(')) {
        continue
      }

      try {
        const block = this.parseLine(line)
        if (block) {
          blocks.push(block)
        }
      } catch (error) {
        this.errors.push({
          line: this.lineNumber,
          message: (error as Error).message,
          severity: 'error',
          code: line
        })
      }
    }

    // После парсинга проверяем программу целиком
    this.validateProgram(blocks)

    return {
      success: this.errors.length === 0,
      blocks,
      errors: this.errors,
      warnings: this.warnings,
      lineCount: lines.length,
      blockCount: blocks.length,
      estimatedTime: this.estimateExecutionTime(blocks),
      boundingBox: this.calculateBoundingBox(blocks)
    }
  }

  private parseLine(line: string): GCodeBlock | null {
    // Удаляем комментарии в конце строки
    const code = this.removeComments(line)
    if (!code) return null

    const block: GCodeBlock = {
      lineNumber: this.lineNumber,
      original: line,
      code: code,
      modalGroups: {},
      coordinates: {},
      feedRate: undefined,
      spindleSpeed: undefined,
      toolNumber: undefined,
      isValid: true
    }

    // Разбиваем на слова
    const words = code.split(/\s+/)

    for (const word of words) {
      if (!word) continue

      const letter = word[0].toUpperCase()
      const value = word.substring(1)

      switch (letter) {
        // Motion commands
        case 'G':
          this.parseGCommand(value, block)
          break

        // Miscellaneous commands
        case 'M':
          this.parseMCommand(value, block)
          break

        // Coordinates
        case 'X':
        case 'Y':
        case 'Z':
        case 'A':
        case 'B':
        case 'C':
          block.coordinates![letter.toLowerCase() as keyof Coordinates] = parseFloat(value)
          break

        // Feed rate
        case 'F':
          block.feedRate = parseFloat(value)
          this.validateFeedRate(block.feedRate)
          break

        // Spindle speed
        case 'S':
          block.spindleSpeed = parseFloat(value)
          break

        // Tool number
        case 'T':
          block.toolNumber = parseInt(value, 10)
          break

        // Other parameters
        case 'I':
        case 'J':
        case 'K':
        case 'P':
        case 'Q':
        case 'R':
          // Параметры для круговой интерполяции и др.
          block.parameters = block.parameters || {}
          block.parameters[letter] = parseFloat(value)
          break

        default:
          this.warnings.push({
            line: this.lineNumber,
            message: `Unknown command: ${word}`,
            severity: 'warning',
            code: line
          })
      }
    }

    // Проверка блока
    this.validateBlock(block)

    return block
  }

  private parseGCommand(value: string, block: GCodeBlock): void {
    const gCode = parseInt(value, 10)

    // Определяем модальную группу
    let modalGroup = 0

    // Группа 1: Motion
    if ([0, 1, 2, 3, 38].includes(gCode)) {
      modalGroup = 1
      block.modalGroups[1] = `G${gCode}`
    }
    // Группа 3: Plane selection
    else if ([17, 18, 19].includes(gCode)) {
      modalGroup = 3
      block.modalGroups[3] = `G${gCode}`
    }
    // Группа 6: Units
    else if ([20, 21].includes(gCode)) {
      modalGroup = 6
      block.modalGroups[6] = `G${gCode}`
    }
    // Группа 7: Distance mode
    else if ([90, 91].includes(gCode)) {
      modalGroup = 7
      block.modalGroups[7] = `G${gCode}`
    }
    // Группа 8: Arc IJK mode
    else if ([90.1, 91.1].includes(gCode)) {
      modalGroup = 8
      block.modalGroups[8] = `G${gCode}`
    }
    // Группа 13: Feed rate mode
    else if ([93, 94].includes(gCode)) {
      modalGroup = 13
      block.modalGroups[13] = `G${gCode}`
    }

    block.gCode = gCode
  }

  private parseMCommand(value: string, block: GCodeBlock): void {
    const mCode = parseInt(value, 10)
    block.mCode = mCode

    // Проверка поддерживаемых M-команд
    const supportedMCommands = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30]
    if (!supportedMCommands.includes(mCode)) {
      this.warnings.push({
        line: this.lineNumber,
        message: `M${mCode} may not be supported by your controller`,
        severity: 'warning',
        code: block.original
      })
    }
  }

  private removeComments(line: string): string {
    // Удаляем комментарии в скобках
    let result = line.replace(/\(.*?\)/g, '')

    // Удаляем комментарии с точкой с запятой
    const semicolonIndex = result.indexOf(';')
    if (semicolonIndex !== -1) {
      result = result.substring(0, semicolonIndex)
    }

    return result.trim()
  }

  private validateBlock(block: GCodeBlock): void {
    // Проверка G0/G1 с координатами
    if (block.gCode === 0 || block.gCode === 1) {
      if (!block.coordinates || Object.keys(block.coordinates).length === 0) {
        this.errors.push({
          line: block.lineNumber,
          message: `G${block.gCode} requires coordinates`,
          severity: 'error',
          code: block.original
        })
        block.isValid = false
      }
    }

    // Проверка G2/G3 (круговая интерполяция)
    if (block.gCode === 2 || block.gCode === 3) {
      if (!block.coordinates) {
        this.errors.push({
          line: block.lineNumber,
          message: `G${block.gCode} requires endpoint coordinates`,
          severity: 'error',
          code: block.original
        })
        block.isValid = false
      }

      // Проверка параметров I,J для дуги
      if (!block.parameters || (!block.parameters.I && !block.parameters.J && !block.parameters.R)) {
        this.errors.push({
          line: block.lineNumber,
          message: `G${block.gCode} requires I,J or R parameters`,
          severity: 'error',
          code: block.original
        })
        block.isValid = false
      }
    }

    // Проверка зондирования G38.2
    if (block.gCode === 38.2) {
      if (!block.coordinates || !block.coordinates.z) {
        this.errors.push({
          line: block.lineNumber,
          message: 'G38.2 requires Z coordinate',
          severity: 'error',
          code: block.original
        })
        block.isValid = false
      }

      if (!block.feedRate) {
        this.errors.push({
          line: block.lineNumber,
          message: 'G38.2 requires feed rate (F)',
          severity: 'error',
          code: block.original
        })
        block.isValid = false
      }
    }
  }

  private validateFeedRate(feedRate: number): void {
    if (feedRate <= 0) {
      this.errors.push({
        line: this.lineNumber,
        message: `Invalid feed rate: ${feedRate}. Must be positive.`,
        severity: 'error',
        code: ''
      })
    }

    if (feedRate > 10000) {
      this.warnings.push({
        line: this.lineNumber,
        message: `High feed rate: ${feedRate} mm/min. Verify machine limits.`,
        severity: 'warning',
        code: ''
      })
    }
  }

  private validateProgram(blocks: GCodeBlock[]): void {
    let currentModalGroups: { [key: number]: string } = {}
    let inInches = false
    let absoluteMode = true
    let hasSpindleCommand = false
    let hasToolChange = false

    for (const block of blocks) {
      // Проверка модальных групп
      for (const [group, value] of Object.entries(block.modalGroups)) {
        const groupNum = parseInt(group, 10)

        // Проверка конфликтов
        if (currentModalGroups[groupNum] && currentModalGroups[groupNum] !== value) {
          this.warnings.push({
            line: block.lineNumber,
            message: `Modal group ${group} changed from ${currentModalGroups[groupNum]} to ${value}`,
            severity: 'info',
            code: block.original
          })
        }

        currentModalGroups[groupNum] = value

        // Отслеживание важных состояний
        if (value === 'G20') inInches = true
        if (value === 'G21') inInches = false
        if (value === 'G90') absoluteMode = true
        if (value === 'G91') absoluteMode = false
      }

      // Проверка M-команд
      if (block.mCode === 3 || block.mCode === 4) {
        hasSpindleCommand = true
      }

      if (block.mCode === 6) {
        hasToolChange = true
      }
    }

    // Предупреждения о программе
    if (inInches) {
      this.warnings.push({
        line: 1,
        message: 'Program uses inches (G20). Make sure machine is configured correctly.',
        severity: 'warning',
        code: ''
      })
    }

    if (!absoluteMode) {
      this.warnings.push({
        line: 1,
        message: 'Program uses incremental mode (G91). This can be dangerous for resume after stop.',
        severity: 'warning',
        code: ''
      })
    }

    if (!hasSpindleCommand) {
      this.warnings.push({
        line: 1,
        message: 'Program has no spindle commands (M3/M4). Spindle will not start automatically.',
        severity: 'warning',
        code: ''
      })
    }

    if (hasToolChange) {
      this.warnings.push({
        line: 1,
        message: 'Program has tool changes (M6). Manual tool change may be required.',
        severity: 'warning',
        code: ''
      })
    }
  }

  private estimateExecutionTime(blocks: GCodeBlock[]): number {
    let totalTime = 0 // секунды
    let currentPosition: Coordinates = { x: 0, y: 0, z: 0 }
    let currentFeedRate = 1000 // мм/мин по умолчанию

    for (const block of blocks) {
      if (block.gCode === 0 || block.gCode === 1) {
        // Линейное движение
        if (block.coordinates) {
          const distance = this.calculateDistance(currentPosition, block.coordinates)
          const feedRate = block.feedRate || currentFeedRate

          if (feedRate > 0) {
            const time = (distance / feedRate) * 60 // секунды
            totalTime += time
          }

          currentPosition = { ...currentPosition, ...block.coordinates }
          if (block.feedRate) currentFeedRate = block.feedRate
        }
      } else if (block.gCode === 2 || block.gCode === 3) {
        // Дуговое движение (упрощенно)
        if (block.coordinates && block.feedRate) {
          const distance = this.estimateArcDistance(currentPosition, block.coordinates, block.parameters)
          const time = (distance / block.feedRate) * 60
          totalTime += time

          currentPosition = { ...currentPosition, ...block.coordinates }
          currentFeedRate = block.feedRate
        }
      } else if (block.mCode === 3 || block.mCode === 4) {
        // Включение шпинделя - добавляем время разгона
        totalTime += 2 // 2 секунды на разгон
      } else if (block.mCode === 5) {
        // Выключение шпинделя - добавляем время остановки
        totalTime += 1 // 1 секунда на остановку
      } else if (block.mCode === 6) {
        // Смена инструмента
        totalTime += 10 // 10 секунд на смену инструмента
      }

      // Базовая задержка на обработку команды
      totalTime += 0.05 // 50 мс на команду
    }

    return totalTime
  }

  private calculateDistance(from: Coordinates, to: Coordinates): number {
    const dx = (to.x || from.x || 0) - (from.x || 0)
    const dy = (to.y || from.y || 0) - (from.y || 0)
    const dz = (to.z || from.z || 0) - (from.z || 0)

    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  private estimateArcDistance(from: Coordinates, to: Coordinates, params?: { [key: string]: number }): number {
    // Упрощенная оценка длины дуги
    const radius = params?.R || Math.sqrt((params?.I || 0) ** 2 + (params?.J || 0) ** 2)
    if (radius > 0) {
      // Оцениваем длину дуги как четверть окружности
      return 2 * Math.PI * radius / 4
    }

    // Если не можем оценить, используем линейное расстояние
    return this.calculateDistance(from, to)
  }

  private calculateBoundingBox(blocks: GCodeBlock[]): BoundingBox {
    const bbox: BoundingBox = {
      min: { x: Infinity, y: Infinity, z: Infinity },
      max: { x: -Infinity, y: -Infinity, z: -Infinity },
      size: { x: 0, y: 0, z: 0 }
    }

    let currentPosition: Coordinates = { x: 0, y: 0, z: 0 }

    for (const block of blocks) {
      if (block.coordinates) {
        // Обновляем текущую позицию
        currentPosition = { ...currentPosition, ...block.coordinates }

        // Обновляем ограничивающий прямоугольник
        if (currentPosition.x !== undefined) {
          bbox.min.x = Math.min(bbox.min.x ?? Infinity, currentPosition.x);
          bbox.max.x = Math.max(bbox.max.x ?? -Infinity, currentPosition.x);
        }
        if (currentPosition.y !== undefined) {
          bbox.min.y = Math.min(bbox.min.y ?? Infinity, currentPosition.y);
          bbox.max.y = Math.max(bbox.max.y ?? -Infinity, currentPosition.y);
        }
        if (currentPosition.z !== undefined) {
          bbox.min.z = Math.min(bbox.min.z ?? Infinity, currentPosition.z);
          bbox.max.z = Math.max(bbox.max.z ?? -Infinity, currentPosition.z);
        }
      }
    }

    // Handle cases where no coordinates were found
    if (bbox.min.x === Infinity) {
      bbox.min = { x: 0, y: 0, z: 0 };
      bbox.max = { x: 0, y: 0, z: 0 };
    }

    // Вычисляем размеры
    bbox.size.x = (bbox.max.x ?? 0) - (bbox.min.x ?? 0);
    bbox.size.y = (bbox.max.y ?? 0) - (bbox.min.y ?? 0);
    bbox.size.z = (bbox.max.z ?? 0) - (bbox.min.z ?? 0);

    return bbox
  }

  // Проверка безопасности программы
  checkSafety(blocks: GCodeBlock[], machineLimits: MachineLimits): SafetyCheckResult {
    const result: SafetyCheckResult = {
      safe: true,
      issues: [],
      warnings: [],
      maxFeedRate: 0,
      maxSpindleSpeed: 0,
      travelLimitsExceeded: false
    }

    for (const block of blocks) {
      // Проверка скорости подачи
      if (block.feedRate && block.feedRate > machineLimits.maxFeedRate) {
        result.issues.push({
          line: block.lineNumber,
          type: 'feed_rate_exceeded',
          message: `Feed rate ${block.feedRate} exceeds machine limit ${machineLimits.maxFeedRate}`,
          severity: 'error'
        })
        result.safe = false
      }

      if (block.feedRate && block.feedRate > result.maxFeedRate) {
        result.maxFeedRate = block.feedRate
      }

      // Проверка скорости шпинделя
      if (block.spindleSpeed && block.spindleSpeed > machineLimits.maxSpindleSpeed) {
        result.issues.push({
          line: block.lineNumber,
          type: 'spindle_speed_exceeded',
          message: `Spindle speed ${block.spindleSpeed} exceeds machine limit ${machineLimits.maxSpindleSpeed}`,
          severity: 'error'
        })
        result.safe = false
      }

      if (block.spindleSpeed && block.spindleSpeed > result.maxSpindleSpeed) {
        result.maxSpindleSpeed = block.spindleSpeed
      }

      // Проверка координат на превышение рабочих границ
      if (block.coordinates) {
        for (const [axis, value] of Object.entries(block.coordinates)) {
          const limit = machineLimits.travelLimits[axis as 'x' | 'y' | 'z']
          if (limit && (value < limit.min || value > limit.max)) {
            result.issues.push({
              line: block.lineNumber,
              type: 'travel_limit_exceeded',
              message: `${axis.toUpperCase()}=${value} exceeds machine limits (${limit.min} to ${limit.max})`,
              severity: 'error'
            })
            result.safe = false
            result.travelLimitsExceeded = true
          }
        }
      }

      // Проверка опасных команд без подтверждения
      if (block.gCode === 0 && block.coordinates?.z && block.coordinates.z < 0) {
        result.warnings.push({
          line: block.lineNumber,
          type: 'rapid_downward_move',
          message: `Rapid downward move to Z=${block.coordinates.z}. Verify clearance.`,
          severity: 'warning'
        })
      }

      if (block.mCode === 3 || block.mCode === 4) {
        result.warnings.push({
          line: block.lineNumber,
          type: 'spindle_start',
          message: `Spindle start (M${block.mCode}). Ensure workpiece is secured.`,
          severity: 'warning'
        })
      }
    }

    return result
  }

  // Оптимизация G-code
  optimize(blocks: GCodeBlock[]): GCodeBlock[] {
    const optimized: GCodeBlock[] = []
    let lastBlock: GCodeBlock | null = null

    for (const block of blocks) {
      // Пропускаем невалидные блоки
      if (!block.isValid) {
        optimized.push(block)
        continue
      }

      // Объединение последовательных линейных перемещений с одинаковыми параметрами
      if (lastBlock &&
          (block.gCode === 0 || block.gCode === 1) &&
          (lastBlock.gCode === 0 || lastBlock.gCode === 1) &&
          block.feedRate === lastBlock.feedRate &&
          block.spindleSpeed === lastBlock.spindleSpeed &&
          Object.keys(block.modalGroups).every(k =>
            block.modalGroups[parseInt(k, 10)] === lastBlock!.modalGroups[parseInt(k, 10)]
          )) {

        // Объединяем координаты
        const mergedCoordinates = { ...lastBlock.coordinates, ...block.coordinates }
        lastBlock.coordinates = mergedCoordinates
        lastBlock.original += `\n${block.original}`
      } else {
        optimized.push(block)
        lastBlock = block
      }
    }

    return optimized
  }
}
