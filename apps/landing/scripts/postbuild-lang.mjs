// 정적 export(output: "export")는 모든 로케일의 HTML을 루트 레이아웃의 하드코딩된
// <html lang="ko"> 로 내보낸다. 이 postbuild 단계에서 로케일별로 lang 속성을 고쳐
// out/en/** → lang="en", out/ja/** → lang="ja" 로 바꾼다(ko/루트는 그대로 유지).
// WCAG 3.1.1(페이지 언어) 준수를 위한 산출물 후처리이며 외부 의존성 없이 fs만 사용한다.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(scriptDir, "..", "out");

// out/<로케일>/ 첫 세그먼트로 로케일을 판별한다. ko(루트/out/ko)는 대상이 아니다.
const LOCALE_DIRS = { en: "en", ja: "ja" };

function localeForFile(filePath) {
  const [first] = path.relative(outDir, filePath).split(path.sep);
  return LOCALE_DIRS[first] ?? null;
}

let changed = 0;

function rewriteLang(filePath) {
  const locale = localeForFile(filePath);
  if (!locale) return;

  const html = readFileSync(filePath, "utf8");
  const next = html.replace('<html lang="ko"', `<html lang="${locale}"`);
  if (next !== html) {
    writeFileSync(filePath, next);
    changed += 1;
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (full.endsWith(".html")) {
      rewriteLang(full);
    }
  }
}

if (!existsSync(outDir)) {
  console.error(`[postbuild-lang] out 디렉터리를 찾을 수 없습니다: ${outDir}`);
  process.exit(1);
}

walk(outDir);
console.log(`[postbuild-lang] ${changed}개 HTML 파일의 lang 속성을 로케일별로 설정했습니다.`);
