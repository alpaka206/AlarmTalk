// 테스트용 ZIP 만들기 — OpenDART `corpCode.xml` 이 주는 ZIP 모양을 네트워크 없이 재현한다.
// 실제 파일과 같은 갈래(deflate·저장, 데이터 기술자로 로컬 헤더 크기가 0 인 경우)를 고를 수 있다.
import { crc32, deflateRawSync } from 'node:zlib';

export type ZipEntryInput = {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  /** 플래그 비트 3 — 로컬 헤더의 크기·CRC 를 0 으로 두고 데이터 뒤 기술자에 적는다. */
  dataDescriptor?: boolean;
};

export function makeZip(entries: ZipEntryInput[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const raw = Buffer.from(entry.data);
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const flags = entry.dataDescriptor ? 0x0008 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : body.length, 18);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const parts = [local, name, body];
    if (entry.dataDescriptor) {
      const desc = Buffer.alloc(16);
      desc.writeUInt32LE(0x08074b50, 0);
      desc.writeUInt32LE(crc, 4);
      desc.writeUInt32LE(body.length, 8);
      desc.writeUInt32LE(raw.length, 12);
      parts.push(desc);
    }
    const localAll = Buffer.concat(parts);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));

    locals.push(localAll);
    offset += localAll.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}
