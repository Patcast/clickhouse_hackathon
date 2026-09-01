import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const token = process.env.PROFESSOR_MCP_TOKEN?.trim();
if (!token || token.length < 32 || /\s/.test(token)) {
  throw new Error('PROFESSOR_MCP_TOKEN must be a non-whitespace token of at least 32 characters');
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = path.join(repoRoot, '.vercel');
const outputPath = path.join(privateDir, 'little-alexandria-access.txt');
const temporaryPath = `${outputPath}.${process.pid}.tmp`;

const body = [
  'Little Alexandria — private Vercel production access',
  `Generated: ${new Date().toISOString()}`,
  '',
  'Student app (public):',
  'https://little-alexandria-student.vercel.app/',
  '',
  'Professor app (share this complete link privately):',
  `https://little-alexandria-professor.vercel.app/#access_token=${token}`,
  '',
  'Analytics MCP:',
  'https://little-alexandria-mcp.vercel.app/mcp',
  '',
  'MCP request header:',
  `Authorization: Bearer ${token}`,
  '',
  'This file is local, git-ignored, and not a durable secret backup.',
  'Keep the authoritative token in the team password manager.',
  '',
].join('\n');

fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
try {
  fs.writeFileSync(temporaryPath, body, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporaryPath, outputPath);
  fs.chmodSync(outputPath, 0o600);
} finally {
  fs.rmSync(temporaryPath, { force: true });
}

console.log(`Wrote private access handoff: ${outputPath}`);
