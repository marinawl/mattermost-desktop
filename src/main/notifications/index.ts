// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, shell, Notification, screen, BrowserWindow} from 'electron';

import {getDoNotDisturb as getDarwinDoNotDisturb} from 'macos-notification-state';

import {SenderData} from 'types/notification';

import Config from 'common/config';
import {PLAY_SOUND, NOTIFICATION_CLICKED} from 'common/communication';
import {Logger} from 'common/log';

import PermissionsManager from '../permissionsManager';
import ViewManager from '../views/viewManager';
import MainWindow from '../windows/mainWindow';

import {getLocalURLString} from '../utils';

import {Mention} from './Mention';
import {DownloadNotification} from './Download';
import {NewVersionNotification, UpgradeNotification} from './Upgrade';
import getLinuxDoNotDisturb from './dnd-linux';
import getWindowsDoNotDisturb from './dnd-windows';

const log = new Logger('Notifications');

class NotificationManager {
    private mentionsPerChannel: Map<string, Mention> = new Map();
    private allActiveNotifications: Map<string, Notification> = new Map();
    private upgradeNotification?: NewVersionNotification;
    private restartToUpgradeNotification?: UpgradeNotification;

    public async displayMention(title: string, body: string, channelId: string, teamId: string, url: string, silent: boolean, webcontents: Electron.WebContents, soundName: string) {
        log.debug('displayMention', {title, body, channelId, teamId, url, silent, soundName});

        if (!Notification.isSupported()) {
            log.error('notification not supported');
            return;
        }

        if (getDoNotDisturb()) {
            return;
        }

        const view = ViewManager.getViewByWebContentsId(webcontents.id);
        if (!view) {
            return;
        }
        if (!view.view.shouldNotify) {
            return;
        }
        const serverName = view.view.server.name;

        const options = {
            title: `${serverName}: ${title}`,
            body,
            silent,
            soundName,
        };

        if (!await PermissionsManager.doPermissionRequest(webcontents.id, 'notifications', view.view.server.url.toString())) {
            return;
        }

        const mention = new Mention(options, channelId, teamId);
        const mentionKey = `${mention.teamId}:${mention.channelId}`;
        this.allActiveNotifications.set(mention.uId, mention);

        mention.on('show', () => {
            log.debug('displayMention.show');

            // On Windows, manually dismiss notifications from the same channel and only show the latest one
            if (process.platform === 'win32') {
                if (this.mentionsPerChannel.has(mentionKey)) {
                    log.debug(`close ${mentionKey}`);
                    this.mentionsPerChannel.get(mentionKey)?.close();
                    this.mentionsPerChannel.delete(mentionKey);
                }
                this.mentionsPerChannel.set(mentionKey, mention);
            }
            const notificationSound = mention.getNotificationSound();
            if (notificationSound) {
                MainWindow.sendToRenderer(PLAY_SOUND, notificationSound);
            }
            flashFrame(true);
        });

        mention.on('click', () => {
            log.debug('notification click', serverName, mention);

            this.allActiveNotifications.delete(mention.uId);
            MainWindow.show();
            if (serverName) {
                ViewManager.showById(view.id);
                webcontents.send(NOTIFICATION_CLICKED, channelId, teamId, url);
            }
        });

        mention.on('close', () => {
            this.allActiveNotifications.delete(mention.uId);
        });

        mention.on('failed', () => {
            this.allActiveNotifications.delete(mention.uId);
        });
        mention.show();
    }

    public displayDownloadCompleted(fileName: string, path: string, serverName: string) {
        log.debug('displayDownloadCompleted', {fileName, path, serverName});

        if (!Notification.isSupported()) {
            log.error('notification not supported');
            return;
        }

        if (getDoNotDisturb()) {
            return;
        }

        const download = new DownloadNotification(fileName, serverName);
        this.allActiveNotifications.set(download.uId, download);

        download.on('show', () => {
            flashFrame(true);
        });

        download.on('click', () => {
            shell.showItemInFolder(path.normalize());
            this.allActiveNotifications.delete(download.uId);
        });

        download.on('close', () => {
            this.allActiveNotifications.delete(download.uId);
        });

        download.on('failed', () => {
            this.allActiveNotifications.delete(download.uId);
        });
        download.show();
    }

    public displayCustomCommand(channelId: string, teamId: string, url: string, sender: SenderData, webcontents: Electron.WebContents) {
        const {message, name, imgUrl, baseUrl} = sender;

        const {win: parentWindow} = MainWindow;
        const displays = screen.getAllDisplays();
        let content = '';
        let windowOption = {};
        let windowUrl = '';

        // 명령어가 들어가 있을 경우 호출
        if (message?.trim().indexOf('!호출') === 0) {
            // 이미 호출되어 있는 경우 호출하지 않음
            if (windowIsVisible('Window_Call_User')) {
                return;
            }

            content = sliceExclamationMarkCommand('!호출', message);

            // windowUrl = '/command/callUser';
            windowUrl = 'callUser.html';
            windowOption = {
                width: displays[0].size.width,
                height: displays[0].size.height,
                resizable: false,
                alwaysOnTop: true,
                fullscreen: true,
                backgroundColor: '#ffffff',
                skipTaskbar: true,
                transparent: true,
                frame: false,
                parent: parentWindow,
                modal: true,
                focusable: false,
                show: false,
            };
        }

        // 띄울 html 이 설정 된 경우만 호출
        if (windowUrl) {
            // html 에 넘길 param
            const query = new Map<string, string>();

            query.set('imgUrl', imgUrl);
            query.set('name', name);
            query.set('content', content);

            // main modal 생성
            const mainModal = new BrowserWindow(windowOption);

            // main modal position 을 주 모니터로 설정
            mainModal.setPosition(displays[0].bounds.x, displays[0].bounds.y);

            // eslint-disable-next-line no-console
            console.log(windowUrl);

            // main modal URL 호출
            mainModal.loadURL(getLocalURLString(windowUrl, query));

            const subModals: BrowserWindow[] = [];

            // 다중 모니터일경우
            if (process.platform === 'win32' && displays?.length > 1) {
                // 모니터 갯수만큼 modal 창 생성
                for (let i = 1; i < displays.length; i++) {
                    const subModal = new BrowserWindow({
                        width: displays[i].size.width,
                        height: displays[i].size.height,
                        resizable: false,
                        alwaysOnTop: true,
                        fullscreen: true,
                        backgroundColor: '#ffffff',
                        skipTaskbar: true,
                        transparent: true,
                        frame: false,
                        modal: true,
                        focusable: false,
                        show: false,
                    });

                    // 다중 모니터 포지션 설정
                    subModal.setPosition(displays[i].bounds.x, displays[i].bounds.y);
                    subModals.push(subModal);
                }
            }

            // 호출 창 종료시 나머지 서브창도 종료되게 설정
            mainModal.once('closed', () => {
                // 호출자 채팅방으로 이동
                webcontents.send(NOTIFICATION_CLICKED, channelId, teamId, url);

                if (subModals.length) {
                    subModals.forEach((modal) => modal.close());
                }
            });

            // 메인 모달창 load 완료 후 subModal 까지 show
            mainModal.webContents.on('did-finish-load', () => {
                mainModal.show();
                subModals.forEach((modal) => modal.show());
            });
        }
    }

    public displayUpgrade(version: string, handleUpgrade: () => void): void {
        if (!Notification.isSupported()) {
            log.error('notification not supported');
            return;
        }
        if (getDoNotDisturb()) {
            return;
        }

        if (this.upgradeNotification) {
            this.upgradeNotification.close();
        }
        this.upgradeNotification = new NewVersionNotification();
        this.upgradeNotification.on('click', () => {
            log.info(`User clicked to upgrade to ${version}`);
            handleUpgrade();
        });
        this.upgradeNotification.show();
    }

    public displayRestartToUpgrade(version: string, handleUpgrade: () => void): void {
        if (!Notification.isSupported()) {
            log.error('notification not supported');
            return;
        }
        if (getDoNotDisturb()) {
            return;
        }

        this.restartToUpgradeNotification = new UpgradeNotification();
        this.restartToUpgradeNotification.on('click', () => {
            log.info(`User requested perform the upgrade now to ${version}`);
            handleUpgrade();
        });
        this.restartToUpgradeNotification.show();
    }
}

function getDoNotDisturb() {
    if (process.platform === 'win32') {
        return getWindowsDoNotDisturb();
    }

    if (process.platform === 'darwin') {
        return getDarwinDoNotDisturb();
    }

    if (process.platform === 'linux') {
        return getLinuxDoNotDisturb();
    }

    return false;
}

function flashFrame(flash: boolean) {
    if (process.platform === 'linux' || process.platform === 'win32') {
        if (Config.notifications.flashWindow) {
            MainWindow.get()?.flashFrame(flash);
        }
    }
    if (process.platform === 'darwin' && Config.notifications.bounceIcon) {
        app.dock.bounce(Config.notifications.bounceIconType);
    }
}

const notificationManager = new NotificationManager();
export default notificationManager;

function sliceExclamationMarkCommand(command: string, word: string) {
    return word?.replace(command, '') || '';
}

function windowIsVisible(title: string) {
    const windows = BrowserWindow.getAllWindows();

    return windows.findIndex((window) => window.getTitle() === title) > -1;
}
