import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tacticafc.manager',
  appName: 'TACTICA FC',
  webDir: 'dist/tactica-manager',
  server: {
    cleartext: true,
    allowNavigation: ['127.0.0.1', 'localhost'],
  },
};

export default config;
