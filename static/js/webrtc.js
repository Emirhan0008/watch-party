const localVideo = document.getElementById('localVideo');
let screenStream;
const shareScreenBtn = document.getElementById('shareScreen');
const recordingIndicator = document.getElementById('recordingIndicator');
const videoGrid = document.getElementById('videoGrid');

const peerConnections = {}; // remoteSocketId -> RTCPeerConnection

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

async function startScreenShare() {
    try {
        // Ekran ve ses paylaşımı iste
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: "always" },
            audio: true
        });

        localVideo.srcObject = screenStream;
        recordingIndicator.classList.remove('hidden');
        addLog('Ekran paylaşımı başlatıldı.');

        // Ekran paylaşımı durdurulduğunda (tarayıcı butonundan)
        screenStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        socket.send(JSON.stringify({ type: 'rtc-ready' }));
    } catch (err) {
        console.error('Ekran paylaşım hatası:', err);
        addLog('Ekran paylaşımı başlatılamadı: ' + err.message);
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
    recordingIndicator.classList.add('hidden');
    addLog('Ekran paylaşımı durduruldu.');
}

shareScreenBtn.onclick = startScreenShare;

// Note: In a full implementation, we'd handle offer/answer/ice-candidates here.
// For this MVP, we use the same socket for signaling.

async function createPeerConnection(remoteId) {
    const pc = new RTCPeerConnection(rtcConfig);

    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                to: remoteId
            }));
        }
    };

    pc.ontrack = (event) => {
        if (!document.getElementById(`remote-${remoteId}`)) {
            const wrapper = document.createElement('div');
            wrapper.className = 'video-wrapper remote-stream';
            wrapper.id = `remote-${remoteId}`;

            const v = document.createElement('video');
            v.autoplay = true;
            v.playsinline = true;
            v.srcObject = event.streams[0];

            const label = document.createElement('span');
            label.innerText = 'Paylaşılan Ekran';

            wrapper.appendChild(v);
            wrapper.appendChild(label);
            videoGrid.appendChild(wrapper);
        }
    };

    return pc;
}

// Update the handleRemoteEvent in sync.js or handle RTC here
// For simplicity, we'll hook into the same socket message handler

const originalOnMessage = socket.onmessage;
socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type.startsWith('rtc-') || data.type === 'ice-candidate' || data.type === 'offer' || data.type === 'answer') {
        handleRTCMessage(data);
    } else {
        handleRemoteEvent(data); // From sync.js
    }
};

async function handleRTCMessage(data) {
    // This is a simplified signaling logic
    // In production, you'd want unique IDs for each client
    if (data.type === 'rtc-ready' && screenStream) {
        const pc = await createPeerConnection('peer');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: 'offer', offer: offer }));
    } else if (data.type === 'offer') {
        const pc = await createPeerConnection('peer');
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: 'answer', answer: answer }));
    } else if (data.type === 'answer') {
        // Handle answer
    } else if (data.type === 'ice-candidate') {
        // Handle candidate
    }
}
