#!/usr/bin/env node
import { Command } from 'commander';
import { bootstrap } from './cli/bootstrap.js';
import { cmdAdd } from './cli/commands/add.js';
import { cmdSetStatus, cmdMv } from './cli/commands/status.js';
import { cmdLog, cmdWorklogs } from './cli/commands/worklog.js';
import { fail } from './cli/format.js';

const program = new Command();
program
  .name('td')
  .description('Todocko CLI — rychlé osobní ovládání z terminálu')
  .version('1.0.0')
  .option('--json', 'strojový JSON výstup');

const json = () => program.opts().json === true;

/** Bootstrap Evolu, run the command, exit with its code. Errors → exit 1. */
async function run(fn: (evolu: Awaited<ReturnType<typeof bootstrap>>) => Promise<number>): Promise<void> {
  try {
    const evolu = await bootstrap();
    process.exit(await fn(evolu));
  } catch (e) {
    process.stderr.write(fail(`Chyba: ${(e as Error).message}`) + '\n');
    process.exit(1);
  }
}

program
  .command('add')
  .description('přidat úkol')
  .argument('<name>', 'název úkolu')
  .option('-p, --project <code>', 'projekt (kód; výchozí = první projekt)')
  .option('--priority <p>', 'low|medium|high|urgent')
  .option('--deadline <date>', 'YYYY-MM-DD')
  .option('--scheduled <date>', 'today|tomorrow|YYYY-MM-DD')
  .action((name, opts) => run((e) => cmdAdd(e, name, opts, json())));

program
  .command('done')
  .description('označit úkol jako hotový')
  .argument('<code>', 'kód úkolu (např. TODO-160)')
  .action((code) => run((e) => cmdSetStatus(e, code, 'done', json())));

program
  .command('start')
  .description('přesunout úkol do in_progress')
  .argument('<code>', 'kód úkolu')
  .action((code) => run((e) => cmdSetStatus(e, code, 'in_progress', json())));

program
  .command('mv')
  .description('změnit stav úkolu')
  .argument('<code>', 'kód úkolu')
  .argument('<status>', 'backlog|todo|in_progress|review|done')
  .action((code, status) => run((e) => cmdMv(e, code, status, json())));

program
  .command('log')
  .description('zalogovat čas k úkolu')
  .argument('<code>', 'kód úkolu')
  .argument('<duration>', 'např. 1h30m, 45m, 90')
  .argument('[description]', 'popis práce')
  .action((code, duration, description) => run((e) => cmdLog(e, code, duration, description, json())));

program
  .command('worklogs')
  .description('vypsat worklogy úkolu')
  .argument('<code>', 'kód úkolu')
  .action((code) => run((e) => cmdWorklogs(e, code, json())));

program.parseAsync(process.argv);
