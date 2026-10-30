const PLATFORM =
  process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
  : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7'
  : 'X11; Linux x86_64'

export const USER_AGENT = `Mozilla/5.0 (${PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Zalo/26.10.20 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36`
// Zalo PC (Windows). 25 is PC's LINUX_CLIENT_TYPE, never released: Zalo answers its E2EE GET_BUNDLE with 112
export const API_TYPE = 24
export const API_VERSION = 694