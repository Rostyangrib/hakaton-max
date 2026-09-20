interface MaxWebAppBridge {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
}

interface Window {
  WebApp?: MaxWebAppBridge;
}
