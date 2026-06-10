// 개인정보처리방침·이용약관 본문을 저장소의 docs/legal 마크다운에서 읽어온다.
// 법무 문구의 단일 출처를 docs/legal 로 유지하고 랜딩은 빌드 시 이를 렌더한다.
import fs from "node:fs";
import path from "node:path";

const filenames = {
  privacy: "privacy-policy.ko.md",
  terms: "terms-of-service.ko.md",
} as const;

export type LegalDoc = keyof typeof filenames;

// 빌드 실행 위치가 저장소 루트(monorepo 빌드)일 수도, apps/landing(개별 빌드)일
// 수도 있어 두 기준 경로를 차례로 시도한다.
function getLegalDocsDir() {
  const fromRepoRoot = path.resolve(process.cwd(), "docs/legal");
  if (fs.existsSync(fromRepoRoot)) return fromRepoRoot;

  return path.resolve(process.cwd(), "../../docs/legal");
}

export function readLegalDoc(doc: LegalDoc) {
  return fs.readFileSync(path.join(getLegalDocsDir(), filenames[doc]), "utf8");
}
