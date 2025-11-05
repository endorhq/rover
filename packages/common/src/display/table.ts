import colors from 'ansi-colors';
import { stripAnsi } from './utils.js';

/**
 * Column configuration for table rendering
 */
export interface TableColumn<T> {
  /** Column header text */
  header: string;

  /** Property key or function to extract value from row */
  key: keyof T | ((row: T) => any);

  /** Fixed width (overrides min/max) */
  width?: number;

  /** Minimum column width */
  minWidth?: number;

  /** Maximum column width */
  maxWidth?: number;

  /** Text alignment */
  align?: 'left' | 'right' | 'center';

  /** Format function to transform value (can add colors here) */
  format?: (value: any, row: T) => string;

  /** How to handle text overflow */
  truncate?: boolean | 'ellipsis' | 'word';

  /** Allow multi-line content */
  wrap?: boolean;

  /** Hide column conditionally */
  hide?: boolean | ((row: T) => boolean);
}

/**
 * Table rendering options
 */
export interface TableOptions {
  /** Show table header */
  showHeader?: boolean;

  /** Show separator line after header */
  showSeparator?: boolean;

  /** Character to use for separator line */
  separatorChar?: string;

  /** Style function for header text */
  headerStyle?: (text: string) => string;

  /** Border style */
  borderStyle?: 'none' | 'separator' | 'full';

  /** Maximum table width (defaults to terminal width) */
  maxTableWidth?: number;

  /** Minimum spacing between columns (default: 1) */
  columnSpacing?: number;

  /** Sort by column key */
  sortBy?: string;

  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Get visible width of a string (excluding ANSI codes)
 */
const getVisibleWidth = (str: string): number => {
  return stripAnsi(str).length;
};

/**
 * Pad string to target width, accounting for ANSI codes
 */
const padString = (
  str: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left'
): string => {
  const visibleWidth = getVisibleWidth(str);
  const padding = Math.max(0, width - visibleWidth);

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
  } else {
    return str + ' '.repeat(padding);
  }
};

/**
 * Truncate text to fit within max length
 */
const truncateText = <T>(
  text: string,
  maxLength: number,
  mode: boolean | 'ellipsis' | 'word' = 'ellipsis',
  formatFn?: (value: any, row: T) => string,
  row?: T
): string => {
  if (!mode || getVisibleWidth(text) <= maxLength) {
    return text;
  }

  const stripped = stripAnsi(text);
  let truncated: string;

  if (mode === 'word') {
    // Find last complete word that fits
    truncated = stripped.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > 0) {
      truncated = truncated.substring(0, lastSpace);
    }
    truncated += '...';
  } else {
    // Simple truncation with ellipsis
    truncated = stripped.substring(0, maxLength - 3) + '...';
  }

  // Re-apply format function if provided
  // Pass truncated text as value to format function
  return formatFn && row !== undefined ? formatFn(truncated, row) : truncated;
};

/**
 * Extract value from row using column key
 */
const extractValue = <T>(row: T, column: TableColumn<T>): any => {
  if (typeof column.key === 'function') {
    return column.key(row);
  } else {
    return row[column.key];
  }
};

/**
 * Calculate optimal column widths based on content
 */
const calculateColumnWidths = <T>(
  columns: TableColumn<T>[],
  data: T[],
  maxTableWidth?: number
): number[] => {
  const widths: number[] = [];

  for (const column of columns) {
    // If fixed width is specified, use it
    if (column.width !== undefined) {
      widths.push(column.width);
      continue;
    }

    // Calculate width based on content
    const headerWidth = getVisibleWidth(column.header);
    let maxWidth = headerWidth;

    // Check data rows
    for (const row of data) {
      const value = extractValue(row, column);
      const formatted = column.format
        ? column.format(value, row)
        : String(value);
      const width = getVisibleWidth(formatted);
      maxWidth = Math.max(maxWidth, width);
    }

    // Apply min/max constraints
    if (column.minWidth !== undefined) {
      maxWidth = Math.max(maxWidth, column.minWidth);
    }
    if (column.maxWidth !== undefined) {
      // Prioritize header width: if header is wider than maxWidth, use header width
      maxWidth = Math.min(maxWidth, Math.max(column.maxWidth, headerWidth));
    }

    widths.push(maxWidth);
  }

  return widths;
};

/**
 * Filter columns based on hide conditions
 */
const filterColumns = <T>(
  columns: TableColumn<T>[],
  row?: T
): TableColumn<T>[] => {
  return columns.filter(column => {
    if (column.hide === undefined) return true;
    if (typeof column.hide === 'boolean') return !column.hide;
    if (row && typeof column.hide === 'function') return !column.hide(row);
    return true;
  });
};

/**
 * Table renderer class
 */
export class Table<T = any> {
  private columns: TableColumn<T>[];
  private options: Required<TableOptions>;

  constructor(columns: TableColumn<T>[], options: TableOptions = {}) {
    this.columns = columns;
    this.options = {
      showHeader: options.showHeader ?? true,
      showSeparator: options.showSeparator ?? true,
      separatorChar: options.separatorChar ?? '─',
      headerStyle: options.headerStyle ?? ((text: string) => colors.bold(text)),
      borderStyle: options.borderStyle ?? 'separator',
      maxTableWidth: options.maxTableWidth ?? process.stdout.columns ?? 120,
      columnSpacing: options.columnSpacing ?? 1,
      sortBy: options.sortBy ?? '',
      sortOrder: options.sortOrder ?? 'asc',
    };
  }

  /**
   * Render the table to console
   */
  render(data: T[]): void {
    if (data.length === 0) {
      return;
    }

    // Filter columns (check first row for dynamic hide conditions)
    const visibleColumns = filterColumns(this.columns, data[0]);

    if (visibleColumns.length === 0) {
      return;
    }

    // Calculate column widths
    const columnWidths = calculateColumnWidths(
      visibleColumns,
      data,
      this.options.maxTableWidth
    );

    // Render header
    if (this.options.showHeader) {
      this.renderHeader(visibleColumns, columnWidths);
    }

    // Render separator
    if (this.options.showSeparator && this.options.showHeader) {
      this.renderSeparator(columnWidths);
    }

    // Render data rows
    for (const row of data) {
      this.renderRow(row, visibleColumns, columnWidths);
    }
  }

  /**
   * Render header row
   */
  private renderHeader(columns: TableColumn<T>[], widths: number[]): void {
    let row = '';
    columns.forEach((column, index) => {
      const header = this.options.headerStyle(column.header);
      const align = column.align ?? 'left';
      row += padString(header, widths[index], align);

      // Add spacing between columns (but not after the last column)
      if (index < columns.length - 1) {
        row += ' '.repeat(this.options.columnSpacing);
      }
    });
    console.log(row);
  }

  /**
   * Render separator line
   */
  private renderSeparator(widths: number[]): void {
    let separator = '';
    widths.forEach((width, index) => {
      separator += this.options.separatorChar.repeat(width);

      // Add separator for column spacing (but not after the last column)
      if (index < widths.length - 1) {
        separator += this.options.separatorChar.repeat(
          this.options.columnSpacing
        );
      }
    });
    console.log(colors.gray(separator));
  }

  /**
   * Render data row
   */
  private renderRow(row: T, columns: TableColumn<T>[], widths: number[]): void {
    let rowStr = '';
    columns.forEach((column, index) => {
      const value = extractValue(row, column);
      let formatted = String(value);

      // Handle truncation and formatting
      if (column.truncate && column.maxWidth) {
        formatted = truncateText<T>(
          formatted,
          column.maxWidth,
          column.truncate,
          column.format,
          row
        );
      } else if (column.truncate) {
        formatted = truncateText<T>(
          formatted,
          widths[index],
          column.truncate,
          column.format,
          row
        );
      } else if (column.format) {
        // Apply format if no truncation
        formatted = column.format(value, row);
      }

      // Apply alignment
      const align = column.align ?? 'left';
      rowStr += padString(formatted, widths[index], align);

      // Add spacing between columns (but not after the last column)
      if (index < columns.length - 1) {
        rowStr += ' '.repeat(this.options.columnSpacing);
      }
    });
    console.log(rowStr);
  }
}

/**
 * Convenience function to render a table
 */
export const renderTable = <T>(
  data: T[],
  columns: TableColumn<T>[],
  options?: TableOptions
): void => {
  const table = new Table(columns, options);
  table.render(data);
};
