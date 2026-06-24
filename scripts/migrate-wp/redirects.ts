export function buildRedirects(items: { link: string; newPath: string }[]): string {
  const lines: string[] = [];
  for (const { link, newPath } of items) {
    let oldPath: string;
    try {
      oldPath = new URL(link).pathname;
    } catch {
      continue;
    }
    if (!oldPath.endsWith('/')) oldPath += '/';
    if (oldPath === newPath) continue;
    lines.push(`${oldPath}  ${newPath}  301`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
