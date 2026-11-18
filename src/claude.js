// 用 Claude 認衫：只會送一張縮細咗、已去背（白底）嘅衫相，唔會送原相
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { kvGet } from './db.js';

export const CATEGORIES = ['上衣', '褲', '裙', '連身裙', '外套', '鞋', '袋', '配飾'];
export const SEASONS = ['春', '夏', '秋', '冬'];
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5（最準，每件約 HK$0.1）' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5（慳錢，每件約 HK$0.005）' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    type: { type: 'string', description: '細分類，例如 T恤、恤衫、冷衫、牛仔褲、半截裙、波鞋' },
    name: { type: 'string', description: '簡短名，例如「米白色冷衫」' },
    colors: {
      type: 'array',
      description: '主要顏色，最多 3 個，最主要排第一',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '中文顏色名，例如 米白、卡其、粉紅' },
          hex: { type: 'string', description: '#RRGGBB' },
        },
        required: ['name', 'hex'],
        additionalProperties: false,
      },
    },
    seasons: { type: 'array', items: { type: 'string', enum: SEASONS } },
    tags: {
      type: 'array',
      description: '風格／場合標籤，最多 4 個，例如 休閒、返工、約會、運動',
      items: { type: 'string' },
    },
    is_clothing: { type: 'boolean', description: '相入面係咪真係一件衫／鞋／袋／配飾' },
  },
  required: ['category', 'type', 'name', 'colors', 'seasons', 'tags', 'is_clothing'],
  additionalProperties: false,
};

const PROMPT =
  '呢張相係一件已經去咗背景嘅衣物（白色係背景）。請判斷佢係咩類別、細分類、主要顏色、適合咩季節（香港天氣：夏天好熱，冬天大約 10-18 度），' +
  '再俾一個簡短中文名同幾個風格標籤。全部用香港繁體中文。';

export async function getApiKey() {
  return (await kvGet('apiKey')) || '';
}

function client(apiKey) {
  return new Anthropic({
    apiKey,
    // 個 key 只儲喺呢部手機，由手機直接 call Anthropic，冇經任何中間伺服器
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
    timeout: 60_000,
  });
}

// imageBlob：白底 JPEG
export async function classify(imageBlob) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new NoKeyError();
  const model = (await kvGet('model')) || DEFAULT_MODEL;
  const data = await blobToBase64(imageBlob);
  const params = {
    model,
    max_tokens: 4000,
    output_config: { effort: 'low', format: jsonSchemaOutputFormat(SCHEMA) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
  };
  const res = await client(apiKey).messages.parse(params);
  if (res.stop_reason === 'refusal') throw new Error('Claude 唔肯認呢張相');
  if (!res.parsed_output) throw new Error('Claude 回覆格式唔啱');
  return res.parsed_output;
}

// 測試 key 用：最平嘅細請求
export async function testKey(apiKey) {
  await client(apiKey).models.list({ limit: 1 });
  return true;
}

export class NoKeyError extends Error {
  constructor() {
    super('未設定 Claude API key');
    this.name = 'NoKeyError';
  }
}

export function friendlyError(e) {
  if (e instanceof NoKeyError) return '未入 API key（去「設定」入）';
  if (e instanceof Anthropic.AuthenticationError) return 'API key 唔啱，去「設定」檢查下';
  if (e instanceof Anthropic.PermissionDeniedError) return '個 key 冇權限用呢個模型';
  if (e instanceof Anthropic.RateLimitError) return '用得太密，等陣再試';
  if (e instanceof Anthropic.BadRequestError) {
    const msg = String(e.message || '');
    if (/credit|balance|billing/i.test(msg)) return 'API 額度用晒，要去 Anthropic Console 增值';
    return '請求有問題：' + msg.slice(0, 120);
  }
  if (e instanceof Anthropic.APIConnectionError) return '連唔到網絡，有網再試';
  if (e instanceof Anthropic.APIError) return 'Claude 暫時有問題，等陣再試';
  return e?.message || String(e);
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
