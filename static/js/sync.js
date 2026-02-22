const video = document.getElementById('videoPlayer');
const videoUrlInput = document.getElementById('videoUrl');
const loadVideoBtn = document.getElementById('loadVideo');
const statusIndicator = document.getElementById('status');
const eventLogs = document.getElementById('eventLogs');
const overlay = document.getElementById('videoOverlay');

let socket;
let isRemoteChange = false;

function addLog(message) {
    const time = new Date().toLocaleTimeString();
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    logItem.innerText = `[${time}] ${message}`;
    eventLogs.appendChild(logItem);
    eventLogs.scrollTop = eventLogs.scrollHeight;
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        statusIndicator.innerText = 'Bağlı';
        statusIndicator.style.color = '#22c55e';
        addLog('Sunucuya bağlandı.');
    };

    socket.onclose = () => {
        statusIndicator.innerText = 'Bağlantı Kesildi';
        statusIndicator.style.color = '#ef4444';
        addLog('Bağlantı kesildi. Tekrar deneniyor...');
        setTimeout(connectWebSocket, 3000);
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleRemoteEvent(data);
    };
}

function handleRemoteEvent(data) {
    isRemoteChange = true;
    
    if (data.type === 'load') {
        video.src = data.url;
        addLog(`Video yüklendi: ${data.url}`);
    } else if (data.type === 'play') {
        video.play();
        addLog('Video başlatıldı.');
    } else if (data.type === 'pause') {
        video.pause();
        addLog('Video duraklatıldı.');
    } else if (data.type === 'seek') {
        video.currentTime = data.time;
        addLog(`Zaman kaydırıldı: ${data.time.toFixed(2)}s`);
    } else if (data.type === 'sync') {
        if (Math.abs(video.currentTime - data.time) > 1.5) {
            video.currentTime = data.time;
        }
        if (data.playing && video.paused) video.play();
        if (!data.playing && !video.paused) video.pause();
    }
    
    setTimeout(() => { isRemoteChange = false; }, 100);
}

// Player Event Listeners
video.onplay = () => {
    if (!isRemoteChange) {
        socket.send(JSON.stringify({ type: 'play' }));
    }
};

video.onpause = () => {
    if (!isRemoteChange) {
        socket.send(JSON.stringify({ type: 'pause' }));
    }
};

video.onseeking = () => {
    if (!isRemoteChange) {
        socket.send(JSON.stringify({ type: 'seek', time: video.currentTime }));
    }
};

loadVideoBtn.onclick = () => {
    const url = videoUrlInput.value;
    if (url) {
        video.src = url;
        socket.send(JSON.stringify({ type: 'load', url: url }));
        addLog(`Video yüklendi: ${url}`);
    }
};

// Periodic sync check (Heartbeat)
setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN && !video.paused && !isRemoteChange) {
        socket.send(JSON.stringify({
            type: 'sync',
            time: video.currentTime,
            playing: !video.paused
        }));
    }
}, 5000);

connectWebSocket();
