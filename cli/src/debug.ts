// tpm debug …: adapter を 1 つずつ実機で確かめるための命令。決まりの命令が揃ったら消す。
import { Command } from 'commander';
import { createContext } from './context.ts';
import { NOTE_KINDS, type NoteKind } from './tracker/types.ts';

const print = (value: unknown): void => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

export function debugCommand(): Command {
  const debug = new Command('debug').description('adapter を実機で確かめる（開発用）');
  const transport = debug.command('transport').description('連携の adapter');
  transport.command('whoami').action(() => print(createContext().transport.whoami()));
  transport.command('seats').action(() => print(createContext().transport.seats()));
  transport.command('status <address>').action((address: string) => print(createContext().transport.status(address) ?? '（居場所が無い）'));
  transport.command('set-status <key> <text>').action((key: 'model' | 'wait', text: string) => createContext().transport.setStatus(key, text));
  transport.command('send <to> <from> <text>').option('--reply-to <id>').action((to: string, from: string, text: string, options: { replyTo?: string }) =>
    print(createContext().transport.send(to, from, text, options.replyTo)));
  const tracker = debug.command('tracker').description('課題管理の adapter');
  tracker.command('comment <key> <kind> <role> <summary>').description(`kind は ${NOTE_KINDS.join('・')}`)
    .option('--link <label=url>', 'リンク', (v: string, all: string[]) => [...all, v], [] as string[])
    .option('--point <text>', '要点', (v: string, all: string[]) => [...all, v], [] as string[])
    .action((key: string, kind: NoteKind, role: string, summary: string, options: { link: string[], point: string[] }) => {
      const links = options.link.map((l) => {
        const at = l.indexOf('=');
        return { label: l.slice(0, at), url: l.slice(at + 1) };
      });
      createContext().tracker.comment(key, { kind, role, summary, links, points: options.point });
    });
  tracker.command('comments <key>').action((key: string) => print(createContext().tracker.comments(key)));
  tracker.command('close <key>').action((key: string) => createContext().tracker.close(key));
  return debug;
}
