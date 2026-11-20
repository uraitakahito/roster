#!/usr/bin/env node
// tpm <命令> …
//
// 担当（Claude Code）のあいだの決まりを受け持つ命令。命令の一覧は program.ts（tpm --help）。
// cli/bin/tpm（sh）が本当の在り処の path でこれを node で直に動かす（build は無い。nodenv が repo の .node-version を読むため）。
import { buildProgram } from './program.ts';
import { TpmError } from './skill-sets.ts';

try {
  buildProgram().parse(process.argv);
}
catch (e) {
  if (!(e instanceof TpmError)) throw e;
  process.stderr.write(`tpm: ${e.message}\n`);
  process.exit(1);
}
