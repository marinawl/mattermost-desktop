import React, {useEffect, useState} from 'react';
import ReactDOM from 'react-dom';

import '../../css/components/modal/CallUser.scss'

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

const CallUser = () => {
    const content = decodeURIComponent(urlParams.get('content')!);
    const imgUrl = decodeURIComponent(urlParams.get('imgUrl')!);
    const name = decodeURIComponent(urlParams.get('name')!);

    const onWindowClose = () => {
        window.close()
    }

    return (
        <div className={'modal-call-user'}>
            <div className={'modal-call-user-profile'}>
                <img src={imgUrl} alt="" loading={'lazy'} width={50} height={50}/>
            </div>
            <div className={'modal-call-user-caller'}>
                <p>
                    <strong>{name}</strong>님 호출
                </p>
            </div>

            <div className={'modal-call-user-content'}>{content}</div>

            <button id={'modal-close-btn'} onClick={onWindowClose}>확인</button>
        </div>
    );
};

const start = () => {
    ReactDOM.render(
        <CallUser/>,
        document.getElementById('app'),
    );
};

start();
