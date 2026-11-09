/**
 * Interactive recorder for agents with no API (like an Agentplace public agent page): it shows each customer
 * message, copies it to the clipboard, and you paste the agent's reply back. Progress is saved after every
 * case, so you can stop and resume any time.
 * Copyright (c) 2026 Kartikeya Mishra. MIT License.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LineReader } from './lines.js';
import type { TestCase, Transcript } from './types.js';
import { nowIso, sanitizeReply, writeJson } from './util.js';

function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'win32') {
      const f = join(tmpdir(), `arl-clip-${process.pid}.txt`);
      writeFileSync(f, text, 'utf8');
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Content -Raw -Encoding UTF8 -LiteralPath '${f.replace(/'/g, "''")}' | Set-Clipboard`], { timeout: 5000 });
      unlinkSync(f);
      return r.status === 0;
    }
    const cmd = process.platform === 'darwin' ? ['pbcopy', []] : ['xclip', ['-selection', 'clipboard']];
    const r = spawnSync(cmd[0] as string, cmd[1] as string[], { input: text, timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

export async function recordInteractive(path: string, t: Transcript, cases: TestCase[], clipboard: boolean): Promise<void> {
  const rl = new LineReader();
  const save = () => {
    t.recordedAt = nowIso();
    writeJson(path, t);
  };
  console.log('\nFor EACH test case open a NEW chat with your agent (fresh session), then follow the prompts.');
  console.log('Paste the agent reply, then type /end on its own line.  Commands: /skip  /redo  /quit\n');
  try {
    for (const [i, tc] of cases.entries()) {
      const existing = t.cases[tc.id];
      if (existing && existing.turns.length === tc.turns.length && existing.turns.every((x) => x.agent.trim())) continue;
      console.log(`\n━━ [${i + 1}/${cases.length}] ${tc.id} — ${tc.title}  (start a NEW chat now)`);
      const turns: Array<{ user: string; agent: string }> = [];
      let skip = false;
      for (let j = 0; j < tc.turns.length; j++) {
        const user = tc.turns[j]!;
        const copied = clipboard && copyToClipboard(user);
        console.log(`\nCUSTOMER (turn ${j + 1}/${tc.turns.length})${copied ? ' [copied to clipboard]' : ''}:\n  ${user}\n`);
        console.log('Paste AGENT reply, then /end:');
        const buf: string[] = [];
        for (;;) {
          const line = await rl.next();
          if (line === null) {
            save();
            console.log(`\nInput closed. Saved progress to ${path}.`);
            return;
          }
          const cmd = line.trim();
          if (cmd === '/end') break;
          if (cmd === '/quit') {
            save();
            console.log(`Saved progress to ${path}. Run the same command to resume.`);
            return;
          }
          if (cmd === '/skip') {
            skip = true;
            break;
          }
          if (cmd === '/redo') {
            j = -1;
            turns.length = 0;
            buf.length = 0;
            console.log('Restarting this case — open a NEW chat.');
            break;
          }
          buf.push(line);
        }
        if (skip) break;
        if (j === -1) continue;
        const agent = sanitizeReply(buf.join('\n').trim());
        if (!agent) {
          console.log('Empty reply — paste the agent reply again.');
          j--;
          continue;
        }
        turns.push({ user, agent });
      }
      if (!skip && turns.length === tc.turns.length) {
        t.cases[tc.id] = { turns };
        save();
        console.log(`✓ saved ${tc.id}`);
      }
    }
    save();
    console.log(`\nAll cases recorded → ${path}`);
  } finally {
    rl.close();
  }
}
