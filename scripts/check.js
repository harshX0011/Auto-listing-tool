#!/usr/bin/env node
/*
 * Static checks: manifest references resolve, every script parses, and the
 * content-script load order satisfies each file's MSA dependencies.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const problems = [];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const referenced = new Set();
const add = (p) => p && referenced.add(p);
add(manifest.background && manifest.background.service_worker);
add(manifest.action && manifest.action.default_popup);
add(manifest.options_ui && manifest.options_ui.page);
for (const cs of manifest.content_scripts || []) (cs.js || []).forEach(add);

for (const rel of referenced) {
  if (!fs.existsSync(path.join(root, rel))) problems.push(`manifest references missing file: ${rel}`);
}

// HTML pages: referenced scripts and styles must exist.
for (const rel of referenced) {
  if (!rel.endsWith('.html')) continue;
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = path.join(root, path.dirname(rel), m[1]);
    if (!fs.existsSync(target)) problems.push(`${rel} references missing ${m[1]}`);
  }
}

// Syntax check every JS file under src/.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
for (const file of walk(path.join(root, 'src')).filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    problems.push(`syntax error in ${path.relative(root, file)}:\n${e.stderr}`);
  }
}

// Load order: a file using root.MSA.x must come after the file defining x.
const isolated = (manifest.content_scripts || []).find((cs) => cs.world !== 'MAIN');
const defined = new Set();
for (const rel of isolated.js) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const m of src.matchAll(/root\.MSA\.(\w+)/g)) {
    if (!defined.has(m[1])) problems.push(`${rel} uses MSA.${m[1]} before it is loaded`);
  }
  const destructured = src.match(/const \{([^}]+)\} = root\.MSA/);
  if (destructured) {
    for (const name of destructured[1].split(',').map((s) => s.trim())) {
      if (!defined.has(name)) problems.push(`${rel} uses MSA.${name} before it is loaded`);
    }
  }
  for (const m of src.matchAll(/\(root\.MSA = root\.MSA \|\| \{\}\)\.(\w+) =/g)) defined.add(m[1]);
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok: ${referenced.size} manifest entries, load order verified`);
