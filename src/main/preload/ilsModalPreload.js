// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld(
    'api', {
        receive: (channel, func) => {
            const validChannels = ['notiData'];
            if (validChannels.includes(channel)) {
                // Deliberately strip event as it includes `sender`
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        },
    }
)
