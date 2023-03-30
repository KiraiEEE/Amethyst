// import { ElectronEventManager } from "@/electronEventManager";
// import { CPUUsageMonitor } from "@/logic/CPUUsageMonitor";
import { player } from "@/logic/player";
// import { Track } from "@/logic/track";
import { MediaSession } from "@/mediaSession";
import { Shortcuts } from "@/shortcuts";
import { Store } from "@/state";
// import { watch } from "vue";
import { Capacitor } from "@capacitor/core";
import { StatusBar } from "@capacitor/status-bar";
import { ALLOWED_AUDIO_EXTENSIONS } from "@shared/constants";
import { IMetadata } from "@shared/types";
import { FileFilter, OpenDialogReturnValue } from "electron";
import { getThemeColorHex } from "./logic/color";
import { flattenArray } from "./logic/math";

export type AmethystPlatforms = ReturnType<typeof amethyst.getCurrentPlatform>;

/**
 * Handles interfacing with operating system and unifies methods 
 * to a simple form for all the platforms
 */
class AmethystBackend {
  public currentPlatform: AmethystPlatforms = this.getCurrentPlatform();

  public constructor() {
    console.log(`Current platform: ${this.currentPlatform}`);
  }

  private static isPlatformMobile = Capacitor.isNativePlatform();

  private static isPlatformDesktop = navigator.userAgent.indexOf("Electron") >= 0;

  private static isPlatformWeb = !AmethystBackend.isPlatformMobile && !AmethystBackend.isPlatformDesktop;

  public getCurrentPlatform() {
    if (Amethyst.isPlatformDesktop) return "desktop"; // aka Electron
    if (Amethyst.isPlatformMobile) return "mobile"; // aka Capacitor
    if (Amethyst.isPlatformWeb) return "web"; // aka Webapp
    throw new Error("Unknown platform");
  }

  // Useful only for web version
  private openLinkInNewTab(url: string) {
    const newWindow = window.open(url, "_blank", "noopener,noreferrer");
    if (newWindow) {
      newWindow.opener = null;
    }
  }

  public openLink(url: string) {
    switch (this.currentPlatform) {
      case "desktop":
        return window.electron.ipcRenderer.invoke("open-external", [url]);
      case "web":
        return this.openLinkInNewTab(url);
      default:
        return;
    }
  }

  public showItem(path: string) {
    switch (this.currentPlatform) {
      case "desktop":
        return window.electron.ipcRenderer.invoke("show-item", [path]); 
      default:
        return;
    }
  }

  private filesToBlobs(files: FileList): Promise<Blob>[] {
    const promises: Promise<Blob>[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const promise = new Promise<Blob>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const blob = new Blob([reader.result as ArrayBuffer]);
          resolve(blob);
        };
        reader.onerror = () => {
          reject(new Error(`Failed to read file "${file.name}"`));
        };
        reader.readAsArrayBuffer(file);
      });
      promises.push(promise);
    }
    return promises;
  }

  public async openFileDialog(filters?: FileFilter[]): Promise<OpenDialogReturnValue> {
    switch (this.currentPlatform) {
      case "desktop":
        return window.electron.ipcRenderer.invoke<OpenDialogReturnValue>("open-file-dialog", [filters]);
      case "web":
        const fileInput = document.createElement("input");
          fileInput.type = "file";
          fileInput.multiple = true;
          fileInput.click();

        // TODO: make a AmethystFile and AmethystAudioFile classes to manage this bullshit easily
        return new Promise((res, rej) => {
          fileInput.addEventListener("change", async event => {
            const files = (event.target as HTMLInputElement).files;
            if (!files) rej("no files");
            const blobs = await Promise.all(this.filesToBlobs(files!));
            const paths = blobs.map(blob => URL.createObjectURL(blob));
            files ? res({canceled: false, filePaths: paths}) : rej();
          });
        });
      default:
        return Promise.reject();
    }
  }
  
  public openFolderDialog(filter?: string[]) {
    switch (this.currentPlatform) {
      case "desktop":
        return window.electron.ipcRenderer.invoke<OpenDialogReturnValue>("open-folder-dialog", [filter]);
      default:
        return;
    }
  }

  public openAudioFilesAndAddToQueue = () => {
    amethyst.openFileDialog([{ name: "Audio", extensions: ALLOWED_AUDIO_EXTENSIONS }])?.then(result => {
      !result.canceled && player.queue.add(result.filePaths);
    });
  };
  
  public openAudioFoldersAndAddToQueue = () => {
    amethyst.openFolderDialog(ALLOWED_AUDIO_EXTENSIONS)?.then(result => {
      !result.canceled && player.queue.add(flattenArray(result.filePaths));
    });
  };

  // TODO: get rid of this stupid logic and make it be part of when loading a track
  public getMetadata(path: string) {
    switch (this.currentPlatform) {
      case "desktop":
        return window.electron.ipcRenderer.invoke<IMetadata>("get-metadata", [path]);
      default:
        return;
    }
  }

  public getCover(path: string) {
    switch (this.currentPlatform) {
      case "desktop":
        return window.electron.ipcRenderer.invoke<IMetadata>("get-cover", [path]);
      default:
        return;
    }
  }
}

export class Amethyst extends AmethystBackend {
  public VERSION = APP_VERSION;
  // @ts-ignore
  public IS_DEV = import.meta.env.DEV;
  public APPDATA_PATH: string | undefined;

  public store: Store = new Store();
  public shortcuts: Shortcuts = new Shortcuts();
  public mediaSession: MediaSession = new MediaSession();

  // private richPresenceTimer: NodeJS.Timer | undefined;

  public constructor() {
    super();

    if (this.currentPlatform === "desktop") {
      window.electron.ipcRenderer.invoke<string>("get-appdata-path").then(path => this.APPDATA_PATH = path);

      window.electron.ipcRenderer.on("maximize", () => this.store.state.isMaximized = true);
      window.electron.ipcRenderer.on("unmaximize", () => this.store.state.isMaximized = false);
      window.electron.ipcRenderer.on("minimize", () => this.store.state.isMinimized = true);
      window.electron.ipcRenderer.on("focus", () => this.store.state.isFocused = true);
      window.electron.ipcRenderer.on("unfocus", () => this.store.state.isFocused = false);

      window.electron.ipcRenderer.on("update", () => this.store.state.updateReady = true);
    }

    if (this.currentPlatform === "mobile") {
      StatusBar.setBackgroundColor({color: getThemeColorHex("--surface-800")});
    }

    // this.electron.ipc.on<string>("play-file", path => path !== "--require" && player.queue.add(path).then(() => {
    //   player.play(player.queue.getList().findIndex(track => track.path == path));
    // }));
    // this.electron.ipc.on<(string)[]>("play-folder", paths => player.queue.add(flattenArray(paths)));

    // watch(() => this.store.settings.useDiscordRichPresence, value => {
    //   if (value) {
    //     const currentTrack = player.getCurrentTrack();
    //     currentTrack && this.updateRichPresence(currentTrack);
    //     return;
    //   };
    //   this.richPresenceTimer && clearInterval(this.richPresenceTimer);
    //   this.electron.clearRichPresence();
    // });

    document.addEventListener("drop", event => {
      event.preventDefault();
      event.stopPropagation();
      player.queue.add(Array.from(event.dataTransfer!.files).map(f => f.path));
      player.play(player.queue.getList()[player.queue.getList().length - 1]);
    });

    document.addEventListener("dragover", e => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  public performWindowAction(action: "close" | "maximize" | "unmaximize" | "minimize"): void {
    if (this.currentPlatform === "desktop") {
      window.electron.ipcRenderer.invoke(action).then(() => this.syncWindowState());
    } else {
      throw new Error(`${this.performWindowAction.name} can only be executed when running in 'desktop' (electron) client`);
    }
  }

  private syncWindowState = async () => {
    const windowState = await window.electron.ipcRenderer.invoke<{ isMinimized: boolean; isMaximized: boolean }>("sync-window-state");
    this.store.state.isMinimized = windowState.isMinimized;
    this.store.state.isMaximized = windowState.isMaximized;
  };

  public async checkForUpdates() {
    this.store.state.isCheckingForUpdates = true;
    try {
      switch (this.currentPlatform) {
        case "desktop":
          await window.electron.ipcRenderer.invoke("check-for-updates");
          break; 
        default:
          break;
      }
        
    } catch (error) {
      console.log(error);
    }
    this.store.state.isCheckingForUpdates = false;
  }

  // private updateRichPresence(track: Track){
  //   const sendData = () => {
  //     this.electron.updateRichPresence([
  //       `${track.getArtistsFormatted() || "unknown artist"} - ${track.getTitleFormatted() || "unknown title"}`,
  //       player.isPaused.value ? "Paused" : `${player.currentTimeFormatted(true)} - ${track.getDurationFormatted(true)}`,
  //       track.metadata.data?.format.container?.toLowerCase()
  //     ]);
  //   };

  //   this.richPresenceTimer && clearInterval(this.richPresenceTimer);
  //   sendData();
  //   this.richPresenceTimer = setInterval(() => sendData(), 1000);
  // }
}

export const amethyst = new Amethyst();

export const useState = () => amethyst.store;
export const useShortcuts = () => amethyst.shortcuts;

// interface IPluginDefinitionParameters {
//   store: Store, 
//   electron: ElectronEventManager, 
//   shortcuts: Shortcuts, 
//   player: Player
// }

// export const definePlugin = (register: (options: IPluginDefinitionParameters) => any) => {
//   const {store, electron, shortcuts} = amethyst;
//   const plugin = register({store, electron, shortcuts, player});
//   console.log(plugin);
// };
