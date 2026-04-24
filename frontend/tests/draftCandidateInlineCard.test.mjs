import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cardSource = readFileSync(
    new URL('../src/features/discussion-intake/candidate-cards/DraftCandidateInlineCard.tsx', import.meta.url),
    'utf8',
);
const cardStyles = readFileSync(
    new URL('../src/features/discussion-intake/candidate-cards/DraftCandidateInlineCard.module.css', import.meta.url),
    'utf8',
);
const zhMessages = readFileSync(
    new URL('../src/i18n/messages/zh.json', import.meta.url),
    'utf8',
);
const enMessages = readFileSync(
    new URL('../src/i18n/messages/en.json', import.meta.url),
    'utf8',
);
const plazaTabSource = readFileSync(
    new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
    'utf8',
);
const discussionApiSource = readFileSync(
    new URL('../src/lib/discussion/api.ts', import.meta.url),
    'utf8',
);
const pageStyles = readFileSync(
    new URL('../src/app/(main)/circles/[id]/page.module.css', import.meta.url),
    'utf8',
);

test('DraftCandidateInlineCard collapses notice details behind an explicit toggle', () => {
    assert.match(cardSource, /useState/);
    assert.match(cardSource, /const hasCollapsibleDetails =/);
    assert.match(cardSource, /detailsExpanded/);
    assert.match(cardSource, /t\('actions\.expandDetails'\)/);
    assert.match(cardSource, /t\('actions\.collapseDetails'\)/);
});

test('DraftCandidateInlineCard defines collapsed details and toggle styles', () => {
    assert.match(cardStyles, /\.detailsToggle\s*\{/);
});

test('DraftCandidateInlineCard detail toggle copy is localized', () => {
    assert.match(zhMessages, /"expandDetails":\s*"展开详情"/);
    assert.match(zhMessages, /"collapseDetails":\s*"收起详情"/);
    assert.match(enMessages, /"expandDetails":\s*"Show details"/);
    assert.match(enMessages, /"collapseDetails":\s*"Hide details"/);
});

test('DraftCandidateInlineCard hides create action when a draft already exists', () => {
    assert.match(cardSource, /const canOpenDraft = typeof notice\.draftPostId === 'number' && notice\.draftPostId > 0;/);
    assert.match(cardSource, /const canCreateDraft = !canOpenDraft && notice\.state === 'open'/);
});

test('DraftCandidateInlineCard supports embedded rendering inside system message bubbles', () => {
    assert.match(cardSource, /embedded\?: boolean;/);
    assert.match(cardSource, /footerNote\?: string;/);
    assert.match(cardSource, /className=\{embedded \? styles\.cardEmbeddedRoot : styles\.card\}/);
    assert.match(cardStyles, /\.cardEmbeddedRoot\s*\{/);
    assert.match(cardStyles, /padding-right:\s*2px;/);
    assert.match(cardSource, /className=\{`\$\{styles\.header\} \$\{embedded \? styles\.headerEmbedded : ''\}`\}/);
    assert.match(cardSource, /className=\{`\$\{styles\.title\} \$\{embedded \? styles\.titleEmbedded : ''\}`\}/);
    assert.match(cardSource, /className=\{`\$\{styles\.state\} \$\{embedded \? styles\.stateEmbedded : ''\}`\}/);
    assert.match(plazaTabSource, /<DraftCandidateInlineCard[\s\S]*embedded/);
    assert.match(plazaTabSource, /footerNote=\{t\('candidate\.persistedNotice'\)\}/);
    assert.match(cardSource, /const primaryAction =/);
    assert.match(cardSource, /const secondaryActions =/);
    assert.match(cardSource, /styles\.actionsSecondary/);
    assert.match(cardSource, /styles\.actionsSecondaryEmbedded/);
    assert.match(cardSource, /styles\.footerRow/);
    assert.match(cardSource, /styles\.footerRowEmbedded/);
    assert.match(cardSource, /styles\.footerMeta/);
    assert.match(cardSource, /styles\.footerPrimary/);
    assert.match(cardStyles, /\.actionsEmbedded\s*\{/);
    assert.match(cardStyles, /\.actionsSecondary\s*\{/);
    assert.match(cardStyles, /\.actionsSecondaryEmbedded\s*\{/);
    assert.match(cardStyles, /\.footerRow\s*\{/);
    assert.match(cardStyles, /\.footerRowEmbedded\s*\{/);
    assert.match(cardStyles, /\.footerMeta\s*\{/);
    assert.match(cardStyles, /\.footerPrimary\s*\{/);
    assert.match(cardStyles, /\.footerPrimary\s+\.actionBtn\s*\{/);
    assert.match(cardStyles, /min-height:\s*30px;/);
    assert.match(cardStyles, /\.primaryAction\s*\{/);
    assert.match(cardStyles, /\.textAction\s*\{/);
    assert.match(cardStyles, /\.headerEmbedded\s*\{/);
    assert.match(cardStyles, /\.titleEmbedded\s*\{/);
    assert.match(cardStyles, /\.stateEmbedded\s*\{/);
});

test('System candidate notices use compact bubble padding for embedded cards', () => {
    assert.match(pageStyles, /\.msgRowSystem \.msgAuthorRow\s*\{/);
    assert.match(pageStyles, /padding:\s*9px 10px 8px;/);
    assert.match(pageStyles, /\.msgRowSystem \.msgAuthor\s*\{/);
    assert.match(pageStyles, /\.msgRowSystem \.msgAvatar\s*\{/);
});

test('Embedded system candidate notice uses reduced visual weight', () => {
    assert.match(cardStyles, /\.cardEmbeddedRoot\s*\{/);
    assert.match(cardStyles, /\.cardEmbeddedRoot \.primaryAction\s*\{/);
    assert.match(cardStyles, /\.cardEmbeddedRoot \.footerNote\s*\{/);
    assert.match(cardStyles, /\.titleEmbedded\s*\{[\s\S]*font-size:\s*12px;/);
    assert.match(cardStyles, /\.cardEmbeddedRoot \.actionBtn\s*\{[\s\S]*font-size:\s*11px;/);
    assert.match(cardStyles, /\.cardEmbeddedRoot \.footerNote\s*\{[\s\S]*font-size:\s*9px;/);
    assert.match(pageStyles, /\.msgRowSystem \.msgAuthor\s*\{[\s\S]*font-size:\s*10px;/);
    assert.match(pageStyles, /\.msgRowSystem \.msgTime\s*\{[\s\S]*font-size:\s*10px;/);
});

test('Plaza candidate notices wire the manual create draft action', () => {
    assert.match(discussionApiSource, /export async function createDraftFromCandidate/);
    assert.match(discussionApiSource, /\/api\/v1\/discussion\/circles\/\$\{input\.circleId\}\/candidates\/\$\{encodeURIComponent\(input\.candidateId\)\}\/create-draft/);
    assert.match(plazaTabSource, /createDraftFromCandidate/);
    assert.match(plazaTabSource, /const \[creatingCandidateDraftId, setCreatingCandidateDraftId\] = useState<string \| null>\(null\);/);
    assert.match(plazaTabSource, /const handleCandidateCreateDraft = useCallback/);
    assert.match(plazaTabSource, /onCreateDraft=\{handleCandidateCreateDraft\}/);
    assert.match(plazaTabSource, /createDraftBusy=\{creatingCandidateDraftId === candidateNoticeForRender\.candidateId\}/);
});
