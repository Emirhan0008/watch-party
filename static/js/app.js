// Watch Party - Final Stable Debug Edition
const video = document.getElementById('videoPlayer');
const sharedVideo = document.getElementById('sharedVideo');
const statusIndicator = document.getElementById('status');
const eventLogs = document.getElementById('eventLogs');
const shareScreenBtn = document.getElementById('shareScreen');
const recordingIndicator = document.getElementById('recordingIndicator');
const videoGrid = document.getElementById('videoGrid');
const localVideo = document.getElementById('localVideo');
const userListEl = document.getElementById('userList');
const nameModal = document.getElementById('nameModal');
const usernameInput = document.getElementById('usernameInput');
const saveNameBtn = document.getElementById('saveNameBtn');
const skipNameBtn = document.getElementById('skipNameBtn');
const playPrompt = document.getElementById('playPrompt');
const fullScreenBtn = document.getElementById('fullScreenBtn');

let socket;
let myId = null;
let myUsername = "";
let currentBroadcaster = null;
let screenStream = null;
const peerConnections = {};

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com' }
    ],
    iceCandidatePoolSize: 10
};

function addLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const logItem = document.createElement('div');
    logItem.className = `log-item ${type}`;
    logItem.innerText = `[${time}] ${message}`;
    eventLogs.appendChild(logItem);
    eventLogs.scrollTop = eventLogs.scrollHeight;
    console.log(`[LOG] ${message}`);
}

// Name Selection & LocalStorage
window.addEventListener('load', () => {
    const savedName = localStorage.getItem('watchPartyName');
    if (savedName) {
        myUsername = savedName;
        usernameInput.value = savedName;
        // Eğer isim varsa modalı kapatmak için backend'in bağlanmasını bekleyeceğiz
    }
});

const handleNameSave = (isSkip = false) => {
    const name = isSkip ? "" : usernameInput.value.trim();
    if (name) {
        myUsername = name;
        localStorage.setItem('watchPartyName', name);
    }

    nameModal.classList.add('hidden');
    addLog(`Hoş geldin!`);

    if (socket && socket.readyState === WebSocket.OPEN) {
        if (myUsername) {
            socket.send(JSON.stringify({ type: 'set-name', name: myUsername }));
        }
    }
};

saveNameBtn.onclick = () => handleNameSave(false);
skipNameBtn.onclick = () => handleNameSave(true);
usernameInput.onkeypress = (e) => { if (e.key === 'Enter') handleNameSave(false); };

// Play Prompt
playPrompt.onclick = () => {
    playPrompt.classList.add('hidden');
    if (sharedVideo.srcObject) {
        sharedVideo.muted = false; // Mobilde ses için etkileşim şart
        sharedVideo.play().catch(e => addLog("Oynatma hatası: " + e.message, "error"));
    }
};

// Full Screen Logic
fullScreenBtn.onclick = () => {
    const target = sharedVideo.classList.contains('hidden') ? video : sharedVideo;
    if (target.requestFullscreen) {
        target.requestFullscreen();
    } else if (target.webkitRequestFullscreen) { /* Safari */
        target.webkitRequestFullscreen();
    } else if (target.msRequestFullscreen) { /* IE11 */
        target.msRequestFullscreen();
    }
};

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    addLog('Sunucuya bağlanılıyor...');
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        statusIndicator.innerText = 'Bağlı';
        statusIndicator.style.backgroundColor = '#22c55e';
        addLog('Sunucu bağlantısı kuruldu.');
        if (myUsername) {
            socket.send(JSON.stringify({ type: 'set-name', name: myUsername }));
        }
    };

    socket.onclose = () => {
        statusIndicator.innerText = 'Bağlantı Kesildi';
        statusIndicator.style.backgroundColor = '#ef4444';
        addLog('Bağlantı koptu, yeniden deneniyor...', 'error');
        setTimeout(connectWebSocket, 3000);
    };

    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'init') {
            myId = data.id;
            addLog(`Kimliğiniz doğrulandı.`);

            // Eğer önceden kaydedilmiş isim varsa veya isim modalda girilmişse sunucuya gönder
            if (myUsername) {
                socket.send(JSON.stringify({ type: 'set-name', name: myUsername }));
                nameModal.classList.add('hidden');
            } else {
                myUsername = data.username; // Sunucunun verdiği varsayılan ismi al
            }

            currentBroadcaster = data.broadcaster;
            updateSharingUi();
        } else if (data.type === 'new-client') {
            addLog(`Yeni bir arkadaş katıldı: ${data.id}`);
            // EĞER BEN YAYINCIYSAM, YENİ GELENE TEKLİF GÖNDER
            if (screenStream && data.id !== myId) {
                addLog(`${data.id} için yayın hazırlığı yapılıyor...`);
                setTimeout(() => initiateHandshake(data.id), 2000);
            }
        } else if (data.type === 'user-list') {
            updateUserList(data.users);
            currentBroadcaster = data.broadcaster;
            updateSharingUi();
        } else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice-candidate') {
            if (data.from !== myId) {
                handleRTCMessage(data);
            }
        }
    };
}

function updateUserList(users) {
    userListEl.innerHTML = "";
    users.forEach(u => {
        const li = document.createElement('li');
        li.className = 'user-item';
        if (u.id === myId) li.classList.add('me');
        if (u.id === currentBroadcaster) li.classList.add('broadcaster');
        li.innerText = u.name;
        userListEl.appendChild(li);
    });
}

function updateSharingUi() {
    if (currentBroadcaster && currentBroadcaster !== myId) {
        shareScreenBtn.disabled = true;
        shareScreenBtn.innerText = "📺 Yayın Var";
    } else {
        shareScreenBtn.disabled = false;
        shareScreenBtn.innerText = screenStream ? "🛑 Paylaşımı Durdur" : "📺 Ekranı Paylaş";
    }
}

async function initiateHandshake(targetId) {
    addLog(`${targetId} ile el sıkışma başlatılıyor...`);
    const pc = await createPeerConnection(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send(JSON.stringify({ type: 'offer', offer: offer, to: targetId }));
}

async function handleRTCMessage(data) {
    const fromId = data.from;

    if (data.type === 'offer') {
        addLog('Yayıncıdan yayın sinyali alındı...');
        const pc = await createPeerConnection(fromId);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: 'answer', answer: answer, to: fromId }));
    } else if (data.type === 'answer') {
        addLog('Sinyal el sıkışması tamamlandı.');
        const pc = peerConnections[fromId];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            setVideoBitrate(pc);
        }
    } else if (data.type === 'ice-candidate') {
        const pc = peerConnections[fromId];
        if (pc && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(e => {
                console.warn("ICE Adayı ekleme hatası:", e);
            });
        }
    }
}

async function createPeerConnection(remoteId) {
    if (peerConnections[remoteId]) peerConnections[remoteId].close();

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections[remoteId] = pc;

    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate, to: remoteId }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        addLog(`Ağ Durumu: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed') {
            addLog('Ağ hatası! Yeniden bağlanılmaya çalışılıyor...', 'error');
            if (screenStream) initiateHandshake(remoteId);
        }
    };

    pc.ontrack = (event) => {
        addLog('BAŞARI: Yayın ortadaki büyük ekrana aktarılıyor!');
        if (sharedVideo.srcObject !== event.streams[0]) {
            sharedVideo.srcObject = event.streams[0];
            sharedVideo.classList.remove('hidden');
            video.classList.add('hidden');

            // Mobilde autoplay engeline takılmamak için
            sharedVideo.muted = true;
            sharedVideo.play().catch(() => { });

            playPrompt.classList.remove('hidden'); // Siyah ekranı engellemek için dokunma alanı
        }
    };

    return pc;
}

function setVideoBitrate(pc) {
    pc.getSenders().forEach(sender => {
        if (sender.track && sender.track.kind === 'video') {
            const params = sender.getParameters();
            if (!params.encodings) params.encodings = [{}];
            params.encodings[0].maxBitrate = 1500000;
            sender.setParameters(params).catch(e => console.error(e));
        }
    });
}

shareScreenBtn.onclick = async () => {
    if (screenStream) {
        stopScreenShare();
        return;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 1280, height: 720, frameRate: 30 },
            audio: true
        });

        localVideo.srcObject = screenStream;
        recordingIndicator.classList.remove('hidden');
        addLog('Yayınınız başladı. Arkadaşlarınızın bağlanması bekleniyor...');

        socket.send(JSON.stringify({ type: 'start-share' }));
        updateSharingUi();

        screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (err) {
        addLog(`Hata: ${err.message}`, 'error');
    }
};

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    socket.send(JSON.stringify({ type: 'stop-share' }));
    recordingIndicator.classList.add('hidden');
    localVideo.srcObject = null;
    addLog('Yayınınız sonlandırıldı.');
    updateSharingUi();
}

connectWebSocket();
