import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',
  timeout:45000,
  expect:{timeout:10000},
  retries:process.env.CI ? 1 : 0,
  workers:process.env.CI ? 2 : undefined,
  // Keep routed fixtures deterministic. The offline suite opts into real workers.
  use:{baseURL:'http://127.0.0.1:41828',trace:'retain-on-failure',serviceWorkers:'block'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'phone',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
  // CI prepares the production dist through npm run validate before this command.
  webServer:{command:'npm run preview -- --host 127.0.0.1 --port 41828 --strictPort',url:'http://127.0.0.1:41828',reuseExistingServer:false,timeout:60000},
});
