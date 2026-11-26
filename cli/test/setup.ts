// どの試験の file にも掛かる片付け（vitest.config.ts の setupFiles）。
import { afterEach } from 'vitest';
import { messageRecordsSettled } from '../src/commands/message-record.ts';

// 送る命令は、送った記録の置き場への写しを待たずに始める。前の試験の写しが、後の試験の間に済んで混ざらないように、試験ごとに済むのを待つ。
afterEach(messageRecordsSettled);
