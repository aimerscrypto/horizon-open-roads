// Publishes dist/ to the gh-pages branch of the origin remote.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
if (!fs.existsSync('dist/index.html')) throw new Error('Run "npm run build" first.');
const remote = execSync('git remote get-url origin').toString().trim();
fs.rmSync('dist/.git', { recursive: true, force: true });
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git commit -q -m "Deploy"', 'dist');
run(`git push -f "${remote}" gh-pages`, 'dist');
fs.rmSync('dist/.git', { recursive: true, force: true });
console.log('Deployed to gh-pages.');
