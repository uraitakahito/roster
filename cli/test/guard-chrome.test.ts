// guard の (7): Chrome の直起こしを止める（t-qx3r。台帳 #402・#403）。試験は字を judge に渡すだけで、命令は打たない。
import { describe, expect, test } from 'vitest';
import { judge } from '../src/guard.ts';
import { chromeLaunch, chromeSuggestion } from '../src/guard-chrome.ts';

const ask = (command: string) => judge({ command, role: 'software-engineer', config: { infra: {}, trackers: { jira: [], github: [] } }, approvals: {}, now: new Date('2026-11-28T00:00:00Z') });

const CHROME = '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"';
const TESTING = '"$HOME/.cache/puppeteer/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"';

describe('Chrome の直起こしを止める（旗があっても）', () => {
  test.each([
    `${CHROME} --headless=new --screenshot=/tmp/a.png https://example.com`,
    `${CHROME} --use-mock-keychain --password-store=basic --headless=new --screenshot=/tmp/a.png x`,
    // 今日の t-wafb の形（同じ 1 行の代入と、括弧の中の裏の起こし）。
    `CH=${TESTING}; ("$CH" --headless --remote-debugging-port=19555 --user-data-dir=/tmp/p >/tmp/c.log 2>&1 &)`,
    `CH=${TESTING} && "\${CH}" --headless`,
    '"$ROSTER_CHROME" --headless --screenshot=/tmp/a.png x',
    '$(mdfind -name chromium | head -1) --headless',
    `exec ${CHROME} --headless`,
    `eval '${CHROME} --headless'`,
    `echo x | xargs ${CHROME}`,
    `timeout 30 ${CHROME} --headless`,
    `gtimeout -s KILL 30 ${CHROME} --headless`,
    `caffeinate -t 60 ${CHROME} --headless`,
    `sh -c '${CHROME} --headless'`,
    `nohup ${CHROME} --headless &`,
    'chromium --headless',
    'google-chrome-stable --headless',
    'chrome-headless-shell --dump-dom x',
    '"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" --headless',
    `${CHROME} --help`,
    `ROSTER_RAW=1 ${CHROME} --headless`,
    'cd /tmp && /opt/chromium/chromium --headless',
  ])('止める: %s', (command) => {
    const verdict = ask(command);
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toContain('Chrome を直に起こす命令は止めます');
  });

  test.each([
    'open -a "Google Chrome" https://example.com',
    'open -na "Google Chrome" --args --headless',
    'open -gna Chromium',
    'open -b com.google.Chrome https://example.com',
    'open "/Applications/Google Chrome for Testing.app" --args --headless',
  ])('open で Chrome を開くのは、別の訳で止める: %s', (command) => {
    const verdict = ask(command);
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) {
      expect(verdict.reason).toContain('open で Chrome を開く命令は止めます');
      expect(verdict.reason).toContain('URL を報告に書いてください');
    }
  });
});

describe('Chrome を起こさない命令は通す', () => {
  test.each([
    'roster chrome run -- --screenshot=/tmp/a.png https://example.com',
    'roster chrome start --bin for-testing -- --disable-gpu',
    'R=./cli/bin/roster; "$R" chrome start -- --headless',
    '$(which roster) chrome start -- --headless',
    '"$EDITOR" docs/chrome.md',
    `${CHROME} --version`,
    '"$ROSTER_CHROME" --version',
    'command -v chromium',
    'command -V "Google Chrome"',
    'which chromium',
    'type chromium',
    'ls ~/.cache/puppeteer/chrome',
    'ls "/Applications/Google Chrome.app"',
    'git log -- cli/src/chrome.ts',
    'osascript -e \'quit app "Google Chrome"\'',
    'defaults read com.google.Chrome',
    'grep -r "Google Chrome" .',
    'pgrep -fl chrome',
    'pnpm test:e2e',
    'npx playwright test',
    'BROWSERHIVE_BROWSER_URL=http://127.0.0.1:19555 pnpm exec vitest run',
    'node dist/bin/main.js --port 50081',
    'container run --rm --name x ghcr.io/x/chromium-server:1',
    'open https://example.com',
    'open -a Preview /tmp/a.png',
    'echo "Google Chrome --headless"',
  ])('通す: %s', (command) => {
    expect(ask(command)).toEqual({ allow: true });
  });
});

describe('案内の 1 行（chromeSuggestion）', () => {
  /** 止めた形の案内（直起こしのはず）。 */
  const suggest = (command: string): string => {
    const launch = chromeLaunch(command);
    if (launch?.kind !== 'direct') throw new Error(`直起こしとして止まらない: ${command}`);
    return chromeSuggestion(launch);
  };

  test('CDP の口を開く形は start、撮りは run。roster chrome が付ける・断る旗は外し、profile と口は旗に替える', () => {
    expect(suggest(`CH=${TESTING}; "$CH" --headless --remote-debugging-port=19555 --user-data-dir=/tmp/p --no-first-run --host-resolver-rules="MAP x 127.0.0.1"`))
      .toBe('roster chrome start --bin for-testing@156 --profile /tmp/p --port 19555 -- --headless \'--host-resolver-rules=MAP x 127.0.0.1\'');
    expect(suggest(`${CHROME} --use-mock-keychain --password-store=basic --screenshot=/tmp/a.png x`))
      .toBe('roster chrome run --bin \'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\' -- --screenshot=/tmp/a.png x');
    // 変数を含む path は、shell が展開するように二重引用で包む。
    expect(suggest('D="$HOME/opt/chromium"; "$D" --dump-dom x')).toBe('roster chrome run --bin "$HOME/opt/chromium" -- --dump-dom x');
  });
});
