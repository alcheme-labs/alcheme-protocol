import {
    AUTHOR_ANNOTATION_KINDS,
    type AuthorAnnotation,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from './types';
import { hasQuestionSignal } from '../../../ai/discussion-intelligence/rules';

function normalizeText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function parseAuthorAnnotationKind(value: unknown): AuthorAnnotationKind | null {
    const normalized = String(value || '').trim().toLowerCase();
    return (AUTHOR_ANNOTATION_KINDS as readonly string[]).includes(normalized)
        ? (normalized as AuthorAnnotationKind)
        : null;
}

export function normalizeAuthorAnnotations(raw: unknown): AuthorAnnotation[] {
    if (!Array.isArray(raw)) return [];

    const normalized: AuthorAnnotation[] = [];
    for (const entry of raw) {
        if (typeof entry === 'string') {
            const kind = parseAuthorAnnotationKind(entry);
            if (kind) normalized.push({ kind, source: 'author' });
            continue;
        }
        if (entry && typeof entry === 'object') {
            const kind = parseAuthorAnnotationKind((entry as { kind?: unknown }).kind);
            if (kind) normalized.push({ kind, source: 'author' });
        }
    }

    return normalized;
}

export function inferSemanticFacets(input: {
    text: string;
    authorAnnotations?: AuthorAnnotation[];
}): SemanticFacet[] {
    const text = normalizeText(input.text);
    const facets = new Set<SemanticFacet>();

    for (const annotation of input.authorAnnotations || []) {
        facets.add(annotation.kind);
    }

    if (hasQuestionSignal(text)) {
        facets.add('question');
    }
    if (/(卡点|痛点|阻塞|瓶颈|摩擦|矛盾|困境|失败|异常|卡住|没有明确结论|没人知道下一步|聊完就散|problem|issue|blocker|friction|stuck|unclear next step)/i.test(text)) {
        facets.add('problem');
    }
    if (
        /((第一|第二|第三|第四|首先|其次|再次|最后)[，、,:：])/.test(text)
        || /\b(first|second|third|fourth|criteria|criterion|conditions?|checklist|thresholds?)\b/i.test(text)
    ) {
        facets.add('criteria');
    }
    if (/(因为|所以|意味着|本质上|说明|根因|原因|也就是说|换句话说|观点是|关键在于|问题不在于|在于)/i.test(text)) {
        facets.add('explanation');
    }
    if (/(建议|应该|可以先|不如|我们需要|最好|要不要|按这个思路|先产出|试试看|先生成|起一个草稿|先做|先试)/i.test(text)) {
        facets.add('proposal');
    }
    if (/(总结|综上|当前共识|总之|结论是|小结|归纳一下)/i.test(text)) {
        facets.add('summary');
    }
    if (/(担心|开心|高兴|失望|愤怒|焦虑|喜欢|讨厌|难受|激动|害怕|生气|沮丧|乐观|悲观|兴奋|失落|挫败|烦躁|紧张|期待)/i.test(text)) {
        facets.add('emotion');
    }
    if (
        !facets.has('question')
        && !facets.has('summary')
        && /(\d|已经|目前|存在|发现|观察到|数据显示|日志显示|结果是)/i.test(text)
    ) {
        facets.add('fact');
    }

    return Array.from(facets);
}
