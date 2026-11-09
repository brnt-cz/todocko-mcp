#!/usr/bin/env node
import { Command } from 'commander';
import { bootstrap } from './cli/bootstrap.js';
import { cmdAdd } from './cli/commands/add.js';
import { cmdSetStatus, cmdMv } from './cli/commands/status.js';
import { cmdLog, cmdWorklogs } from './cli/commands/worklog.js';
import { cmdList, cmdToday } from './cli/commands/list.js';
import { fail } from './cli/format.js';
import { VERSION } from './version.js';

const program = new Command();
program
  .name('todo')
  .description('Todocko CLI – rychlé osobní ovládání z terminálu')
  .version(VERSION)
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
  .command('list')
  .description('vypsat úkoly (bez --all skryje hotové a opakované)')
  .option('-p, --project <code>', 'jen tenhle projekt (kód)')
  .option('--status <s>', 'backlog|todo|in_progress|review|done|recurring')
  .option('--all', 'včetně hotových a opakovaných')
  .option('--limit <n>', 'nejvýš n úkolů')
  .option('--no-shared', 'vynechat sdílené projekty (rychlejší)')
  .action((opts) => run((e) => cmdList(e, opts, json())));

program
  .command('today')
  .description('co je na dnešek: po termínu, termín dnes, naplánované a rozdělané')
  .option('-p, --project <code>', 'jen tenhle projekt (kód)')
  .option('--no-shared', 'vynechat sdílené projekty (rychlejší)')
  .action((opts) => run((e) => cmdToday(e, opts, json())));

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
