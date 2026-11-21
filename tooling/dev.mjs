import { spawn, spawnSync } from 'node:child_process';

// compile once before the server starts so a first request gets the runtime
const initial = spawnSync('npm', ['run', 'build:desktop'], { stdio: 'inherit' });
if(initial.status !== 0)process.exit(initial.status ?? 1);

const processes = [
	spawn('node', ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.desktop.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
	spawn('node', ['node_modules/astro/bin/astro.mjs', 'dev', '--host', ...process.argv.slice(2)], { stdio: 'inherit' }),
];

let closing = false;
const shutdown = (code = 0) => {
	if(closing)return;
	closing = true;
	for(const child of processes)if(child.exitCode === null)child.kill();
	process.exitCode = code;
};

for(const signal of ['SIGINT', 'SIGTERM'])process.on(signal, () => shutdown());
for(const child of processes)child.on('exit', code => shutdown(code ?? 1));
