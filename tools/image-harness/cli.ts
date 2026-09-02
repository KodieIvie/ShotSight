#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { analyzeImageFiles, type FileAnalysisOptions } from './pipeline';
import type { Rect, Sensitivity } from './types';

interface CliOptions extends FileAnalysisOptions {
  readonly baselinePath: string;
  readonly currentPath: string;
  readonly jsonPath?: string;
}

const help = `ShotSight image-processing test harness

Usage:
  npx tsx tools/image-harness/cli.ts <baseline> <current> [options]
  npx tsx tools/image-harness/cli.ts --baseline <path> --current <path> [options]

Options:
  -b, --baseline <path>       Clean/reference target image
  -c, --current <path>        Image containing the suspected new impact
  -d, --debug-dir <dir>       Write registered.png, difference.png, and mask.png
  -o, --json <path>           Also write the JSON result to a file
      --sensitivity <level>   low, medium, or high (default: medium)
      --max-shift <pixels>    Maximum registration translation (default: 20)
      --max-dimension <px>    Longest processing edge; 0 keeps full size (default: 1600)
      --roi <x,y,w,h>         Restrict registration and detection to this processing-pixel rectangle
      --min-area <pixels>     Minimum connected-component area
      --max-area <pixels>     Maximum connected-component area
  -h, --help                  Show this help

JSON is always printed to stdout. Diagnostic errors are written to stderr.
`;

function nextValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseNonNegativeNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${option} must be a non-negative number`);
  }
  return parsed;
}

function parseRoi(value: string): Rect {
  const parts = value.split(',').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isFinite(part)) ||
    parts[0] < 0 ||
    parts[1] < 0 ||
    parts[2] <= 0 ||
    parts[3] <= 0
  ) {
    throw new Error('--roi must use x,y,width,height with a positive width and height');
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

export function parseCliArgs(args: readonly string[]): CliOptions | 'help' {
  if (args.includes('--help') || args.includes('-h')) {
    return 'help';
  }
  const positional: string[] = [];
  let baselinePath: string | undefined;
  let currentPath: string | undefined;
  let jsonPath: string | undefined;
  let debugDirectory: string | undefined;
  let sensitivity: Sensitivity | undefined;
  let maxShift: number | undefined;
  let maxDimension: number | undefined;
  let roi: Rect | undefined;
  let minimumArea: number | undefined;
  let maximumArea: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--baseline':
      case '-b':
        baselinePath = nextValue(args, index, argument);
        index += 1;
        break;
      case '--current':
      case '-c':
        currentPath = nextValue(args, index, argument);
        index += 1;
        break;
      case '--debug-dir':
      case '-d':
        debugDirectory = nextValue(args, index, argument);
        index += 1;
        break;
      case '--json':
      case '-o':
        jsonPath = nextValue(args, index, argument);
        index += 1;
        break;
      case '--sensitivity': {
        const value = nextValue(args, index, argument);
        if (value !== 'low' && value !== 'medium' && value !== 'high') {
          throw new Error('--sensitivity must be low, medium, or high');
        }
        sensitivity = value;
        index += 1;
        break;
      }
      case '--max-shift':
        maxShift = parseNonNegativeNumber(nextValue(args, index, argument), argument);
        index += 1;
        break;
      case '--max-dimension':
        maxDimension = parseNonNegativeNumber(nextValue(args, index, argument), argument);
        index += 1;
        break;
      case '--roi':
        roi = parseRoi(nextValue(args, index, argument));
        index += 1;
        break;
      case '--min-area':
        minimumArea = parseNonNegativeNumber(nextValue(args, index, argument), argument);
        index += 1;
        break;
      case '--max-area':
        maximumArea = parseNonNegativeNumber(nextValue(args, index, argument), argument);
        index += 1;
        break;
      default:
        if (argument.startsWith('-')) {
          throw new Error(`Unknown option: ${argument}`);
        }
        positional.push(argument);
    }
  }

  baselinePath ??= positional[0];
  currentPath ??= positional[1];
  if (positional.length > 2) {
    throw new Error(`Unexpected positional argument: ${positional[2]}`);
  }
  if (!baselinePath || !currentPath) {
    throw new Error('Both baseline and current image paths are required');
  }
  if (
    minimumArea !== undefined &&
    maximumArea !== undefined &&
    minimumArea > maximumArea
  ) {
    throw new Error('--min-area cannot be greater than --max-area');
  }

  return {
    baselinePath,
    currentPath,
    ...(jsonPath ? { jsonPath } : {}),
    ...(debugDirectory ? { debugDirectory } : {}),
    ...(sensitivity ? { sensitivity } : {}),
    ...(maxShift !== undefined ? { maxShift } : {}),
    ...(maxDimension !== undefined ? { maxDimension } : {}),
    ...(roi ? { roi } : {}),
    ...(minimumArea !== undefined ? { minimumArea } : {}),
    ...(maximumArea !== undefined ? { maximumArea } : {}),
  };
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseCliArgs(args);
    if (options === 'help') {
      process.stdout.write(help);
      return 0;
    }
    const result = await analyzeImageFiles(options.baselinePath, options.currentPath, options);
    const json = `${JSON.stringify(result, null, 2)}\n`;
    if (options.jsonPath) {
      await writeFile(options.jsonPath, json, 'utf8');
    }
    process.stdout.write(json);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`image-harness: ${message}\n\n${help}`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
