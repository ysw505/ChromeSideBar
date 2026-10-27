// =============================================================================
// Side panel toggle (keyboard command)
// =============================================================================
//
// Chrome's reserved `_execute_side_panel` command only opens the panel and never
// reaches chrome.commands.onCommand, so a toggle has to be built by hand.
//
// Constraint: chrome.sidePanel.open() "may only be called in response to a user
// gesture", and awaiting almost anything before it drops that gesture. So the
// background must already know, synchronously, (a) which window is focused and
// (b) whether that window's panel is open:
//
//   main.tsx       - connectSidePanelPort(): each panel document opens a long-lived
//                    port to the background and reports its windowId. The port
//                    disappearing means the panel closed.
//   background.ts  - SidePanelRegistry tracks those ports plus the last focused
//                    window. toggle() then either posts "close" on the port or
//                    calls sidePanel.open() with no await in front of it.

export const TOGGLE_SIDE_PANEL_COMMAND = 'toggle-side-panel';
const PORT_NAME = 'side-panel';

interface PanelHelloMessage
{
  action: 'hello';
  windowId: number;
}

interface PanelCloseMessage
{
  action: 'close';
}

// -----------------------------------------------------------------------------
// Side panel side
// -----------------------------------------------------------------------------

/** Keep a port open to the background for as long as this panel document lives. */
export function connectSidePanelPort(): void
{
  chrome.windows.getCurrent((win) =>
  {
    if (win.id === undefined) return;
    const windowId = win.id;

    const connect = () =>
    {
      const port = chrome.runtime.connect({ name: PORT_NAME });
      const hello: PanelHelloMessage = { action: 'hello', windowId };
      port.postMessage(hello);
      port.onMessage.addListener((message: PanelCloseMessage) =>
      {
        if (message?.action === 'close')
        {
          window.close();
        }
      });
      // The service worker was restarted (or idled out): reconnect so the new
      // worker instance learns about this panel again.
      port.onDisconnect.addListener(() => setTimeout(connect, 200));
    };
    connect();
  });
}

// -----------------------------------------------------------------------------
// Background side
// -----------------------------------------------------------------------------

/** Knows which windows currently show our side panel, and which window has focus. */
export class SidePanelRegistry
{
  private readonly portsByWindow = new Map<number, chrome.runtime.Port>();
  private lastFocusedWindowId: number | undefined;

  /** Register listeners. Must run at service-worker top level so they survive restarts. */
  install(): void
  {
    chrome.runtime.onConnect.addListener((port) =>
    {
      if (port.name !== PORT_NAME) return;
      port.onMessage.addListener((message: PanelHelloMessage) =>
      {
        if (message?.action !== 'hello') return;
        this.portsByWindow.set(message.windowId, port);
        port.onDisconnect.addListener(() =>
        {
          // Only forget the port if it is still the one registered for this window
          if (this.portsByWindow.get(message.windowId) === port)
          {
            this.portsByWindow.delete(message.windowId);
          }
        });
      });
    });

    chrome.windows.onFocusChanged.addListener((windowId) =>
    {
      if (windowId !== chrome.windows.WINDOW_ID_NONE)
      {
        this.lastFocusedWindowId = windowId;
      }
    });

    // Seed the focused window right away so even the first toggle after a
    // worker (re)start needs no await before sidePanel.open()
    chrome.windows.getLastFocused((win) =>
    {
      if (win?.id !== undefined && this.lastFocusedWindowId === undefined)
      {
        this.lastFocusedWindowId = win.id;
      }
    });
  }

  /** Close the focused window's panel if open, otherwise open it. */
  async toggle(): Promise<void>
  {
    // Fall back to a query only when the worker has not seen a focus change yet
    // (fresh start). One chrome API await usually keeps the gesture; zero always does.
    let windowId = this.lastFocusedWindowId;
    if (windowId === undefined)
    {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) return;
      windowId = tab.windowId;
      this.lastFocusedWindowId = windowId;
    }

    const port = this.portsByWindow.get(windowId);
    if (port)
    {
      const close: PanelCloseMessage = { action: 'close' };
      port.postMessage(close);
      return;
    }
    await chrome.sidePanel.open({ windowId });
  }
}
