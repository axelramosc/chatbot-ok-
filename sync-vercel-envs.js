const fs = require('fs');
const { execSync } = require('child_process');

const envFile = fs.readFileSync('.env.local', 'utf8');
const envLines = envFile.split('\n');

for (const line of envLines) {
  if (line.trim() === '' || line.startsWith('#')) continue;
  
  const separatorIndex = line.indexOf('=');
  if (separatorIndex === -1) continue;

  const key = line.substring(0, separatorIndex).trim();
  const value = line.substring(separatorIndex + 1).trim();

  console.log(`Adding ${key}...`);
  try {
    // Some variables might already exist, --force might be needed, but we'll try without first or remove first
    try {
        execSync(`npx vercel env rm ${key} --yes`, { stdio: 'ignore' });
    } catch(e) {} // ignore if it doesn't exist
    
    execSync(`npx vercel env add ${key} production --value "${value}" --yes`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Failed to add ${key}`);
  }
}
