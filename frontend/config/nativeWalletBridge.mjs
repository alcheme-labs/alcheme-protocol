export const NATIVE_WALLET_BRIDGE_NAME = 'AlchemeNativeBridge';
export const NATIVE_WALLET_IOS_MESSAGE_HANDLER = 'alchemeNativeBridge';
export const NATIVE_WALLET_CALLBACK_EVENT_NAME = 'alcheme:native-wallet-callback';
export const NATIVE_WALLET_URL_SCHEME = 'alcheme';
export const NATIVE_WALLET_CALLBACK_HOST = 'wallet';
export const NATIVE_WALLET_CALLBACK_PATH = '/callback';
export const NATIVE_WALLET_CALLBACK_URL = `${NATIVE_WALLET_URL_SCHEME}://${NATIVE_WALLET_CALLBACK_HOST}${NATIVE_WALLET_CALLBACK_PATH}`;

export function isNativeWalletCallbackUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === `${NATIVE_WALLET_URL_SCHEME}:`
      && url.hostname === NATIVE_WALLET_CALLBACK_HOST
      && url.pathname.startsWith(NATIVE_WALLET_CALLBACK_PATH)
    );
  } catch {
    return false;
  }
}
