#!/usr/bin/env node
/**
 * setup.js — Run this ONCE to download PDF.js into the extension.
 * Usage: node setup.js
 * Requires Node.js (any version with https module, no npm needed)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const files = [
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    dest: 'pdf.min.js'
  },
  {
    url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    dest: 'pdf.worker.min.js'
  }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(path.join(__dirname, dest));
    console.log(`Downloading ${dest}...`);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(path.join(__dirname, dest));
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const size = fs.statSync(path.join(__dirname, dest)).size;
        console.log(`  ✓ ${dest} (${(size / 1024).toFixed(1)} KB)`);
        resolve();
      });
    }).on('error', err => {
      fs.unlink(path.join(__dirname, dest), () => {});
      reject(err);
    });
  });
}

(async () => {
  console.log('Browsign — Setup\n');
  try {
    for (const f of files) await download(f.url, f.dest);
    console.log('\n✅ Setup complete! Load the extension in Chrome:\n');
    console.log('   1. Go to chrome://extensions/');
    console.log('   2. Enable Developer Mode');
    console.log('   3. Click "Load unpacked" and select this folder\n');
  } catch (e) {
    console.error('Error:', e.message);
    console.log('\nManual download instructions:');
    files.forEach(f => console.log(`  ${f.url}\n  → save as: ${f.dest}`));
  }
})();
