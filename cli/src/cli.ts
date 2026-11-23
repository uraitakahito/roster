// roster <命令> …
//
// 担当（Claude Code）のあいだの決まりを受け持つ命令。命令の一覧は program.ts（roster --help）。
// cli/bin/roster（sh）が本当の在り処の path でこれを node で直に動かす（build は無い。nodenv が repo の .node-version を読むため）。
// 決まりの誤り（TpmError）の扱いは runProgram（program.ts）。
import { runProgram } from './program.ts';

await runProgram(process.argv);
