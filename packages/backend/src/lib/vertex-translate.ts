import type { Env } from '../types';

type VertexServiceAccount = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  token_uri?: string;
};

type VertexTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_VERTEX_MODEL = 'gemini-2.5-flash';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
};

export async function translateTextWithVertex(
  env: Env,
  text: string,
  targetLanguage: string,
  sourceLanguage = 'ko',
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || targetLanguage === sourceLanguage || targetLanguage === 'ko') return trimmed;

  const credentials = readVertexCredentials(env);
  const accessToken = await createAccessToken(credentials);
  const translated = await generateTranslation({
    env,
    credentials,
    accessToken,
    text: trimmed,
    targetLanguage,
    sourceLanguage,
  });
  return translated || trimmed;
}

function readVertexCredentials(env: Env): Required<
  Pick<VertexServiceAccount, 'client_email' | 'private_key' | 'project_id'>
> & {
  token_uri: string;
} {
  if (!env.GOOGLE_VERTEX_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON is not configured.');
  }
  let parsed: VertexServiceAccount;
  try {
    parsed = JSON.parse(env.GOOGLE_VERTEX_CREDENTIALS_JSON) as VertexServiceAccount;
  } catch {
    throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON must be valid service account JSON.');
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON is missing required service account fields.');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
    token_uri: parsed.token_uri || DEFAULT_TOKEN_URI,
  };
}

async function createAccessToken(
  credentials: ReturnType<typeof readVertexCredentials>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    {
      alg: 'RS256',
      typ: 'JWT',
    },
    {
      iss: credentials.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    },
    credentials.private_key,
  );

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json: VertexTokenResponse = await response.json<VertexTokenResponse>().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || `Vertex auth failed (${response.status})`,
    );
  }
  return json.access_token;
}

async function generateTranslation(args: {
  env: Env;
  credentials: ReturnType<typeof readVertexCredentials>;
  accessToken: string;
  text: string;
  targetLanguage: string;
  sourceLanguage: string;
}): Promise<string> {
  const location = args.env.GOOGLE_VERTEX_LOCATION || DEFAULT_VERTEX_LOCATION;
  const model = args.env.GOOGLE_VERTEX_MODEL || DEFAULT_VERTEX_MODEL;
  const endpoint =
    `https://aiplatform.googleapis.com/v1/projects/${args.credentials.project_id}` +
    `/locations/${location}/publishers/google/models/${model}:generateContent`;
  const targetName = LANGUAGE_NAMES[args.targetLanguage] || args.targetLanguage;
  const sourceName = LANGUAGE_NAMES[args.sourceLanguage] || args.sourceLanguage;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Translate the following alarm message from ${sourceName} to ${targetName}. ` +
                'Return only the translated sentence, with no explanation, no markdown, and no quotes.\n\n' +
                args.text,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 256,
      },
    }),
  });
  const json: VertexGenerateContentResponse & { error?: { message?: string } } = await response
    .json<VertexGenerateContentResponse & { error?: { message?: string } }>()
    .catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message || `Vertex translation failed (${response.status})`);
  }
  return (json.candidates?.[0]?.content?.parts?.[0]?.text || '')
    .trim()
    .replace(/^["“”]+|["“”]+$/g, '');
}

async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
