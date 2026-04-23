import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const diagnosticsClientSource = readFileSync(
  new URL('../src/lib/admin/discussionDiagnosticsClient.ts', import.meta.url),
  'utf8',
);
const diagnosticsPageSource = readFileSync(
  new URL('../src/app/dev/discussion-diagnostics/page.tsx', import.meta.url),
  'utf8',
);

test('discussion diagnostics client uses the private-sidecar analysis REST route', () => {
  assert.match(
    diagnosticsClientSource,
    /\/api\/v1\/discussion\/admin\/messages\/\$\{encodeURIComponent\(normalizedEnvelopeId\)\}\/analysis/,
  );
  assert.match(
    diagnosticsClientSource,
    /\/api\/v1\/discussion\/admin\/messages\/\$\{encodeURIComponent\(normalizedEnvelopeId\)\}\/reanalyze/,
  );
  assert.match(
    diagnosticsClientSource,
    /\/api\/v1\/discussion\/admin\/circles\/\$\{encodeURIComponent\(normalizedCircleId\)\}\/summary/,
  );
  assert.match(
    diagnosticsClientSource,
    /\/api\/v1\/discussion\/admin\/circles\/\$\{encodeURIComponent\(normalizedCircleId\)\}\/trigger/,
  );
});

test('discussion diagnostics page reads through the dedicated admin client rather than Apollo', () => {
  assert.match(
    diagnosticsPageSource,
    /from ['"]@\/lib\/admin\/discussionDiagnosticsClient['"]/,
  );
  assert.doesNotMatch(diagnosticsPageSource, /@apollo\/client/);
  assert.doesNotMatch(diagnosticsPageSource, /from ['"].*lib\/apollo/);
});

test('discussion diagnostics page can load recent circle messages for envelope selection', () => {
  assert.match(
    diagnosticsPageSource,
    /from ['"]@\/lib\/discussion\/api['"]/,
  );
  assert.match(diagnosticsPageSource, /fetchDiscussionMessages/);
  assert.match(diagnosticsPageSource, /Circle ID/);
  assert.match(diagnosticsPageSource, /读取最近消息/);
  assert.match(diagnosticsPageSource, /最近消息/);
});

test('discussion diagnostics page highlights key analysis signals above raw JSON', () => {
  assert.match(diagnosticsPageSource, /关键诊断/);
  assert.match(diagnosticsPageSource, /当前样本/);
  assert.match(diagnosticsPageSource, /运行状态/);
  assert.match(diagnosticsPageSource, /实际模式/);
  assert.match(diagnosticsPageSource, /Topic Profile/);
  assert.match(diagnosticsPageSource, /错误信息/);
  assert.match(diagnosticsPageSource, /Message Analysis/);
  assert.match(diagnosticsPageSource, /Discussion Summary/);
  assert.match(diagnosticsPageSource, /Trigger/);
  assert.match(diagnosticsPageSource, /Ghost Draft/);
  assert.match(diagnosticsPageSource, /Human Overrides/);
  assert.match(diagnosticsPageSource, /Input/);
  assert.match(diagnosticsPageSource, /Runtime/);
  assert.match(diagnosticsPageSource, /Output/);
  assert.match(diagnosticsPageSource, /Decision/);
  assert.match(diagnosticsPageSource, /Failure/);
  assert.match(diagnosticsPageSource, /circle-scoped/);
  assert.match(diagnosticsPageSource, /message-scoped/);
});

test('discussion diagnostics page guards async diagnostics loads with a request sequence token', () => {
  assert.match(diagnosticsPageSource, /useRef/);
  assert.match(diagnosticsPageSource, /selectionRequestIdRef/);
  assert.match(diagnosticsPageSource, /const requestId = \+\+selectionRequestIdRef\.current/);
  assert.match(diagnosticsPageSource, /if \(requestId !== selectionRequestIdRef\.current\) return;/);
});

test('discussion diagnostics page translates common admin errors into human-readable guidance', () => {
  assert.match(diagnosticsPageSource, /toHumanReadableDiagnosticsError/);
  assert.match(diagnosticsPageSource, /case 'authentication_required'/);
  assert.match(diagnosticsPageSource, /请先登录拥有该圈层管理权限的账号/);
  assert.match(diagnosticsPageSource, /case 'private_sidecar_required'/);
  assert.match(diagnosticsPageSource, /当前诊断接口只能在 private sidecar 节点访问/);
  assert.match(diagnosticsPageSource, /case 'discussion_message_not_found'/);
});
