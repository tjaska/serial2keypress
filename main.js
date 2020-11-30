const electron = require('electron');
const packageJson = require('./package.json');
const {app, BrowserWindow, protocol, ipcMain} = require('electron');
const log = require('electron-log');
const path = require('path');
const h = require('./helpers.js');
const {conf} = require('./config.js');
const {KioskWindow} = require('./classes.js');
const {download} = require('electron-dl');
const fs = require('fs');
const confJson = require('electron-json-config');
const { session } = require('electron');


// movie protocol for handling local media files.
// If media exists locally, then it is asked from browser by media protocol,
// which returns path to local media folder, usually at %appData% roaming/[appName]
protocol.registerSchemesAsPrivileged([
    { scheme: 'movie', privileges: { standard: true, secure: true } }
]);

const appData = {
    locale : 'et',
    mainUrl : `http://expo.tootukassa.internal/wordpress/${packageJson.codeName}`,
    idleTimeout : null,
}

let windows = null;
conf.app.version = app.getVersion();

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = true;

const defineWindows = () =>
{
    return [
        new KioskWindow({ 
            id: 'main', 
            url: (confJson.has('url') ? confJson.get('url') : appData.mainUrl), 
            x: conf.display.primary.x, y: conf.display.primary.y, 
            w: conf.display.primary.w, h: conf.display.primary.h, 
            show: true, 
            nodeIntegration: false,
            onbeforeunload: null,
            // general display settings. If not null, will override config.js settings.
            fullscreen: null,
            kiosk: null,
            focusable : null,
            resizable : null,
            frame : null,
            transparent : null,
            openDevTools : null,
         }),
        new KioskWindow({ 
            id: 'overlay', url: `file://${__dirname}/html/overlay.html`, 
            x: conf.display.overlay.x, y: conf.display.overlay.y, 
            w: conf.display.overlay.w, h: conf.display.overlay.h, 
            show: true, 
            nodeIntegration: true,
            // general display settings. If not null, will override config.js settings.
            fullscreen: false,
            kiosk: false,
            focusable : false,
            resizable : false,
            frame : false,
            transparent : true,
            openDevTools : false,
         }),
    ];
}

const createAllWindows = (w) => {
    w.forEach(win => { createWindow(win);});
};

const createWindow = win => {
    // special parent case for overlay window
    let parent = null;
    if (win.id == 'overlay') parent = h.getWin('main').instance;
    
    // Create the browser window.
    win.instance = new BrowserWindow({
        name : win.id,
        homeUrl : win.url,
        title : conf.display.mainWinTitle,
        width: win.w,
        height: win.h,
        x: win.x,
        y: win.y,
        parent: parent,
        show: win.show,
        frame: win.frame != null ? win.frame : conf.display.frame,
        focusable : win.focusable != null ? win.focusable : conf.display.focusable,
        resizable: win.resizable != null ? win.resizable : conf.display.resizable,
        fullscreen: win.fullscreen != null ? win.fullscreen : conf.display.fullscreen,
        kiosk: win.kiosk != null ? win.kiosk : conf.display.kiosk,
        transparent: win.transparent != null ? win.transparent : conf.display.transparent,
        webPreferences: {
            nodeIntegration: win.nodeIntegration,
            preload: path.resolve(__dirname, 'renderer.js'),
            webSecurity: false
        }
    });

    // load the url of the app.
    win.instance.loadURL(win.url);

    // hide menu
    win.instance.setMenu(null);

    // Open the DevTools.
    const isOpenDevTools = win.openDevTools != null ? win.openDevTools : conf.display.openDevTools;
    if(isOpenDevTools) win.instance.webContents.openDevTools();

    // Emitted when the window is closed.
    win.instance.on('closed', function () {
        win.instance = null;
    });
    
    if(win.id === 'main')
    {
        // close app when main window is closed
        win.instance.on('closed', () => {
            app.quit();
        });
        
        // prevent html meta title override
        win.instance.on('page-title-updated', function(e) {
            e.preventDefault()
        });
        
        // prevent _blank links from opening in new tab
        // win.instance.webContents.on('new-window', function(e, url) {
        //     e.preventDefault();
        //     e.defaultPrevented = true;
        //     // require('electron').shell.openExternal(url);
        //     win.instance.loadURL(url);
        //   });
    }
}

exports.exitApp = () =>
{
    windows.forEach(element => {
        if(element.instance) element.instance.close();
        app.exit();
    });
}

exports.checkFileExists = fileName => {
    let result = false;
    log.info(`checking if ${fileName} exists`);
    if (fs.existsSync(`${app.getPath('userData')}/media/${fileName}`))
    {
        log.info(`${fileName} exists`);
        result = true;
    }
    else
    {
        log.info(`${fileName} does not exist`)
    }
    return result;
}

//////////////////////////////////////////////////////////
////////////////////// APP IS READY //////////////////////
//////////////////////////////////////////////////////////

app.on('ready', function(){
    log.info('App starting...');
    protocol.registerFileProtocol('movie', (request, callback) => {
        let url = request.url.split('://');
        url = url[1].slice(0, -1); 
        callback({path : `${app.getPath('userData')}/media/${url}`})
      }, (error) => {
        if (error) console.error('Failed to register protocol')
      }
    );
    
    // check json config file, if no url key exists, set default
    if(!confJson.has('url') || confJson.get('url') == '') confJson.set('url', appData.mainUrl);
    
    // browser window creation
    if(conf.display.getScreenDimensions) h.getScreenDimensions(conf.display, electron.screen);
    windows = defineWindows();
    h.setWindows(windows);
    // sync overlay window position with parent
    h.getWin('overlay').x = conf.display.primary.x + conf.display.overlay.x;
    h.getWin('overlay').y = conf.display.primary.h - 75;
    createAllWindows(windows);
      
    h.getWin('main').instance.webContents.on('new-window', function(event, urlToOpen) {
        event.defaultPrevented = true;
        h.getWin('main').instance.loadURL(urlToOpen);
      });
    
    h.getWin('overlay').instance.hide();
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

//#region ipc binds
const returnHome = origin => {
    // reset language to estonian when backhome if called by keybind
    // eg sent from AHK script
    if(origin == 'keybind') appData.locale = 'et';
    
    const url = h.getWin('main').url;
    const browserWin = h.getWin('main').instance;
    browserWin.loadURL(`${url}?locale=${appData.locale}`);
    browserWin.webContents.once('did-finish-load', () =>{
        h.getWin('overlay').instance.hide();
        
        // clear storageData & cookies
        session.defaultSession.clearStorageData([], (data) => {})
    })
}

ipcMain.on('nav', (event, payload) => {
    if(payload.action == 'backHome')
    {
        // if video is playing, reschedule timeout after video end + 1 minute
        if(payload.actionData.videoDuration != null && payload.actionData.isVideoPlaying)
        {
            const remainingS = payload.actionData.videoDuration - payload.actionData.videoCurrentTime;
            const remainingMs = remainingS * 1000; // conversion to ms
            const remaining = remainingMs + (1000 * 60); // add 1 minute after video ends
            if (appData.idleTimeout != null) clearTimeout(appData.idleTimeout);
            appData.idleTimeout = setTimeout(function(){
                returnHome(payload.actionData.origin);
                idleTimeout = null;
            }, remaining);
        }
        else
        {
            returnHome(payload.actionData.origin);
        }
    }
    
    if(payload.action == 'leaveHome')
    {
        h.getWin('overlay').instance.show();
    }
});

// sync locale change on page with appData locale
ipcMain.on('locale', (event, payload) => {
    if(payload.action == 'localeChange')
    {
        appData.locale = payload.data.locale;
    }
});


ipcMain.on('online-status-changed', (event, status) => {
    log.info('online-status-changed triggered', status);
});

ipcMain.on('download-media', async (event, url) => {
    const win = BrowserWindow.getFocusedWindow();
    await download(win, url, 
        {
            directory : `${app.getPath('userData')}/media/`,
            onProgress : (percent) => {
                if(percent == 1) log.info(`done downloading: ${url}`);
            },
        });
});
//#endregion