import type { CapacitorConfig } from '@capacitor/cli';
import { getCapacitorServerConfig } from '../frontend/config/mobileShellConfig.mjs';

const server = getCapacitorServerConfig(process.env.ALCHEME_MOBILE_SERVER_URL);

const config: CapacitorConfig = {
  appId: 'xyz.alcheme.mobile',
  appName: 'Alcheme',
  webDir: 'www',
  server: {
    ...server,
    allowNavigation: [new URL(server.url).hostname],
  },
};

export default config;
