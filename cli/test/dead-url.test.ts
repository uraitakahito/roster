// 試験の道具の「何も待っていない所」（deadUrl）が、この機械で使えるか（AI-56）。
import { createServer } from 'node:net';
import { describe, expect, test } from 'vitest';
import { assertRefused, deadUrl } from './next-fake.ts';

describe('deadUrl', () => {
  test('番号 1 で、つなぐとすぐ断られる', async () => {
    const started = Date.now();
    expect(await deadUrl()).toBe('http://127.0.0.1:1');
    expect(Date.now() - started).toBeLessThan(500);
  });

  test('待ち受ける物があれば、揺れずに投げて知らせる', async () => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      await expect(assertRefused('127.0.0.1', port)).rejects.toThrow('で何かが待ち受けている');
    }
    finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
