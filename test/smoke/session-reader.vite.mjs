import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { createSessionReader } from '../../session-core/index.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), 'palmdesk-reader-browser-'));
const uuid = '33333333-3333-4333-8333-333333333333';
const record = (payload, type = 'response_item') => JSON.stringify({ timestamp: new Date().toISOString(), type, payload });
const message = (role, text) => record({ type: 'message', role, content: [{ type: 'output_text', text }] });
await mkdir(path.join(directory, 'sessions'));
const file = path.join(directory, 'sessions', `rollout-${uuid}.jsonl`);
await writeFile(file, [
  record({ id: uuid, cwd: '/workspace/palmdesk' }, 'session_meta'),
  message('user', '给 PalmDesk 增加适合手机的会话阅读。'),
  ...Array.from({ length: 64 }, (_, i) => message(i % 2 ? 'assistant' : 'user', `历史消息 ${i + 1}：核对会话读取、窗口切换和手机上的阅读体验。`)),
  record({ type: 'function_call', name: 'exec_command', call_id: 'test-command', arguments: JSON.stringify({ cmd: 'pnpm test:smoke' }) }),
  record({ type: 'function_call_output', call_id: 'test-command', output: '测试输出\n'.repeat(3000) }),
  message('assistant', '# 会话阅读已接入\n\n现在可以在手机上阅读 **Codex 回复**，并随时回到原窗口继续操作。\n\n- 支持历史记录与复制\n- 命令输出默认折叠\n- 新回复不会打断当前位置\n\n```ts\nconst view = "read";\n```\n\n这是一条合成测试记录。[查看项目](https://github.com/Abreto/palmdesk)。'),
  record({ type: 'task_complete' }, 'event_msg'),
].join('\n') + '\n');
await writeFile(path.join(directory, 'session_index.jsonl'), JSON.stringify({ id: uuid, thread_name: 'PalmDesk · 会话阅读', updated_at: new Date().toISOString() }) + '\n');
const claudeConfigDir = path.join(directory, 'claude');
const claudeFile = path.join(claudeConfigDir, 'projects', '-workspace-palmdesk', `${uuid}.jsonl`);
const claudeRecord = (value) => JSON.stringify({ sessionId: uuid, cwd: '/workspace/palmdesk', timestamp: new Date().toISOString(), ...value });
const claudeMessage = (role, text, id) => claudeRecord({ type: role, uuid: id, message: { content: text, stop_reason: role === 'assistant' ? 'end_turn' : null } });
await mkdir(path.dirname(claudeFile), { recursive: true });
await writeFile(claudeFile, [
  claudeRecord({ type: 'custom-title', customTitle: 'PalmDesk · Claude 会话阅读' }),
  ...Array.from({ length: 65 }, (_, i) => claudeMessage(i % 2 ? 'assistant' : 'user', `Claude 历史消息 ${i + 1}：核对两种来源的会话阅读。`, `claude-message-${i}`)),
  claudeRecord({ type: 'assistant', uuid: 'claude-tool', message: { content: [{ type: 'tool_use', id: 'claude-bash', name: 'Bash', input: { command: 'pnpm test:smoke' } }] } }),
  claudeRecord({ type: 'user', uuid: 'claude-result', message: { content: [{ type: 'tool_result', tool_use_id: 'claude-bash', content: 'Claude 测试输出\n'.repeat(3000) }] } }),
  claudeMessage('assistant', '# Claude 阅读已接入\n\n现在支持 **Claude Code 回复**，并保留历史分页和工具输出。\n\n```ts\nconst provider = "claude-code";\n```\n\n这是一条合成测试记录。', 'claude-final'),
].join('\n') + '\n');
const claudeDesktopDataDir = path.join(directory, 'Claude');
const desktopUuid = '44444444-4444-4444-8444-444444444444';
const desktopId = 'local_dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const desktopOrg = path.join(claudeDesktopDataDir, 'claude-code-sessions', 'aaaaaaaa', 'bbbbbbbb');
const desktopFile = path.join(desktopOrg, desktopId, '.claude', 'projects', '-workspace-palmdesk', `${desktopUuid}.jsonl`);
const desktopMessage = (role, text, id) => JSON.stringify({
  sessionId: desktopUuid, cwd: '/workspace/palmdesk', timestamp: new Date().toISOString(),
  type: role, uuid: id, message: { content: text, stop_reason: role === 'assistant' ? 'end_turn' : null },
});
await mkdir(path.dirname(desktopFile), { recursive: true });
await writeFile(path.join(desktopOrg, `${desktopId}.json`), JSON.stringify({
  sessionId: desktopId, cliSessionId: desktopUuid, title: 'PalmDesk · Desktop Code 会话',
  createdAt: Date.now(), lastActivityAt: Date.now(),
}));
await writeFile(desktopFile, [
  ...Array.from({ length: 65 }, (_, i) => desktopMessage(i % 2 ? 'assistant' : 'user', `Desktop 历史消息 ${i + 1}：读取本地 Code 会话。`, `desktop-message-${i}`)),
  desktopMessage('assistant', '# Desktop Code 阅读已接入\n\n这是通过 Desktop 索引发现的**合成会话**。支持历史分页和新回复。', 'desktop-final'),
].join('\n') + '\n');
const reader = createSessionReader({ codexHome: directory, claudeConfigDir, claudeDesktopDataDir });
let enabled = true;
let updates = 0;

export default defineConfig({
  root,
  resolve: { alias: { '@': path.join(root, 'src') } },
  define: { 'process.env': { NODE_ENV: 'development', BilldHtmlWebpackPlugin: {} } },
  css: { preprocessorOptions: { scss: { additionalData: '@use "billd-scss/src/index.scss" as *;@import "@/assets/css/constant.scss";' } } },
  plugins: [vue(), {
    name: 'synthetic-session-reader',
    configureServer(server) {
      server.middlewares.use('/__reader_fixture', async (req, res) => {
        try {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          let body = '';
          for await (const part of req) { body += part; if (body.length > 4096) throw new Error('request too large'); }
          const data = JSON.parse(body);
          let result;
          if (data.method === 'status') result = { enabled, supported: true };
          else if (data.method === 'toggle') { enabled = !enabled; result = { enabled }; }
          else if (data.method === 'append') {
            updates += 1;
            const text = `## 新回复 ${updates}\n\n读取位置已保留，点击更新后才能看到这条合成消息。`;
            if (data.id === `claude-code:session-file:${desktopUuid}`) {
              await appendFile(desktopFile, desktopMessage('assistant', text, `desktop-update-${updates}`) + '\n');
            } else if (data.id?.startsWith('claude-code:')) {
              await appendFile(claudeFile, claudeMessage('assistant', text, `claude-update-${updates}`) + '\n');
            } else await appendFile(file, message('assistant', text) + '\n');
            result = { updates };
          } else if (!enabled) throw new Error('会话读取已关闭');
          else if (data.method === 'list') result = await reader.list(data.query);
          else if (data.method === 'read') result = await reader.read(data.id, data.cursor);
          else throw new Error('unsupported fixture action');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
      });
    },
  }],
  server: { host: '127.0.0.1', port: 5194, strictPort: true },
});
