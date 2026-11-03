const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const version = process.argv[2] || '2.4.1';
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
    body += `\n\n### 🛡️ Checksums & Integrity\n\`\`\`\n${checksums}\n\`\`\``;
  }

  const releaseTitle = `Toad v${version} - Tabular OLAP Analytics Desktop (Full Rebrand & Feature Release)`;

  // 1. Check if release already exists
  let releaseId = null;
  const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/v${version}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Toad-Release-Script'
    }
  });

  if (checkRes.ok) {
    const existingRelease = await checkRes.json();
    releaseId = existingRelease.id;
    console.log(`Release already exists with ID: ${releaseId}. Updating release notes...`);
    await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Toad-Release-Script'
      },
      body: JSON.stringify({
        name: releaseTitle,
        body: body
      })
    });
  } else {
    // Create new release
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
        name: releaseTitle,
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
    releaseId = releaseData.id;
    console.log(`Release created successfully! ID: ${releaseId}`);
  }

  // 2. Query existing assets for this release
  const assetsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Toad-Release-Script'
    }
  });
  const existingAssets = assetsRes.ok ? await assetsRes.json() : [];

  // 3. Upload Assets
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

    // Delete if already uploaded
    const match = existingAssets.find(a => a.name === asset.name);
    if (match) {
      console.log(`Deleting previous upload of ${asset.name} (ID: ${match.id})...`);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${match.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Toad-Release-Script'
        }
      });
    }

    const sizeMb = (fs.statSync(asset.path).size / 1024 / 1024).toFixed(2);
    console.log(`Uploading ${asset.name} (${sizeMb} MB) via curl.exe...`);
    const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`;
    
    // Use curl.exe with timeout, progress, and retry
    const curlCmd = `curl.exe -sS -L --retry 3 --connect-timeout 30 -X POST -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github.v3+json" -H "Content-Type: ${asset.mime}" --data-binary @"${asset.path}" "${uploadUrl}"`;
    try {
      const output = execSync(curlCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      const parsed = JSON.parse(output);
      if (parsed.state === 'uploaded' || parsed.id) {
        console.log(`Uploaded ${asset.name} successfully! (Asset ID: ${parsed.id})`);
      } else {
        console.warn(`Upload output for ${asset.name}:`, output);
      }
    } catch (curlErr) {
      console.error(`Curl upload error for ${asset.name}:`, curlErr.message);
      throw curlErr;
    }
  }

  console.log(`\n======================================================================`);
  console.log(`Release v${version} fully published!`);
  console.log(`URL: https://github.com/${owner}/${repo}/releases/tag/v${version}`);
  console.log(`======================================================================\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
