import manifest from './manifest.json';

export function attributionLines() {
  const lines = [];
  const files = (manifest.tracks || []).filter((t) => !t.slot && t.source === 'file' && t.file);
  for (const t of files) {
    const lic = t.license || 'CC0';
    const url = t.attributionUrl ? ` · ${t.attributionUrl}` : '';
    lines.push(`${t.title} — ${t.artist} (${lic})${url}`);
  }
  if (!lines.length) lines.push('CC0 crate · see LICENSES.md');
  return lines;
}
