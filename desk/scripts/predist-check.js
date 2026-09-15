#!/usr/bin/env node
// Fails fast when a build output is locked, instead of letting electron-builder wait silently.
// A Paddock launched from dist/ holds its own exe open; electron-builder then hangs with no
// output until killed (a live build sat for over 30 minutes this way). Better to stop at once
// and say why.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const dist = path.resolve(__dirname, '..', 'dist');
const targets = [
  path.join(dist, `${pkg.productName}-${pkg.version}-portable.exe`),
  path.join(dist, 'win-unpacked', `${pkg.productName}.exe`),
];

const locked = targets.filter((file) => {
  if (!fs.existsSync(file)) return false;
  try {
    fs.closeSync(fs.openSync(file, 'r+'));
    return false;
  } catch (err) {
    return err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
  }
});

if (locked.length) {
  console.error('predist-check: these build outputs are in use, so electron-builder would hang:');
  for (const file of locked) console.error(`  ${path.relative(process.cwd(), file)}`);
  console.error('Close the running Paddock (or bump "version" in package.json for a new file name), then retry.');
  process.exit(1);
}
console.log('predist-check: build outputs are free');
