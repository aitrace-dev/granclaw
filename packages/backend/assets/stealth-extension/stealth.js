// GranClaw Stealth — runs at document_start in the page's MAIN world.
//
// Evasions adapted from puppeteer-extra-plugin-stealth (MIT, Berstend et al.),
// the de-facto open-source collection of browser-automation fingerprint patches.
// Each block targets one specific detection vector; keep them independent so
// a failure in one cannot cascade and leak detection through the others.

(() => {
  'use strict';

  // Helper that swallows per-evasion errors so a single broken patch never
  // leaves the page half-protected.
  const safe = (fn) => { try { fn(); } catch (_) { /* evasion failed, keep going */ } };

  // ── 1. navigator.webdriver ─────────────────────────────────────────────
  // The single biggest giveaway — Playwright/CDP sets this to true.
  // Deleting the property (not just setting it to false) matches the shape
  // of a real Chrome build, where the prop is absent from the prototype.
  safe(() => {
    if (navigator.webdriver === false) {
      delete Object.getPrototypeOf(navigator).webdriver;
    } else {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    }
  });

  // ── 2. navigator.languages ─────────────────────────────────────────────
  // Headless Chrome historically returned an empty array. Real users have
  // at least one preferred language.
  safe(() => {
    Object.defineProperty(Navigator.prototype, 'languages', {
      get: () => ['en-US', 'en'],
      configurable: true,
    });
  });

  // ── 3. navigator.plugins + mimeTypes ──────────────────────────────────
  // Headless Chrome has an empty plugins array; real Chrome exposes the
  // built-in PDF viewer plugin. The fake must be shaped like a real
  // PluginArray with .length, indexed access, and namedItem().
  safe(() => {
    const makePlugin = (name, filename, description) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name:        { value: name,        enumerable: true },
        filename:    { value: filename,    enumerable: true },
        description: { value: description, enumerable: true },
        length:      { value: 1,           enumerable: true },
      });
      return plugin;
    };
    const plugins = [
      makePlugin('PDF Viewer',              'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chrome PDF Viewer',       'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Chromium PDF Viewer',     'internal-pdf-viewer', 'Portable Document Format'),
      makePlugin('Microsoft Edge PDF Viewer','internal-pdf-viewer','Portable Document Format'),
      makePlugin('WebKit built-in PDF',     'internal-pdf-viewer', 'Portable Document Format'),
    ];
    const pluginArray = Object.create(PluginArray.prototype);
    plugins.forEach((p, i) => { pluginArray[i] = p; });
    Object.defineProperties(pluginArray, {
      length:    { value: plugins.length, enumerable: true },
      item:      { value: (i) => plugins[i] || null },
      namedItem: { value: (n) => plugins.find((p) => p.name === n) || null },
      refresh:   { value: () => undefined },
    });
    Object.defineProperty(Navigator.prototype, 'plugins', {
      get: () => pluginArray,
      configurable: true,
    });
  });

  // ── 4. navigator.permissions.query ─────────────────────────────────────
  // Headless Chrome returns 'denied' for the Notification permission even
  // when Notification.permission is 'default'. Real Chrome keeps the two
  // in sync. Detectors query both and compare.
  safe(() => {
    const originalQuery = navigator.permissions && navigator.permissions.query;
    if (!originalQuery) return;
    navigator.permissions.query = (parameters) => {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({
          state: typeof Notification !== 'undefined' ? Notification.permission : 'prompt',
          onchange: null,
        });
      }
      return originalQuery.call(navigator.permissions, parameters);
    };
  });

  // ── 5. window.chrome — runtime / app / csi / loadTimes ────────────────
  // Automation chromium builds have `window.chrome` but an empty shape.
  // Real user Chrome exposes chrome.runtime, chrome.app, chrome.csi(),
  // chrome.loadTimes() (deprecated but still present).
  safe(() => {
    if (typeof window.chrome === 'undefined') {
      Object.defineProperty(window, 'chrome', { value: {}, writable: true, configurable: true });
    }
    const chrome = window.chrome;

    if (!chrome.runtime) {
      chrome.runtime = {
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch:    { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch:{ ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs:      { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect:     () => ({ disconnect: () => undefined, onMessage: { addListener: () => undefined } }),
        sendMessage: () => undefined,
        id: undefined,
      };
    }

    if (!chrome.app) {
      chrome.app = {
        InstallState:  { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState:  { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails:    () => null,
        getIsInstalled:() => false,
        isInstalled:   false,
      };
    }

    if (!chrome.csi) {
      chrome.csi = () => ({
        onloadT:      Date.now(),
        pageT:        performance && performance.now ? performance.now() : 0,
        startE:       Date.now(),
        tran:         15,
      });
    }

    if (!chrome.loadTimes) {
      chrome.loadTimes = () => ({
        commitLoadTime:                  Date.now() / 1000,
        connectionInfo:                  'h2',
        finishDocumentLoadTime:          Date.now() / 1000,
        finishLoadTime:                  Date.now() / 1000,
        firstPaintAfterLoadTime:         0,
        firstPaintTime:                  Date.now() / 1000,
        navigationType:                  'Other',
        npnNegotiatedProtocol:           'h2',
        requestTime:                     Date.now() / 1000,
        startLoadTime:                   Date.now() / 1000,
        wasAlternateProtocolAvailable:   false,
        wasFetchedViaSpdy:               true,
        wasNpnNegotiated:                true,
      });
    }
  });

  // ── 6. WebGL vendor + renderer ─────────────────────────────────────────
  // Headless Chrome falls back to SwiftShader / Google SwiftShader. Real
  // users return a hardware GPU string. We spoof Intel Iris which is common
  // enough to blend in.
  safe(() => {
    const patch = (proto) => {
      if (!proto) return;
      const original = proto.getParameter;
      proto.getParameter = function (parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) return 'Intel Inc.';
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return original.call(this, parameter);
      };
    };
    if (typeof WebGLRenderingContext !== 'undefined')  patch(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patch(WebGL2RenderingContext.prototype);
  });

  // ── 7. navigator.hardwareConcurrency ──────────────────────────────────
  // Some headless builds report 1. Real machines usually report 4+.
  safe(() => {
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true,
    });
  });

  // ── 8. iframe.contentWindow prototype ─────────────────────────────────
  // Some detectors check that an <iframe>'s contentWindow inherits from
  // Window and that Window.chrome matches the parent. Sandboxed iframes in
  // automation builds leak a different prototype chain. Re-running this
  // script in all_frames mode (see manifest) plus the patch below covers it.
  safe(() => {
    if (typeof HTMLIFrameElement === 'undefined') return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (!descriptor || typeof descriptor.get !== 'function') return;
    const originalGetter = descriptor.get;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function () {
        const win = originalGetter.call(this);
        if (win && win.chrome === undefined && window.chrome !== undefined) {
          try { win.chrome = window.chrome; } catch (_) { /* cross-origin, skip */ }
        }
        return win;
      },
    });
  });

  // ── 9. Error.stack source cleanup ──────────────────────────────────────
  // Automation tools sometimes surface "puppeteer_evaluation_script" or
  // similar sentinel strings in error stacks. We don't inject those here,
  // but scrub anyway in case agent-browser's CDP layer adds them.
  safe(() => {
    const originalPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = function (error, stack) {
      const result = originalPrepareStackTrace
        ? originalPrepareStackTrace.call(this, error, stack)
        : error.stack;
      if (typeof result !== 'string') return result;
      return result.replace(/at .*puppeteer_evaluation_script.*\n?/g, '');
    };
  });
})();
