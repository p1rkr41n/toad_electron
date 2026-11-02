const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const version = process.argv[2] || '2.3.4';
const owner = 'p1rkr41n';
const repo = 'toad_electron';

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
    const match = remoteUrl.match(/https:\/\/([^:@]+)@github\.com/);
    if (match && match[1]) {
      return match[1];
    }
  } catch {}
  throw new Error('GITHUB_TOKEN not found in environment or git remote URL.');
}

async function main() {
  console.log(`Publishing release v${version}...`);
  const token = getGitHubToken();

  const notesPath = path.resolve('releases', `v${version}_NOTES.md`);
  const checksumPath = path.resolve('releases', 'SHA256SUMS.txt');

  let body = '';
  if (fs.existsSync(notesPath)) {
    body = fs.readFileSync(notesPath, 'utf8');
  } else {
    body = `Toad v${version} Release`;
  }

  if (fs.existsSync(checksumPath)) {
    const checksums = fs.readFileSync(checksumPath, 'utf8');
    body += `\n\n### 📦 Checksums & Integrity\n\`\`\`\n${checksums}\n\`\`\``;
  }

  // 1. Create Release
  const releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Toad-Release-Script'
    },
    body: JSON.stringify({
      tag_name: `v${version}`,
      name: `Toad v${version} - ASAR Sealing & Zero-Crash Resilience Release`,
      body: body,
      draft: false,
      prerelease: false
    })
  });

  if (!releaseRes.ok) {
    const errText = await releaseRes.text();
    throw new Error(`Failed to create release: ${releaseRes.status} ${errText}`);
  }

  const releaseData = await releaseRes.json();
  const releaseId = releaseData.id;
  console.log(`Release created successfully! ID: ${releaseId}`);

  // 2. Upload Assets
  const assets = [
    { name: `Toad-${version}-x64-portable.exe`, path: path.resolve('releases', `Toad-${version}-x64-portable.exe`), mime: 'application/vnd.microsoft.portable-executable' },
    { name: `Toad-${version}-x64-portable.zip`, path: path.resolve('releases', `Toad-${version}-x64-portable.zip`), mime: 'application/zip' },
    { name: 'SHA256SUMS.txt', path: path.resolve('releases', 'SHA256SUMS.txt'), mime: 'text/plain' }
  ];

  for (const asset of assets) {
    if (!fs.existsSync(asset.path)) {
      console.warn(`Warning: Asset ${asset.path} does not exist, skipping.`);
      continue;
    }
    console.log(`Uploading ${asset.name} (${(fs.statSync(asset.path).size / 1024 / 1024).toFixed(2)} MB)...`);
    const fileBuffer = fs.readFileSync(asset.path);
    const uploadRes = await fetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': asset.mime,
        'Content-Length': fileBuffer.length.toString(),
        'User-Agent': 'Toad-Release-Script'
      },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error(`Failed to upload ${asset.name}: ${uploadRes.status} ${errText}`);
    } else {
      console.log(`Uploaded ${asset.name} successfully.`);
    }
  }

  console.log(`Release v${version} fully published: https://github.com/${owner}/${repo}/releases/tag/v${version}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

