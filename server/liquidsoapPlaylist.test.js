import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  annotateEscape,
  annotateRequest,
  buildRadioM3u,
  entryToRequest,
  remainingShowLog,
  toPosixPath,
  writeRadioM3u,
} from './liquidsoapPlaylist.js';

describe('liquidsoap annotated playlist', () => {
  it('escapes quotes and newlines in annotate values', () => {
    assert.equal(annotateEscape('Techno "3"\nfoo'), 'Techno \\"3\\" foo');
  });

  it('builds annotate: URI with metadata then POSIX path', () => {
    const uri = annotateRequest({ title: 'Funky House', liq_fade_out: '16.000' }, '/crate/house.mp3');
    assert.equal(
      uri,
      'annotate:title="Funky House",liq_fade_out="16.000":/crate/house.mp3',
    );
  });

  it('rewrites Windows drive paths so annotate colons stay unambiguous', () => {
    assert.equal(toPosixPath('C:\\crate\\a.mp3'), '/c/crate/a.mp3');
    assert.equal(toPosixPath('D:/crate/b.mp3'), '/d/crate/b.mp3');
    assert.equal(toPosixPath('/crate/a.mp3'), '/crate/a.mp3');
    const uri = annotateRequest({ title: 'A' }, 'C:\\crate\\a.mp3');
    assert.equal(uri, 'annotate:title="A":/c/crate/a.mp3');
  });

  it('cues out after planned play plus fade, clamped to file duration', () => {
    const req = entryToRequest(
      { plannedPlaySec: 60, fadeSec: 20, nextId: 'b' },
      { id: 'a', title: 'A', artist: 'X', path: '/crate/a.mp3', durationSec: 90 },
      { isFirst: true, fadeInSec: 0 },
    );
    assert.match(req, /liq_cue_out="80.000"/);
    assert.match(req, /liq_fade_in="0.000"/);
    assert.match(req, /liq_fade_out="20.000"/);
    assert.match(req, /liq_cross_duration="20.000"/);

    const clamped = entryToRequest(
      { plannedPlaySec: 80, fadeSec: 30, nextId: 'b' },
      { id: 'a', title: 'A', path: '/crate/a.mp3', durationSec: 100 },
      { isFirst: false, fadeInSec: 12 },
    );
    assert.match(clamped, /liq_cue_out="99.750"/);
    assert.match(clamped, /liq_fade_in="12.000"/);
  });

  it('chains fade-in of each track to the previous mind fade', () => {
    const m3u = buildRadioM3u(
      [
        { trackId: 'a', nextId: 'b', plannedPlaySec: 45, fadeSec: 16, absIndex: 0 },
        { trackId: 'b', nextId: 'c', plannedPlaySec: 50, fadeSec: 24, absIndex: 1 },
      ],
      {
        a: { id: 'a', title: 'Track A', path: '/crate/a.mp3', durationSec: 120 },
        b: { id: 'b', title: 'Track B', path: '/crate/b.mp3', durationSec: 120 },
      },
    );
    const lines = m3u.split('\n').filter((l) => l.startsWith('annotate:'));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /liq_fade_in="0.000"/);
    assert.match(lines[0], /liq_fade_out="16.000"/);
    assert.match(lines[1], /liq_fade_in="16.000"/);
    assert.match(lines[1], /liq_fade_out="24.000"/);
    assert.match(m3u, /^#EXTM3U/m);
  });

  it('keeps fade-in when building a remaining slice that is not the show start', () => {
    const m3u = buildRadioM3u(
      [{ trackId: 'b', nextId: 'c', plannedPlaySec: 50, fadeSec: 24, absIndex: 1 }],
      { b: { id: 'b', title: 'Track B', path: '/crate/b.mp3', durationSec: 120 } },
      { initialFadeInSec: 16 },
    );
    assert.match(m3u, /liq_fade_in="16.000"/);
    assert.match(m3u, /liq_fade_out="24.000"/);
  });

  it('drops finished (and optionally current) show-log rows', () => {
    const log = [
      { absIndex: 0, trackId: 'a', playStartSec: 0, leaveAtSec: 40, fadeSec: 10 },
      { absIndex: 1, trackId: 'b', playStartSec: 50, leaveAtSec: 90, fadeSec: 12 },
      { absIndex: 2, trackId: 'c', playStartSec: 102, leaveAtSec: 150, fadeSec: 8 },
    ];
    const allLive = remainingShowLog(log, 55, { includeCurrent: true });
    assert.deepEqual(
      allLive.map((e) => e.trackId),
      ['b', 'c'],
    );
    const future = remainingShowLog(log, 55, { includeCurrent: false });
    assert.deepEqual(
      future.map((e) => e.trackId),
      ['c'],
    );
  });

  it('writes radio.m3u creating parent dirs and updating in place', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drosophila-m3u-'));
    const file = path.join(dir, 'cache', 'radio.m3u');
    writeRadioM3u(file, '#EXTM3U\none\n');
    assert.equal(fs.readFileSync(file, 'utf8'), '#EXTM3U\none\n');
    const inode = fs.statSync(file).ino;
    writeRadioM3u(file, '#EXTM3U\ntwo\n');
    assert.equal(fs.readFileSync(file, 'utf8'), '#EXTM3U\ntwo\n');
    assert.equal(fs.statSync(file).ino, inode);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
