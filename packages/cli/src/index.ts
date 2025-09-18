#!/usr/bin/env node
import { createProgram } from './lib/program.js';

const program = createProgram();
program.parse(process.argv);

// If no command is provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
