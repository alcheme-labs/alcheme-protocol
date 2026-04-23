import { resolveLanServerUrl } from '../config/mobileShellConfig.mjs';

process.stdout.write(`${resolveLanServerUrl()}\n`);
