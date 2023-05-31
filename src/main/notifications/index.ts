// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {app, shell, Notification, screen, BrowserWindow} from 'electron';

import {getDoNotDisturb as getDarwinDoNotDisturb} from 'macos-notification-state';

import {MentionData, SenderData} from 'types/notification';

import Config from 'common/config';
import {PLAY_SOUND} from 'common/communication';
import {Logger} from 'common/log';

import ViewManager from '../views/viewManager';
import MainWindow from '../windows/mainWindow';

import {Mention} from './Mention';
import {DownloadNotification} from './Download';
import {NewVersionNotification, UpgradeNotification} from './Upgrade';
import getLinuxDoNotDisturb from './dnd-linux';
import getWindowsDoNotDisturb from './dnd-windows';
import {getServerURLString} from "../utils";

export const currentNotifications = new Map();

const log = new Logger('Notifications');

export function displayMention(title: string, body: string, channel: {id: string}, teamId: string, url: string, silent: boolean, webcontents: Electron.WebContents, data: MentionData) {
    log.debug('displayMention', {title, body, channel, teamId, url, silent, data});

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
    const serverName = view.view.server.name;

    const options = {
        title: `${serverName}: ${title}`,
        body,
        silent,
        data,
    };

    const mention = new Mention(options, channel, teamId);
    const mentionKey = `${mention.teamId}:${mention.channel.id}`;

    mention.on('show', () => {
        log.debug('displayMention.show');

        // On Windows, manually dismiss notifications from the same channel and only show the latest one
        if (process.platform === 'win32') {
            if (currentNotifications.has(mentionKey)) {
                log.debug(`close ${mentionKey}`);
                currentNotifications.get(mentionKey).close();
                currentNotifications.delete(mentionKey);
            }
            currentNotifications.set(mentionKey, mention);
        }
        const notificationSound = mention.getNotificationSound();
        if (notificationSound) {
            MainWindow.sendToRenderer(PLAY_SOUND, notificationSound);
        }
        flashFrame(true);
    });

    mention.on('click', () => {
        log.debug('notification click', serverName, mention);
        if (serverName) {
            ViewManager.showById(view.id);
            webcontents.send('notification-clicked', {channel, teamId, url});
        }
    });
    mention.show();
}

// 채팅창으로 사용자 지정 명령어 전송시 호출
export function displayCustomCommand(sender: SenderData) {
    const {message, name, imgUrl, baseUrl} = sender;

    // @ts-ignore
    const {win: parentWindow} = MainWindow;
    const displays = screen.getAllDisplays();
    let content = '', windowOption = {}, windowUrl = '';

    // 명령어가 들어가 있을 경우 호출
    if(message?.trim().indexOf('!호출') === 0) {
        // 이미 호출되어 있는 경우 호출하지 않음
        if(windowIsVisible('Window_Call_User')) return ;

        // 명령어를 제외한 내용 추출
        content = sliceExclamationMarkCommand('!호출', message);
        windowUrl = '/command/callUser'
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
            show: false
        }
    }

    // 띄울 html 이 설정 된 경우만 호출
    if(windowUrl) {
        // html 에 넘길 param
        const query = new Map<string, string>();

        query.set('imgUrl', imgUrl);
        query.set('name', name);
        query.set('content', content);

        // main modal 생성
        const mainModal = new BrowserWindow(windowOption);

        // main modal position 을 주 모니터로 설정
        mainModal.setPosition(displays[0].bounds.x, displays[0].bounds.y);

        // main modal URL 호출
        mainModal.loadURL(getServerURLString(baseUrl + windowUrl, query));

        const subModals: BrowserWindow[] = [];
        // 다중 모니터일경우
        if(displays?.length > 1) {
            // 모니터 갯수만큼 modal 창 생성
            for(let i = 1; i < displays.length; i++) {
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
                    show: false
                });

                // 다중 모니터 포지션 설정
                subModal.setPosition(displays[i].bounds.x, displays[i].bounds.y);
                subModals.push(subModal);
            }

            // 호출 창 종료시 나머지 서브창도 종료되게 설정
            mainModal.once('closed', () => {
                subModals.forEach(modal => modal.close())
            });
        }

        // 메인 모달창 load 완료 후 subModal 까지 show
        mainModal.webContents.on('did-finish-load', () => {
            mainModal.show();
            subModals.forEach((modal) => modal.show())
        });
    }
}

export function displayDownloadCompleted(fileName: string, path: string, serverName: string) {
    log.debug('displayDownloadCompleted', {fileName, path, serverName});

    if (!Notification.isSupported()) {
        log.error('notification not supported');
        return;
    }

    if (getDoNotDisturb()) {
        return;
    }

    const download = new DownloadNotification(fileName, serverName);

    download.on('show', () => {
        flashFrame(true);
    });

    download.on('click', () => {
        shell.showItemInFolder(path.normalize());
    });
    download.show();
}

let upgrade: NewVersionNotification;

export function displayUpgrade(version: string, handleUpgrade: () => void): void {
    if (!Notification.isSupported()) {
        log.error('notification not supported');
        return;
    }
    if (getDoNotDisturb()) {
        return;
    }

    if (upgrade) {
        upgrade.close();
    }
    upgrade = new NewVersionNotification();
    upgrade.on('click', () => {
        log.info(`User clicked to upgrade to ${version}`);
        handleUpgrade();
    });
    upgrade.show();
}

let restartToUpgrade;
export function displayRestartToUpgrade(version: string, handleUpgrade: () => void): void {
    if (!Notification.isSupported()) {
        log.error('notification not supported');
        return;
    }
    if (getDoNotDisturb()) {
        return;
    }

    restartToUpgrade = new UpgradeNotification();
    restartToUpgrade.on('click', () => {
        log.info(`User requested perform the upgrade now to ${version}`);
        handleUpgrade();
    });
    restartToUpgrade.show();
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

function sliceExclamationMarkCommand(command: string, word: string) {
    return word?.replace(command, '') || '';
}

function windowIsVisible(title: string) {
    const windows = BrowserWindow.getAllWindows();

    return windows.findIndex(window => window.getTitle() === title) > -1;
}
