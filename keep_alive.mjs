import { spawn } from 'child_process';

const caffeinate = spawn('caffeinate', ['-i'], { stdio: 'ignore' });

caffeinate.on('error', (err) => {
  console.error('caffeinate failed:', err.message);
});

console.log('Started. Printing every 60s. Press Ctrl+C to stop.');

setInterval(() => {
  console.log(1);
}, 60_000);

process.on('SIGINT', () => {
  caffeinate.kill();
  process.exit(0);
});
