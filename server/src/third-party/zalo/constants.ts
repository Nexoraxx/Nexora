// Zalo PC's getClientType: macOS 23, Windows 24, Linux 25. The Linux client was never released and Zalo's E2EE server
// answers its GET_BUNDLE with 112, so on Linux this client is Zalo PC for macOS.
export const API_TYPE = process.platform === 'win32' ? 24 : 23
export const API_VERSION = 694
// Zalo PC's user agent (ZaloPC-<process.platform>-<type>v<version>), naming the platform API_TYPE claims
export const USER_AGENT = `ZaloPC-${process.platform === 'win32' ? 'win32' : 'darwin'}-${API_TYPE}v${API_VERSION}`
