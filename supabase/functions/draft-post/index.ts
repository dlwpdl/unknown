// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const CATEGORIES = ['life', 'food', 'travel', 'shopping', 'settlement', 'transport', 'housing', 'education', 'meetup'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return jsonError('METHOD_NOT_ALLOWED', 'POST 요청만 지원합니다.', 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return jsonError('AUTH_REQUIRED', '로그인이 필요합니다.', 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonError('AUTH_REQUIRED', '로그인이 필요합니다.', 401);

    const input = await request.json();
    const validationError = validateInput(input);
    if (validationError) return jsonError('INVALID_INPUT', validationError, 400);

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');

    const quota = await supabase.rpc('reserve_ai_draft');
    if (quota.error) {
      if (quota.error.message.includes('AI_DRAFT_LIMIT_REACHED')) {
        return jsonError('DAILY_LIMIT_REACHED', '오늘의 AI 초안 5회를 모두 사용했습니다.', 429);
      }
      throw quota.error;
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        store: false,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildPrompt(input),
            },
            {
              type: 'input_image',
              image_url: `data:${input.mimeType};base64,${input.imageBase64}`,
              detail: 'low',
            },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'gling_post_draft',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['categorySlug', 'title', 'body', 'hashtags'],
              properties: {
                categorySlug: { type: 'string', enum: CATEGORIES },
                title: { type: 'string', minLength: 1, maxLength: 80 },
                body: { type: 'string', minLength: 1, maxLength: 4000 },
                hashtags: {
                  type: 'array',
                  maxItems: 5,
                  items: { type: 'string', minLength: 1, maxLength: 30 },
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`OPENAI_${response.status}`);
    const result = await response.json();
    const outputText = result.output
      ?.flatMap((item: { content?: unknown[] }) => item.content ?? [])
      .find((item: { type?: string }) => item.type === 'output_text')?.text;
    if (typeof outputText !== 'string') throw new Error('OPENAI_EMPTY_OUTPUT');

    return new Response(JSON.stringify({ draft: JSON.parse(outputText) }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('draft-post failed', error instanceof Error ? error.message : 'unknown');
    return jsonError('DRAFT_FAILED', '초안을 만들지 못했습니다.', 500);
  }
});

function validateInput(input: unknown) {
  if (!input || typeof input !== 'object') return '요청 형식이 올바르지 않습니다.';
  const value = input as Record<string, unknown>;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(value.mimeType))) {
    return 'JPG, PNG, WebP 사진만 지원합니다.';
  }
  if (typeof value.imageBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.imageBase64)) {
    return '사진 데이터가 올바르지 않습니다.';
  }
  if (Math.ceil(value.imageBase64.length * 0.75) > MAX_IMAGE_BYTES) return '사진은 5MB 이하여야 합니다.';
  if (typeof value.cityName !== 'string' || value.cityName.length > 40) return '지역이 올바르지 않습니다.';
  if (typeof value.selectedCategory !== 'string' || !CATEGORIES.includes(value.selectedCategory)) {
    return '카테고리가 올바르지 않습니다.';
  }
  if (value.titleHint != null && (typeof value.titleHint !== 'string' || value.titleHint.length > 80)) return '제목 힌트가 너무 깁니다.';
  if (value.bodyHint != null && (typeof value.bodyHint !== 'string' || value.bodyHint.length > 1000)) return '본문 힌트가 너무 깁니다.';
  return null;
}

function buildPrompt(input: Record<string, string>) {
  return [
    '당신은 북미 한인 커뮤니티 글링의 글쓰기 도우미입니다.',
    '사진에서 확실히 보이는 큰 특징만 사용해 자연스러운 한국어 게시글 초안을 만드세요.',
    '브랜드, 가격, 상태, 날짜, 장소, 인원처럼 사진으로 확인할 수 없는 정보는 지어내지 말고 필요한 경우 [가격], [날짜], [장소], [인원]으로 남기세요.',
    '판매 글로 단정하지 말고 사용자의 힌트와 선택 카테고리를 우선하되 사진과 맞지 않으면 9개 카테고리 중 더 알맞은 것을 고르세요.',
    '해시태그는 # 없이 최대 5개, 지역 표기는 제공된 도시 이름을 사용하세요.',
    `입력: ${JSON.stringify({ cityName: input.cityName, selectedCategory: input.selectedCategory, titleHint: input.titleHint, bodyHint: input.bodyHint })}`,
  ].join('\n');
}

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
