/* preload script for renderer process */
// const { contextBridge } = require("electron");
/*
contextBridge.exposeInMainWorld(
  "openParams",
  JSON.parse(process.argv[process.argv.length - 1])
);
*/
// Note: The openParams were appended to process.argv via
// the webPreferences.additionalArguments passed to BrowserWindow
// constructor.
const argPrefixToad = '--toadOpenParams=';
const argPrefixTad = '--tadOpenParams=';
let foundToadParams = false;

for (let i = 0; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith(argPrefixToad)) {
    const openParamsStr = arg.slice(argPrefixToad.length);
    window.openParams = JSON.parse(openParamsStr);
    foundToadParams = true;
    break;
  }
}

if (!foundToadParams) {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith(argPrefixTad)) {
      const openParamsStr = arg.slice(argPrefixTad.length);
      window.openParams = JSON.parse(openParamsStr);
      break;
    }
  }
}
