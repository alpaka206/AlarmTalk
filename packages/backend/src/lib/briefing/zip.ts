/**
 * ZIP 한 파일에서 항목 하나를 꺼내는 **작은** 리더 — OpenDART `corpCode.xml` 이 ZIP(안에 `CORPCODE.xml`)으로 온다.
 *
 * 라이브러리를 들이지 않는다: 필요한 것은 "중앙 디렉터리에서 이름으로 찾고, deflate 를 푼다" 뿐이고, 압축 해제는
 * 워커 내장 `DecompressionStream('deflate-raw')` 가 한다.
 *
 * - 크기·위치는 **중앙 디렉터리**에서 읽는다. 로컬 헤더의 크기는 데이터 기술자(플래그 비트 3)를 쓰면 0 이라 믿을 수
 *   없다 — 로컬 헤더에서는 이름·extra 길이만 읽어 데이터 시작점을 센다.
 * - 지원: 저장(0)·deflate(8). ZIP64·암호화는 거절한다(CORPCODE 는 수십 MB 라 ZIP64 가 필요 없다).
 * - ⚠ **풀린 크기에 상한을 둔다**(`maxBytes`) — 헤더가 말하는 크기도, 실제로 풀려 나오는 바이트도 센다. 압축 폭탄이
 *   워커 메모리(128MB)를 먹지 못하게.
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** EOCD 22바이트 + 주석 최대 65535. */
const EOCD_SEARCH_MAX = 22 + 0xffff;

export class ZipError extends Error {
  constructor(message: string) {
    super(`zip: ${message}`);
    this.name = 'ZipError';
  }
}

function u16(view: DataView, at: number): number {
  return view.getUint16(at, true);
}
function u32(view: DataView, at: number): number {
  return view.getUint32(at, true);
}

/** 바이트가 ZIP 로컬 헤더(`PK\x03\x04`)로 시작하는가. 원천이 ZIP 대신 오류 XML 을 줄 때 가른다. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

type CentralEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
};

function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - EOCD_SEARCH_MAX);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (u32(view, i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('끝 레코드(EOCD)가 없다');
  const count = u16(view, eocd + 10);
  const cdSize = u32(view, eocd + 12);
  const cdOffset = u32(view, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 는 읽지 않는다');
  if (cdOffset + cdSize > eocd) throw new ZipError('중앙 디렉터리가 파일 밖을 가리킨다');

  const decoder = new TextDecoder();
  const entries: CentralEntry[] = [];
  let at = cdOffset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(view, at) !== CEN_SIG) throw new ZipError('중앙 디렉터리 항목이 깨졌다');
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    entries.push({
      flags: u16(view, at + 8),
      method: u16(view, at + 10),
      compressedSize: u32(view, at + 20),
      uncompressedSize: u32(view, at + 24),
      localOffset: u32(view, at + 42),
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen)),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ZipError(`풀린 크기가 상한(${maxBytes})을 넘는다`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * `matches(이름)` 이 참인 첫 항목을 풀어 돌려준다. 없으면 `ZipError`.
 * 이름 비교는 부르는 쪽이 정한다(예: 대소문자 무시 `CORPCODE.xml`).
 */
export async function extractZipEntry(
  bytes: Uint8Array,
  matches: (name: string) => boolean,
  maxBytes: number,
): Promise<Uint8Array> {
  const entry = readCentralDirectory(bytes).find((e) => matches(e.name));
  if (!entry) throw new ZipError('찾는 항목이 없다');
  if (entry.flags & 0x1) throw new ZipError('암호화된 항목은 읽지 않는다');
  if (entry.uncompressedSize > maxBytes) throw new ZipError(`항목 크기가 상한(${maxBytes})을 넘는다`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const loc = entry.localOffset;
  if (loc + 30 > bytes.length || u32(view, loc) !== LOC_SIG) throw new ZipError('로컬 헤더가 깨졌다');
  const start = loc + 30 + u16(view, loc + 26) + u16(view, loc + 28);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError('데이터가 파일 밖으로 넘친다');
  const data = bytes.subarray(start, end);

  if (entry.method === 0) {
    if (data.byteLength > maxBytes) throw new ZipError(`항목 크기가 상한(${maxBytes})을 넘는다`);
    return data.slice();
  }
  if (entry.method === 8) return inflateRaw(data, maxBytes);
  throw new ZipError(`압축 방식 ${entry.method} 은 읽지 않는다`);
}
