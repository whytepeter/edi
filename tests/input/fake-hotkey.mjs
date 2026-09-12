// Stand-in for native/hotkey/build/edi-hotkey. The key code argument picks a script.
const [keyCode, modifiers] = process.argv.slice(2);
const say = line => process.stdout.write(`${line}\n`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

if (modifiers !== '2048') {
  say('error usage');
  process.exit(64);
}
if (keyCode === '1') {
  // A normal hold with key repeat, then stay alive until stdin closes.
  say('ready');
  await wait(20);
  say('down');
  say('down');
  say('down');
  await wait(20);
  say('up');
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
} else if (keyCode === '2') {
  say('error -9878');
  process.exit(1);
} else if (keyCode === '3') {
  // Crash while the key is held.
  say('ready');
  await wait(20);
  say('down');
  await wait(20);
  process.exit(1);
}
