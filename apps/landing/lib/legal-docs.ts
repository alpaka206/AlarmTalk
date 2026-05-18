import fs from "node:fs";
import path from "node:path";

const filenames = {
  privacy: "privacy-policy.ko.md",
  terms: "terms-of-service.ko.md",
} as const;

export type LegalDoc = keyof typeof filenames;

function getLegalDocsDir() {
  const fromRepoRoot = path.resolve(process.cwd(), "docs/legal");
  if (fs.existsSync(fromRepoRoot)) return fromRepoRoot;

  return path.resolve(process.cwd(), "../../docs/legal");
}

export function readLegalDoc(doc: LegalDoc) {
  return fs.readFileSync(path.join(getLegalDocsDir(), filenames[doc]), "utf8");
}
